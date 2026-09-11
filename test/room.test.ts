import { runDurableObjectAlarm } from 'cloudflare:test';
import { env, exports as workerExports } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoomMessage, ServerFrame } from '../src/shared/protocol';
import { cookieFrom, postJoin, resetTables, seedGroup, type SeededGroup } from './helpers';

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

  retract(id: string) {
    this.ws.send(JSON.stringify({ t: 'retract', id }));
  }

  close() {
    this.ws.close(1000, 'bye');
  }
}

async function enter(group: SeededGroup, name: string, cookie?: string, after?: number) {
  if (!cookie)
    cookie = cookieFrom(await worker.fetch(postJoin({ code: group.code, displayName: name })));
  const url = `https://dads.test/ws${after ? `?after=${after}` : ''}`;
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
    marc.say('before');
    const before = await sam.next('msg', (f) => f.message.body === 'before');

    marc.say('while sam was away');
    await marc.next('msg', (f) => f.message.body === 'while sam was away');

    const samAgain = await enter(group, 'Sam', sam.cookie, before.message.seq);
    open.push(samAgain);
    const hello = await samAgain.next('hello');
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

    it('tells a socket that resumed rather than reloaded', async () => {
      const marc = await enter(group, 'Marc');
      open.push(marc);
      marc.say('said and regretted');
      const posted = await marc.next('msg', (f) => f.message.body === 'said and regretted');

      // Sam is here, goes quiet, and comes back from where he left off.
      const sam = await enter(group, 'Sam');
      await sam.next('hello');
      const at = posted.message.seq;
      sam.close();
      await new Promise((r) => setTimeout(r, 30));

      marc.retract(posted.message.id);
      await marc.next('gone');

      const back = await enter(group, 'Sam', sam.cookie, at);
      open.push(back);
      const hello = await back.next('hello');
      // He is holding it from before, so the room has to say so; a reload
      // would have needed nothing, because the tail no longer has it.
      expect(hello.gone).toContain(posted.message.id);
    });
  });
});
