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
import { cookieFrom, postJoin, resetTables, seedGroup, type SeededGroup } from './helpers';

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
 * Waits for a frame to arrive rather than guessing how long it takes.
 *
 * A fixed settle() before an assertion is a race, and under a full suite the
 * machine loses it in a different file every time. Counted in tries rather
 * than against the clock because this file fakes Date.
 */
async function until(done: () => boolean, tries = 200): Promise<void> {
  for (let i = 0; i < tries && !done(); i++) await settle(10);
  expect(done()).toBe(true);
}

async function enter(group: SeededGroup, name: string): Promise<Dad> {
  const cookie = cookieFrom(await worker.fetch(postJoin({ code: group.code, displayName: name })));
  const res = await worker.fetch('https://dads.test/ws', {
    headers: { Upgrade: 'websocket', Cookie: cookie },
  });
  expect(res.status).toBe(101);
  return new Dad(res.webSocket!, cookie);
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

  it('relays what the table said to everyone', async () => {
    const marc = await enter(group, 'Marc');
    const sam = await enter(group, 'Sam');
    open.push(marc, sam);
    await settle();

    marc.table({ v: 1, t: 'seated', name: 'Marc' });
    await until(() => sam.lines().includes('Marc sat down at the table.'));
    const kind = sam.frames.find(
      (f) => f.t === 'msg' && f.message.body === 'Marc sat down at the table.',
    );
    expect(kind?.t === 'msg' && kind.message.kind).toBe('table');
  });

  it('says it once even though every framed dad relays it', async () => {
    const marc = await enter(group, 'Marc');
    const sam = await enter(group, 'Sam');
    open.push(marc, sam);
    await settle();

    // Both browsers have the table open, so both hear jaffre say the same thing.
    marc.table({ v: 1, t: 'game-started' });
    sam.table({ v: 1, t: 'game-started' });
    await settle(150);

    const said = sam.lines().filter((b) => b === 'A game started at the table.');
    expect(said).toHaveLength(1);
  });

  it('says nothing at all about plumbing', async () => {
    const marc = await enter(group, 'Marc');
    open.push(marc);
    await settle();
    marc.table({ v: 1, t: 'ready' });
    await settle(120);
    expect(marc.lines().some((b) => b.includes('ready'))).toBe(false);
  });

  it('keeps the quiet seats out of the conversation', async () => {
    const marc = await enter(group, 'Marc');
    open.push(marc);
    await settle();
    marc.table({ v: 1, t: 'turn', name: 'Marc', seconds: 20 });
    marc.table({ v: 1, t: 'away', name: 'Sam', seconds: 45 });
    marc.table({ v: 1, t: 'back', name: 'Sam' });
    marc.table({ v: 1, t: 'connection', state: 'reconnecting' });
    await settle(150);
    expect(marc.lines()).toEqual([]);
  });

  it('ignores a frame it does not recognise instead of posting it', async () => {
    const marc = await enter(group, 'Marc');
    open.push(marc);
    await settle();
    const before = marc.lines().length;

    marc.table({ v: 1, t: 'seated', name: '' });
    marc.table({ v: 99, t: 'game-over', summary: 'hacked' });
    marc.ws.send(JSON.stringify({ t: 'table', event: { v: 1, t: 'game-over', summary: '' } }));
    await settle(150);

    expect(marc.lines()).toHaveLength(before);
  });

  it('archives a table line like any other', async () => {
    const marc = await enter(group, 'Marc');
    open.push(marc);
    await settle();
    marc.table({ v: 1, t: 'game-over', summary: '41-37' });
    await settle(150);

    const row = await env.DB.prepare(
      "SELECT kind, body FROM messages WHERE group_id = ? AND kind = 'table'",
    )
      .bind(group.id)
      .first<{ kind: string; body: string }>();
    expect(row?.body).toBe('Game over — 41-37');
  });
});
