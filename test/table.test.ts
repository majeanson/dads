import { env, exports as workerExports } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  deriveTableCode,
  isValidTableCode,
  JAFFRE_ORIGIN,
  parseTableEvent,
  tableLink,
  tableSaid,
} from '../src/shared/jaffre';
import { englishOf } from '../src/shared/said';
import { parseClientFrame, type ServerFrame } from '../src/shared/protocol';
import { tableCodeFor } from '../src/worker/table';
import {
  arrived,
  until,
  cookieFrom,
  postJoin,
  resetTables,
  seedGroup,
  type SeededGroup,
} from './helpers';

const worker = workerExports.default;

class Dad {
  frames: ServerFrame[] = [];
  constructor(
    readonly ws: WebSocket,
    readonly cookie: string,
  ) {
    ws.accept();
    ws.addEventListener('message', (event) => {
      if (event.data === 'pong') return;
      this.frames.push(JSON.parse(event.data as string) as ServerFrame);
    });
  }
  table(event: unknown) {
    this.ws.send(JSON.stringify({ t: 'table', event }));
  }
  lines(): string[] {
    return this.frames.flatMap((f) =>
      f.t === 'hello' ? f.messages.map((m) => m.body) : f.t === 'msg' ? [f.message.body] : [],
    );
  }
  close() {
    this.ws.close(1000, 'bye');
  }
}

const settle = (ms = 60) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * A frame the room WILL say, sent after the ones it must not. One socket's
 * frames are handled in order, so once this line has come back the quiet
 * ones have been and gone — which is a proof, where a pause is a guess.
 */
/**
 * Proof that the quiet ones stayed quiet.
 *
 * A socket's frames are handled in order, so a line the room WILL answer,
 * sent after the ones it must not, is back only once they have been and gone.
 * It used to be a table event itself; the table writes no lines at all now,
 * so it is an ordinary chat line — which is the only kind there is.
 */
async function sentinel(dad: Dad): Promise<void> {
  dad.ws.send(JSON.stringify({ t: 'chat', body: 'sentinel' }));
  await until(() => dad.lines().includes('sentinel'));
}

async function enter(group: SeededGroup, name: string): Promise<Dad> {
  const cookie = cookieFrom(await worker.fetch(postJoin({ code: group.code, displayName: name })));
  const res = await worker.fetch('https://dads.test/ws', {
    headers: { Upgrade: 'websocket', Cookie: cookie },
  });
  expect(res.status).toBe(101);
  const dad = new Dad(res.webSocket!, cookie);
  await arrived(dad);
  return dad;
}

describe('table codes', () => {
  it('derives something jaffre will accept from a slug', () => {
    expect(deriveTableCode('the-dads')).toBe('the-dads');
    expect(deriveTableCode('The Dads!')).toBe('the-dads');
    expect(deriveTableCode('  spaced  out  ')).toBe('spaced-out');
    expect(deriveTableCode('a'.repeat(50))).toHaveLength(32);
  });

  it('never produces a code jaffre would reject', () => {
    for (const slug of ['---', '!!!', '', '  ', 'ok-1']) {
      expect(isValidTableCode(deriveTableCode(slug))).toBe(true);
    }
  });
});

describe('the link into jaffre', () => {
  it('goes straight to the hash route, carrying the name', () => {
    const { embedUrl, shareUrl } = tableLink('the-dads', 'Marc');
    // Not /join/<code>: that route rewrites the URL and drops the query with it.
    expect(embedUrl).toBe(`${JAFFRE_ORIGIN}/?name=Marc&from=dads#room/the-dads`);
    // The own-tab link says where the player came from so jaffre can offer the
    // way back, but leaves his jaffre name alone.
    expect(shareUrl).toBe(`${JAFFRE_ORIGIN}/?from=dads#room/the-dads`);
    expect(shareUrl).not.toContain('name=');
  });

  it('escapes a name that would otherwise break the URL', () => {
    const { embedUrl } = tableLink('the-dads', 'Marc & Sam');
    expect(embedUrl).toContain('name=Marc+%26+Sam');
    expect(new URL(embedUrl).searchParams.get('name')).toBe('Marc & Sam');
  });
});

