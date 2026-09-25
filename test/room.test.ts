import { runDurableObjectAlarm } from 'cloudflare:test';
import { env, exports as workerExports } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoomMessage, ServerFrame } from '../src/shared/protocol';
import { until, cookieFrom, postJoin, resetTables, seedGroup, type SeededGroup } from './helpers';

const worker = workerExports.default;

/** A dad's open socket plus every frame it has received, in order. */
class Dad {
  frames: ServerFrame[] = [];
  private waiters: Array<(f: ServerFrame) => void> = [];

  constructor(
    readonly ws: WebSocket,
    readonly cookie: string,
  ) {
    ws.accept();
    ws.addEventListener('message', (event) => {
      if (event.data === 'pong') return;
      const frame = JSON.parse(event.data as string) as ServerFrame;
      this.frames.push(frame);
      this.waiters.splice(0).forEach((w) => w(frame));
    });
  }

  /** Resolves with the next frame matching `pred`, checking history first. */
  next<T extends ServerFrame['t']>(t: T, pred?: (f: Extract<ServerFrame, { t: T }>) => boolean) {
    const matches = (f: ServerFrame): f is Extract<ServerFrame, { t: T }> =>
      f.t === t && (!pred || pred(f as Extract<ServerFrame, { t: T }>));
    const seen = this.frames.find(matches);
    if (seen) return Promise.resolve(seen);
    return new Promise<Extract<ServerFrame, { t: T }>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no ${t} frame within 3s`)), 3000);
      const check = (f: ServerFrame) => {
        if (matches(f)) {
          clearTimeout(timer);
          resolve(f);
        } else this.waiters.push(check);
      };
      this.waiters.push(check);
    });
  }

  say(body: string, cid?: string) {
    this.ws.send(
      JSON.stringify(cid === undefined ? { t: 'chat', body } : { t: 'chat', body, cid }),
    );
  }

  react(id: string, emoji: string, on: boolean) {
    this.ws.send(JSON.stringify({ t: 'react', id, emoji, on }));
  }

  retract(id: string) {
    this.ws.send(JSON.stringify({ t: 'retract', id }));
  }

  reply(body: string, replyTo: string) {
    this.ws.send(JSON.stringify({ t: 'chat', body, replyTo }));
  }

  edit(id: string, body: string) {
    this.ws.send(JSON.stringify({ t: 'edit', id, body }));
  }

  close() {
    this.ws.close(1000, 'bye');
  }
}

/** Where a socket that resumes left off: its last line, and its last change. */
interface Resume {
  after: number;
  rev?: number;
}

async function enter(group: SeededGroup, name: string, cookie?: string, resume?: Resume) {
  if (!cookie)
    cookie = cookieFrom(await worker.fetch(postJoin({ code: group.code, displayName: name })));
  const query =
    resume === undefined
      ? ''
      : `?after=${resume.after}${resume.rev === undefined ? '' : `&rev=${resume.rev}`}`;
  const url = `https://dads.test/ws${query}`;
  const res = await worker.fetch(url, { headers: { Upgrade: 'websocket', Cookie: cookie } });
  expect(res.status).toBe(101);
  expect(res.webSocket).toBeTruthy();
  return new Dad(res.webSocket!, cookie);
}

function bodies(messages: RoomMessage[]): string[] {
  return messages.map((m) => m.body);
}

describe('RoomDO', () => {
  let group: SeededGroup;
  const open: Dad[] = [];

  beforeEach(async () => {
    await resetTables();
    group = await seedGroup();
  });
  afterEach(() => {
    open.splice(0).forEach((d) => d.close());
  });

  it('welcomes a dad with himself on the roster, and records his arrival', async () => {
    const marc = await enter(group, 'Marc');
    open.push(marc);
    const hello = await marc.next('hello');
    expect(hello.you.name).toBe('Marc');
    expect(hello.roster.map((r) => r.name)).toEqual(['Marc']);

    // Arriving is not something anybody said, so it is not a line in the
    // conversation — it is a row behind the roster.
    expect(await presence(group.id)).toEqual(['Marc in']);
    expect(marc.frames.some((f) => f.t === 'msg')).toBe(false);
  });

  it('fans a line out to everyone in the room, including the sender', async () => {
    const marc = await enter(group, 'Marc');
    const sam = await enter(group, 'Sam');
    open.push(marc, sam);
    await sam.next('hello');

    marc.say('  rough bedtime tonight  ');

    const [a, b] = await Promise.all([
      marc.next('msg', (f) => f.message.kind === 'chat'),
      sam.next('msg', (f) => f.message.kind === 'chat'),
    ]);
    expect(a.message.body).toBe('rough bedtime tonight');
    expect(a.message.name).toBe('Marc');
    expect(b.message.seq).toBe(a.message.seq);
  });

  it('posts a re-sent line once, and hands the sender back its own id', async () => {
    const marc = await enter(group, 'Marc');
    const sam = await enter(group, 'Sam');
    open.push(marc, sam);
    await sam.next('hello');

    // A phone that lost the signal cannot know whether the line got there, so
    // it sends it again on reconnect. The room has it, and says so rather than
    // saying it twice.
    marc.say('on the train, back later', 'c-abc');
    const first = await marc.next('msg', (f) => f.message.kind === 'chat');
    expect(first.cid).toBe('c-abc');

    marc.say('on the train, back later', 'c-abc');
    marc.say('and here now', 'c-def');
    const next = await marc.next('msg', (f) => f.message.kind === 'chat' && f.cid === 'c-def');

    // Nothing between them: the repeat was dropped, not posted.
    expect(next.message.seq).toBe(first.message.seq + 1);
    const said = sam.frames.filter(
      (f) => f.t === 'msg' && f.message.body === 'on the train, back later',
    );
    expect(said).toHaveLength(1);
  });

  it('shows a newcomer everyone already here', async () => {
    const marc = await enter(group, 'Marc');
    const sam = await enter(group, 'Sam');
    open.push(marc, sam);
    const hello = await sam.next('hello');
    expect(hello.roster.map((r) => r.name)).toEqual(['Marc', 'Sam']);
    const roster = await marc.next('roster', (f) => f.roster.length === 2);
    expect(roster.roster.map((r) => r.name)).toEqual(['Marc', 'Sam']);
  });

  it('counts a dad with two tabs once', async () => {
    const marc = await enter(group, 'Marc');
    const tab2 = await enter(group, 'Marc', marc.cookie);
    open.push(marc, tab2);
    const hello = await tab2.next('hello');
    expect(hello.roster).toHaveLength(1);
    // The second tab is not a second arrival.
    expect(await presence(group.id)).toEqual(['Marc in']);
  });

  it('backfills a fresh client with the recent lines', async () => {
    const marc = await enter(group, 'Marc');
    open.push(marc);
    marc.say('one');
    marc.say('two');
    await marc.next('msg', (f) => f.message.body === 'two');

    const sam = await enter(group, 'Sam');
    open.push(sam);
    const hello = await sam.next('hello');
    expect(bodies(hello.messages)).toEqual(['one', 'two']);
  });

  it('backfills a reconnecting client with only what it missed', async () => {
    const marc = await enter(group, 'Marc');
    const sam = await enter(group, 'Sam');
    open.push(marc, sam);
    const { rev } = await sam.next('hello');
    marc.say('before');
    const before = await sam.next('msg', (f) => f.message.body === 'before');

    marc.say('while sam was away');
    await marc.next('msg', (f) => f.message.body === 'while sam was away');

    const samAgain = await enter(group, 'Sam', sam.cookie, { after: before.message.seq, rev });
    open.push(samAgain);
    const hello = await samAgain.next('hello');
    expect(hello.fresh).toBe(false);
    expect(bodies(hello.messages)).toEqual(['while sam was away']);
  });

  it('archives every line to D1', async () => {
    const marc = await enter(group, 'Marc');
    open.push(marc);
    marc.say('for the record');
    await marc.next('msg', (f) => f.message.body === 'for the record');
    // The archive write happens after fan-out; give it a tick.
    await new Promise((r) => setTimeout(r, 50));

    const { results } = await env.DB.prepare(
      'SELECT kind, body, member_id FROM messages WHERE group_id = ? ORDER BY created_at',
    )
      .bind(group.id)
      .all<{ kind: string; body: string; member_id: string | null }>();
    expect(results.map((r) => [r.kind, r.body])).toEqual([['chat', 'for the record']]);
    expect(results[0]?.member_id).toBeTruthy();
  });

  it('rejects empty and oversized lines without echoing them', async () => {
    const marc = await enter(group, 'Marc');
    open.push(marc);
    await marc.next('hello');
    marc.say('   ');
    expect((await marc.next('error')).code).toBe('empty');
    marc.say('x'.repeat(2001));
    expect((await marc.next('error', (f) => f.code === 'too_long')).code).toBe('too_long');
    marc.ws.send('not json');
    expect((await marc.next('error', (f) => f.code === 'bad_frame')).code).toBe('bad_frame');
    expect(marc.frames.filter((f) => f.t === 'msg' && f.message.kind === 'chat')).toHaveLength(0);
  });

  it('names the line a refusal is about, and names nothing when there is none', async () => {
    // The outbox drops the line an error is ABOUT. Every frame a dad can send
    // is refused with the same handful of codes, so without a name on the
    // refusal the client had to guess the oldest line still in flight — and a
    // refused EDIT then threw away a perfectly good chat line that would have
    // gone through on the next try.
    const marc = await enter(group, 'Marc');
    open.push(marc);
    await marc.next('hello');

    marc.say('x'.repeat(2001), 'c-too-long');
    const refused = await marc.next('error', (f) => f.code === 'too_long');
    expect(refused.cid).toBe('c-too-long');

    marc.say('a line worth keeping', 'c-good');
    const good = await marc.next('msg', (f) => f.cid === 'c-good');

    // An edit the room will not take is not about any line in the outbox.
    marc.edit(good.message.id, 'y'.repeat(2001));
    const editRefused = await marc.next(
      'error',
      (f) => f.code === 'too_long' && f.cid === undefined,
    );
    expect(editRefused.cid).toBeUndefined();
  });

  it('relays typing to the others, not to the typist', async () => {
    const marc = await enter(group, 'Marc');
    const sam = await enter(group, 'Sam');
    open.push(marc, sam);
    await sam.next('hello');
    marc.ws.send(JSON.stringify({ t: 'typing' }));
    const typing = await sam.next('typing');
    expect(typing.name).toBe('Marc');
    await new Promise((r) => setTimeout(r, 30));
    expect(marc.frames.some((f) => f.t === 'typing')).toBe(false);
  });

  /**
   * The DO and the tests share one isolate, so faking Date moves the DO's
   * clock too. Only Date is faked: the frame-wait timeouts above must stay real.
   * runDurableObjectAlarm fires the handler now; the leave is due 15s from
   * now, so "now" has to move first.
   */
  async function graceWindowPasses() {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 16_000);
    try {
      const stub = env.ROOM.get(env.ROOM.idFromName(group.id));
      return await runDurableObjectAlarm(stub);
    } finally {
      vi.useRealTimers();
    }
  }

  /** Comings and goings, oldest first, as "<name> <in|out>". */
  async function presence(groupId: string): Promise<string[]> {
    // The write happens after the roster has gone out; give it a tick.
    await new Promise((r) => setTimeout(r, 50));
    const { results } = await env.DB.prepare(
      'SELECT name, kind FROM presence WHERE group_id = ? ORDER BY created_at, rowid',
    )
      .bind(groupId)
      .all<{ name: string; kind: string }>();
    return results.map((r) => `${r.name} ${r.kind}`);
  }

  /** Every line a dad has seen, backfill and live alike. */
  function seen(dad: Dad): string[] {
    return dad.frames.flatMap((f) =>
      f.t === 'hello' ? bodies(f.messages) : f.t === 'msg' ? [f.message.body] : [],
    );
  }

  it('does not record a dad leaving until the grace window has passed', async () => {
    const marc = await enter(group, 'Marc');
    const sam = await enter(group, 'Sam');
    open.push(sam);
    await sam.next('roster', (f) => f.roster.length === 2);

    marc.close();
    const roster = await sam.next('roster', (f) => f.roster.length === 1);
    expect(roster.roster.map((r) => r.name)).toEqual(['Sam']);
    expect(await presence(group.id)).not.toContain('Marc out');

    // Firing the alarm early changes nothing: the leave is not yet due.
    const stub = env.ROOM.get(env.ROOM.idFromName(group.id));
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(await presence(group.id)).not.toContain('Marc out');

    expect(await graceWindowPasses()).toBe(true);
    expect(await presence(group.id)).toContain('Marc out');
    // And still nothing in the conversation about it.
    expect(seen(sam).some((b) => b.includes('Marc'))).toBe(false);
  });

  it('treats a return within the grace window as never having left', async () => {
    const marc = await enter(group, 'Marc');
    const sam = await enter(group, 'Sam');
    open.push(sam);
    await sam.next('roster', (f) => f.roster.length === 2);

    marc.close();
    await sam.next('roster', (f) => f.roster.length === 1);
    const back = await enter(group, 'Marc', marc.cookie);
    open.push(back);
    await sam.next('roster', (f) => f.roster.length === 2);

    // Nothing pending, so no alarm to run.
    expect(await graceWindowPasses()).toBe(false);
    // One arrival each, no departure: as far as the room is concerned Marc
    // never went.
    expect(await presence(group.id)).toEqual(['Marc in', 'Sam in']);
  });

  it('keeps groups apart', async () => {
    const other = await seedGroup({ name: 'Other Dads' });
    const marc = await enter(group, 'Marc');
    const stranger = await enter(other, 'Stranger');
    open.push(marc, stranger);
    await stranger.next('hello');
    marc.say('just us');
    await marc.next('msg', (f) => f.message.body === 'just us');
    await new Promise((r) => setTimeout(r, 30));
    expect(stranger.frames.some((f) => f.t === 'msg' && f.message.body === 'just us')).toBe(false);
    expect((await stranger.next('hello')).roster.map((r) => r.name)).toEqual(['Stranger']);
  });
  describe('answering a line', () => {
    it('carries a quote that outlives an edit and goes when the line is taken back', async () => {
      const marc = await enter(group, 'Marc');
      const sam = await enter(group, 'Sam');
      open.push(marc, sam);
      marc.say('anyone up for Thursday');
      const asked = await sam.next('msg', (f) => f.message.body === 'anyone up for Thursday');

      sam.reply('count me in', asked.message.id);
      const answer = await marc.next('msg', (f) => f.message.body === 'count me in');
      expect(answer.message.reply).toEqual({
        id: asked.message.id,
        name: 'Marc',
        body: 'anyone up for Thursday',
      });

      // The archive has it, as a snapshot.
      const row = await env.DB.prepare('SELECT reply FROM messages WHERE id = ?')
        .bind(answer.message.id)
        .first<{ reply: string }>();
      expect(JSON.parse(row!.reply)).toMatchObject({ name: 'Marc' });

      // Changing the original does not change the quote. That is the whole
      // point of a snapshot: it says what he was answering.
      marc.edit(asked.message.id, 'anyone up for Friday');
      await sam.next('edited', (f) => f.id === asked.message.id);
      const dave = await enter(group, 'Dave');
      open.push(dave);
      const stillThere = (await dave.next('hello')).messages.find(
        (m) => m.id === answer.message.id,
      );
      expect(stillThere?.reply?.body).toBe('anyone up for Thursday');

      // Taking it BACK does take the quote, and that is the one case where
      // surviving would be wrong: the words would be on everyone's screen
      // again, under somebody's answer. The answer keeps his own words.
      marc.retract(asked.message.id);
      await sam.next('gone', (f) => f.id === asked.message.id);
      await until(async () => {
        const after = await env.DB.prepare('SELECT reply FROM messages WHERE id = ?')
          .bind(answer.message.id)
          .first<{ reply: string | null }>();
        return after?.reply === null;
      });

      // And the room's own tail agrees, so a reload does too.
      const eddie = await enter(group, 'Eddie');
      open.push(eddie);
      const backfilled = (await eddie.next('hello')).messages.find(
        (m) => m.id === answer.message.id,
      );
      expect(backfilled).toBeDefined();
      expect(backfilled?.reply ?? null).toBeNull();
      expect(backfilled?.body).toBe('count me in');
    });

    it('quotes only what a dad typed, cut down, and posts without a quote it cannot find', async () => {
      const marc = await enter(group, 'Marc');
      open.push(marc);
      const long = 'x'.repeat(300);
      marc.say(long);
      const said = await marc.next('msg', (f) => f.message.body === long);

      marc.reply('short answer', said.message.id);
      const cut = await marc.next('msg', (f) => f.message.body === 'short answer');
      expect([...cut.message.reply!.body].length).toBe(140);
      expect(cut.message.reply!.body.endsWith('…')).toBe(true);

      // An id that is nothing: the line still posts, with no quote.
      marc.reply('to nobody', 'msg_does_not_exist');
      const alone = await marc.next('msg', (f) => f.message.body === 'to nobody');
      expect(alone.message.reply ?? null).toBeNull();

      // The room's own line is a fact, not a quote.
      const system = marc.frames.find((f) => f.t === 'hello');
      expect(system).toBeTruthy();
    });
  });

  describe('changing a line', () => {
    it('changes the words for everyone, in the tail and in the archive', async () => {
      const marc = await enter(group, 'Marc');
      const sam = await enter(group, 'Sam');
      open.push(marc, sam);
      marc.say('see you at nien');
      const posted = await sam.next('msg', (f) => f.message.body === 'see you at nien');
      const id = posted.message.id;

      marc.edit(id, 'see you at nine');
      const told = await sam.next('edited', (f) => f.id === id);
      expect(told.body).toBe('see you at nine');
      expect(told.editedAt).toBeGreaterThan(0);
      // The editor too: nothing here is optimistic.
      await marc.next('edited', (f) => f.id === id);

      await until(async () => {
        const row = await env.DB.prepare('SELECT body, edited_at FROM messages WHERE id = ?')
          .bind(id)
          .first<{ body: string; edited_at: number | null }>();
        return row?.body === 'see you at nine' && row.edited_at !== null;
      });

      // And the next dad through the door gets the new words, marked.
      const dave = await enter(group, 'Dave');
      open.push(dave);
      const line = (await dave.next('hello')).messages.find((m) => m.id === id);
      expect(line?.body).toBe('see you at nine');
      expect(line?.editedAt).toBe(told.editedAt);
    });

    it('is his own to change and nobody else’s, and never to nothing', async () => {
      const marc = await enter(group, 'Marc');
      const sam = await enter(group, 'Sam');
      open.push(marc, sam);
      marc.say('as typed');
      const posted = await sam.next('msg', (f) => f.message.body === 'as typed');

      sam.edit(posted.message.id, 'as rewritten by Sam');
      marc.edit(posted.message.id, '   ');
      const refused = await marc.next('error', (f) => f.code === 'empty');
      expect(refused.code).toBe('empty');
      expect(sam.frames.some((f) => f.t === 'edited')).toBe(false);
      const row = await env.DB.prepare('SELECT body FROM messages WHERE id = ?')
        .bind(posted.message.id)
        .first<{ body: string }>();
      expect(row?.body).toBe('as typed');
    });
  });

  describe('taking a line back', () => {
    it('takes it from the room, from everyone, and from the archive', async () => {
      const marc = await enter(group, 'Marc');
      const sam = await enter(group, 'Sam');
      open.push(marc, sam);
      marc.say('wrong room, sorry');
      const posted = await sam.next('msg', (f) => f.message.body === 'wrong room, sorry');
      const id = posted.message.id;

      marc.retract(id);
      // Everyone is told, including the man who did it: nothing is optimistic
      // here, because a line that vanished locally and survived on the wire
      // would be the worst possible lie for this particular feature.
      expect((await sam.next('gone', (f) => f.id === id)).id).toBe(id);
      await marc.next('gone', (f) => f.id === id);

      const row = await env.DB.prepare('SELECT id FROM messages WHERE id = ?').bind(id).first();
      expect(row).toBeNull();

      // And it is not in what the next dad is handed on his way in.
      const dave = await enter(group, 'Dave');
      open.push(dave);
      expect(bodies((await dave.next('hello')).messages)).not.toContain('wrong room, sorry');
    });

    it('is his own to take back and nobody else’s', async () => {
      const marc = await enter(group, 'Marc');
      const sam = await enter(group, 'Sam');
      open.push(marc, sam);
      marc.say('this one stays');
      const posted = await sam.next('msg', (f) => f.message.body === 'this one stays');

      sam.retract(posted.message.id);
      await new Promise((r) => setTimeout(r, 80));
      expect(sam.frames.some((f) => f.t === 'gone')).toBe(false);
      const row = await env.DB.prepare('SELECT id FROM messages WHERE id = ?')
        .bind(posted.message.id)
        .first();
      expect(row).not.toBeNull();
    });

    /**
     * Sam is here, goes quiet, and comes back from where he left off — his
     * last line AND the last change he heard of. Everything that happens to
     * a line he already holds has to reach him on the hello, because none of
     * it moves a line's seq and the backfill never mentions it.
     */
    async function samLeaves(): Promise<{ sam: Dad; resume: Resume }> {
      const sam = await enter(group, 'Sam');
      const hello = await sam.next('hello');
      const after = hello.messages.at(-1)?.seq ?? 0;
      sam.close();
      await new Promise((r) => setTimeout(r, 30));
      return { sam, resume: { after, rev: hello.rev } };
    }

    it('tells a socket that resumed about a line taken back', async () => {
      const marc = await enter(group, 'Marc');
      open.push(marc);
      marc.say('said and regretted');
      const posted = await marc.next('msg', (f) => f.message.body === 'said and regretted');

      const { sam, resume } = await samLeaves();
      marc.retract(posted.message.id);
      await marc.next('gone');

      const back = await enter(group, 'Sam', sam.cookie, resume);
      open.push(back);
      const hello = await back.next('hello');
      // He is holding it from before, so the room has to say so; a reload
      // would have needed nothing, because the tail no longer has it.
      expect(hello.fresh).toBe(false);
      expect(hello.gone).toEqual([posted.message.id]);
      // A line taken back is gone, not changed, whatever happened before.
      expect(hello.changed).toEqual([]);
    });

    it('tells a socket that resumed about words changed and marks put on', async () => {
      const marc = await enter(group, 'Marc');
      open.push(marc);
      marc.say('see you at eight');
      const posted = await marc.next('msg', (f) => f.message.body === 'see you at eight');
      const id = posted.message.id;

      const { sam, resume } = await samLeaves();
      marc.edit(id, 'see you at nine');
      await marc.next('edited', (f) => f.id === id);
      marc.react(id, '👍', true);
      await marc.next('reacted', (f) => f.id === id && f.reactions.length === 1);

      const back = await enter(group, 'Sam', sam.cookie, resume);
      open.push(back);
      const hello = await back.next('hello');
      // One entry for the line, as it is NOW — not one per thing that happened.
      expect(hello.changed).toEqual([
        {
          id,
          body: 'see you at nine',
          editedAt: expect.any(Number),
          reactions: [{ emoji: '👍', by: [expect.any(String)] }],
        },
      ]);
      expect(hello.rev).toBeGreaterThan(resume.rev!);
    });

    it('tells a socket that resumed about pictures pruned off the shelf', async () => {
      const marc = await enter(group, 'Marc');
      open.push(marc);
      // A line first: a screen with nothing on it has nothing to resume.
      marc.say('a photo went up');
      await marc.next('msg', (f) => f.message.body === 'a photo went up');
      const { sam, resume } = await samLeaves();

      // What the upload route does after a prune: the room tells whoever is
      // open, and remembers it for whoever resumes.
      const room = env.ROOM.get(env.ROOM.idFromName(group.id));
      await room.fetch('https://room/unshelved', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Dads-Group-Id': group.id },
        body: JSON.stringify({ mediaIds: ['med_gone'] }),
      });
      const live = await marc.next('unshelved');
      expect(live.mediaIds).toEqual(['med_gone']);

      const back = await enter(group, 'Sam', sam.cookie, resume);
      open.push(back);
      const hello = await back.next('hello');
      expect(hello.media).toEqual([{ mediaId: 'med_gone', kept: null }]);
    });

    it('says nothing on a resume where nothing happened', async () => {
      const marc = await enter(group, 'Marc');
      open.push(marc);
      marc.say('a quiet one');
      await marc.next('msg', (f) => f.message.body === 'a quiet one');

      const { sam, resume } = await samLeaves();
      const back = await enter(group, 'Sam', sam.cookie, resume);
      open.push(back);
      const hello = await back.next('hello');
      expect(hello.fresh).toBe(false);
      expect(hello.messages).toEqual([]);
      expect(hello.gone).toEqual([]);
      expect(hello.changed).toEqual([]);
      expect(hello.media).toEqual([]);
    });

    it('hands a fresh backfill to a resume it cannot vouch for', async () => {
      const marc = await enter(group, 'Marc');
      open.push(marc);
      marc.say('the whole truth');
      const posted = await marc.next('msg', (f) => f.message.body === 'the whole truth');
      const after = posted.message.seq;

      // No rev at all: a build from before there was one. The room cannot say
      // what happened to the lines it holds, so it replaces them.
      const old = await enter(group, 'Sam', undefined, { after });
      open.push(old);
      const oldHello = await old.next('hello');
      expect(oldHello.fresh).toBe(true);
      expect(bodies(oldHello.messages)).toContain('the whole truth');

      // A rev ahead of anything this room ever numbered: storage lost, or a
      // number from another room. The same answer.
      const ahead = await enter(group, 'Sam', old.cookie, { after, rev: 999_999 });
      open.push(ahead);
      expect((await ahead.next('hello')).fresh).toBe(true);
    });

    it('stamps every change with a rising rev, on the frame and the next hello', async () => {
      const marc = await enter(group, 'Marc');
      open.push(marc);
      const first = await marc.next('hello');
      marc.say('count me');
      const posted = await marc.next('msg', (f) => f.message.body === 'count me');
      marc.react(posted.message.id, '😂', true);
      const marked = await marc.next('reacted', (f) => f.id === posted.message.id);
      marc.edit(posted.message.id, 'count me twice');
      const edited = await marc.next('edited', (f) => f.id === posted.message.id);
      expect(marked.rev).toBeGreaterThan(first.rev);
      expect(edited.rev).toBeGreaterThan(marked.rev);

      const later = await enter(group, 'Marc', marc.cookie);
      open.push(later);
      expect((await later.next('hello')).rev).toBe(edited.rev);
    });
  });
  describe('marks on a line', () => {
    it('is one tap, shared with everyone, and pressing it again takes it off', async () => {
      const marc = await enter(group, 'Marc');
      const sam = await enter(group, 'Sam');
      open.push(marc, sam);
      marc.say('bedtime was a war');
      const posted = await sam.next('msg', (f) => f.message.body === 'bedtime was a war');
      const id = posted.message.id;
      await new Promise((r) => setTimeout(r, 50));

      sam.react(id, '👍', true);
      const on = await marc.next('reacted', (f) => f.id === id);
      expect(on.reactions).toEqual([{ emoji: '👍', by: [expect.any(String)] }]);

      sam.react(id, '👍', false);
      const off = await marc.next('reacted', (f) => f.id === id && f.reactions.length === 0);
      expect(off.reactions).toEqual([]);
    });

    it('takes any mark on the list, and refuses anything off it', async () => {
      const marc = await enter(group, 'Marc');
      open.push(marc);
      marc.say('a line');
      const posted = await marc.next('msg', (f) => f.message.body === 'a line');
      await new Promise((r) => setTimeout(r, 50));

      // A browser is not a place arbitrary text becomes a column value.
      marc.react(posted.message.id, '<script>', true);
      marc.react(posted.message.id, '🦄', true);
      await new Promise((r) => setTimeout(r, 80));
      expect(marc.frames.some((f) => f.t === 'reacted')).toBe(false);

      // Past the six a row shows, the "+" offers the rest of the list, and the
      // room takes those too.
      marc.react(posted.message.id, '🔥', true);
      const fire = await marc.next('reacted', (f) => f.id === posted.message.id);
      expect(fire.reactions).toEqual([{ emoji: '🔥', by: [expect.any(String)] }]);
    });

    it('comes back with the line on a fresh backfill', async () => {
      const marc = await enter(group, 'Marc');
      open.push(marc);
      marc.say('worth a mark');
      const posted = await marc.next('msg', (f) => f.message.body === 'worth a mark');
      await new Promise((r) => setTimeout(r, 50));
      marc.react(posted.message.id, '💪', true);
      await marc.next('reacted');

      const sam = await enter(group, 'Sam');
      open.push(sam);
      const hello = await sam.next('hello');
      const line = hello.messages.find((m) => m.body === 'worth a mark');
      expect(line?.reactions).toEqual([{ emoji: '💪', by: [expect.any(String)] }]);
    });

    it('goes with the line when the line is taken back', async () => {
      const marc = await enter(group, 'Marc');
      open.push(marc);
      marc.say('this is going');
      const posted = await marc.next('msg', (f) => f.message.body === 'this is going');
      await new Promise((r) => setTimeout(r, 50));
      marc.react(posted.message.id, '🙏', true);
      await marc.next('reacted');

      marc.retract(posted.message.id);
      await marc.next('gone');
      const { results } = await env.DB.prepare('SELECT emoji FROM reactions WHERE message_id = ?')
        .bind(posted.message.id)
        .all();
      // The cascade on message_id is what does this, not the retract path.
      expect(results).toEqual([]);
    });
  });
});