describe('the bridge vocabulary', () => {
  it('accepts the shapes it knows', () => {
    expect(parseTableEvent({ v: 1, t: 'ready' })).toEqual({ v: 1, t: 'ready' });
    expect(parseTableEvent({ v: 1, t: 'seated', name: 'Marc' })).toEqual({
      v: 1,
      t: 'seated',
      name: 'Marc',
    });
    expect(parseTableEvent({ v: 1, t: 'game-over', summary: '41-37' })).toEqual({
      v: 1,
      t: 'game-over',
      summary: '41-37',
    });
  });

  it('drops anything else, including a wrong version', () => {
    for (const bad of [
      null,
      'nope',
      42,
      {},
      { t: 'seated', name: 'Marc' },
      { v: 2, t: 'seated', name: 'Marc' },
      { v: 1, t: 'seated' },
      { v: 1, t: 'seated', name: '   ' },
      { v: 1, t: 'seated', name: 7 },
      { v: 1, t: 'game-over' },
      { v: 1, t: 'made-up' },
    ]) {
      expect(parseTableEvent(bad)).toBeNull();
    }
  });

  it('truncates a field long enough to be a nuisance', () => {
    const parsed = parseTableEvent({ v: 1, t: 'seated', name: 'x'.repeat(500) });
    expect(parsed).not.toBeNull();
    expect((parsed as { name: string }).name).toHaveLength(120);
  });

  it('turns events into facts, and says nothing about plumbing', () => {
    expect(tableSaid({ v: 1, t: 'seated', name: 'Marc' })).toEqual({
      k: 'table_seated',
      name: 'Marc',
    });
    // The English of the fact is what the archive keeps.
    expect(englishOf(tableSaid({ v: 1, t: 'seated', name: 'Marc' })!)).toBe(
      'Marc sat down at the table.',
    );
    expect(englishOf(tableSaid({ v: 1, t: 'game-over', summary: '41-37' })!)).toBe(
      'Game over — 41-37',
    );
    // 'ready' is the frame proving the table is alive; nobody needs telling.
    expect(tableSaid({ v: 1, t: 'ready' })).toBeNull();
    // The quiet seats are said beside the frame and to the man, not to the room.
    expect(tableSaid({ v: 1, t: 'turn', name: 'Marc', seconds: 20 })).toBeNull();
    expect(tableSaid({ v: 1, t: 'away', name: 'Sam', seconds: 0 })).toBeNull();
    expect(tableSaid({ v: 1, t: 'connection', state: 'ok' })).toBeNull();
  });

  it('reads the quiet-seat vocabulary, and bounds the countdown', () => {
    expect(parseTableEvent({ v: 1, t: 'turn', name: 'Marc', seconds: 20 })).toEqual({
      v: 1,
      t: 'turn',
      name: 'Marc',
      seconds: 20,
    });
    expect(parseTableEvent({ v: 1, t: 'away', name: 'Sam', seconds: 99_999 })).toEqual({
      v: 1,
      t: 'away',
      name: 'Sam',
      seconds: 3600,
    });
    expect(parseTableEvent({ v: 1, t: 'back', name: 'Sam' })).toEqual({
      v: 1,
      t: 'back',
      name: 'Sam',
    });
    expect(parseTableEvent({ v: 1, t: 'connection', state: 'ok' })).toEqual({
      v: 1,
      t: 'connection',
      state: 'ok',
    });
    for (const bad of [
      { v: 1, t: 'turn', name: 'Marc' },
      { v: 1, t: 'turn', name: 'Marc', seconds: -1 },
      { v: 1, t: 'turn', name: 'Marc', seconds: 'soon' },
      { v: 1, t: 'away', seconds: 5 },
      { v: 1, t: 'connection', state: 'gone' },
    ]) {
      expect(parseTableEvent(bad)).toBeNull();
    }
  });

  it('validates the event when it arrives as a client frame', () => {
    expect(
      parseClientFrame(JSON.stringify({ t: 'table', event: { v: 1, t: 'game-started' } })),
    ).toEqual({ t: 'table', event: { v: 1, t: 'game-started' } });
    expect(
      parseClientFrame(JSON.stringify({ t: 'table', event: { v: 9, t: 'game-started' } })),
    ).toBeNull();
    expect(parseClientFrame(JSON.stringify({ t: 'table' }))).toBeNull();
  });
});

describe('GET /api/table', () => {
  let group: SeededGroup;
  beforeEach(async () => {
    await resetTables();
    group = await seedGroup({ slug: 'the-dads' });
  });

  it('refuses a stranger', async () => {
    expect((await worker.fetch('https://dads.test/api/table')).status).toBe(401);
  });

  it('mints the code once and keeps it', async () => {
    const cookie = cookieFrom(
      await worker.fetch(postJoin({ code: group.code, displayName: 'Marc' })),
    );
    const first = (await (
      await worker.fetch('https://dads.test/api/table', { headers: { Cookie: cookie } })
    ).json()) as { code: string; embedUrl: string };
    expect(first.code).toBe('the-dads');
    expect(first.embedUrl).toContain('name=Marc');

    const stored = await env.DB.prepare('SELECT jaffre_room_code FROM groups WHERE id = ?')
      .bind(group.id)
      .first<{ jaffre_room_code: string }>();
    expect(stored?.jaffre_room_code).toBe('the-dads');

    // Renaming the group must not move the table.
    await env.DB.prepare('UPDATE groups SET slug = ? WHERE id = ?')
      .bind('renamed-lot', group.id)
      .run();
    expect(await tableCodeFor(env, { id: group.id, slug: 'renamed-lot' })).toBe('the-dads');
  });

  it('gives each group its own table', async () => {
    const other = await seedGroup({ slug: 'other-dads' });
    expect(await tableCodeFor(env, other)).toBe('other-dads');
    expect(await tableCodeFor(env, group)).toBe('the-dads');
  });
});

describe('table events reaching the room', () => {
  let group: SeededGroup;
  const open: Dad[] = [];

  beforeEach(async () => {
    await resetTables();
    group = await seedGroup();
  });
  afterEach(async () => {
    open.splice(0).forEach((d) => d.close());
    await settle();
  });

  it('says nothing in the room, whatever the table does', async () => {
    /*
     * The table used to narrate itself into the conversation: who sat down,
     * who got up, a game starting, a game's final score. On an evening of
     * cards that is a line every couple of minutes, in the room where the
     * dads are trying to talk — and all of it is already on the table, which
     * is on the screen beside them.
     *
     * The frame still comes, and still does exactly one thing: a turn that
     * has sat for twenty seconds nudges the phone of the one dad it is about.
     */
    const marc = await enter(group, 'Marc');
    const sam = await enter(group, 'Sam');
    open.push(marc, sam);

    marc.table({ v: 1, t: 'seated', name: 'Marc' });
    marc.table({ v: 1, t: 'game-started' });
    sam.table({ v: 1, t: 'game-started' });
    marc.table({ v: 1, t: 'left', name: 'Marc' });
    marc.table({ v: 1, t: 'game-over', summary: '41-37' });
    marc.table({ v: 1, t: 'turn', name: 'Marc', seconds: 20 });
    marc.table({ v: 1, t: 'ready' });
    // Not even a shape it does not know.
    marc.ws.send(JSON.stringify({ t: 'table', event: { v: 99, t: 'game-over', summary: 'x' } }));

    await sentinel(sam);
    expect(sam.lines()).toEqual(['sentinel']);

    // And nothing reached the archive either, which is what a search would
    // have had to wade through.
    const rows = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM messages WHERE group_id = ? AND kind = 'table'",
    )
      .bind(group.id)
      .first<{ n: number }>();
    expect(rows?.n).toBe(0);
  });
});
