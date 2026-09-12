import { env, exports as workerExports } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ServerFrame } from '../src/shared/protocol';
import { isoWeekIn, previousWeek } from '../src/shared/week';
import { cookieFrom, postJoin, resetTables, seedGroup, type SeededGroup } from './helpers';

const worker = workerExports.default;

/**
 * GET /api/todo — what is waiting for THIS dad.
 *
 * It is the whole source of truth for the mark on the Menu button and for
 * home's waiting section, which are the two places the app ever asks a man to
 * go and do something. So the invariant that matters is not "is it true" but
 * "is it about him": a mark for a question somebody else has not answered is
 * a thing to tap until it goes away, and nothing is behind it.
 */
const settle = (ms = 80) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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
  answer(body: string) {
    this.ws.send(JSON.stringify({ t: 'prompt', body }));
  }
  close() {
    this.ws.close(1000, 'bye');
  }
}

async function enter(group: SeededGroup, name: string): Promise<Dad> {
  const cookie = cookieFrom(await worker.fetch(postJoin({ code: group.code, displayName: name })));
  const res = await worker.fetch('https://dads.test/ws', {
    headers: { Upgrade: 'websocket', Cookie: cookie },
  });
  expect(res.status).toBe(101);
  return new Dad(res.webSocket!, cookie);
}

function put(path: string, cookie: string, body: unknown) {
  return worker.fetch(`https://dads.test${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body),
  });
}

async function todo(cookie: string): Promise<{ prompt: boolean; board: boolean }> {
  const res = await worker.fetch('https://dads.test/api/todo', { headers: { Cookie: cookie } });
  expect(res.status).toBe(200);
  return (await res.json()) as { prompt: boolean; board: boolean };
}

describe('what is waiting', () => {
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

  it('is nobody’s business but the caller’s', async () => {
    expect((await worker.fetch('https://dads.test/api/todo')).status).toBe(401);
  });

  it('asks a dad who has just arrived for both', async () => {
    const marc = await enter(group, 'Marc');
    open.push(marc);
    expect(await todo(marc.cookie)).toEqual({ prompt: true, board: true });
  });

  it('stops asking for the question once HE has answered it', async () => {
    const marc = await enter(group, 'Marc');
    const sam = await enter(group, 'Sam');
    open.push(marc, sam);
    await settle();

    marc.answer('I shouted about shoes. It was not about shoes.');
    await settle(150);

    expect((await todo(marc.cookie)).prompt).toBe(false);
    // The one that would make the mark a lie: Sam has not answered, and
    // somebody else's answer must not take the question off his screen.
    expect((await todo(sam.cookie)).prompt).toBe(true);
  });

  it('stops asking for the week once he has checked in', async () => {
    const marc = await enter(group, 'Marc');
    const sam = await enter(group, 'Sam');
    open.push(marc, sam);

    expect((await put('/api/check-in', marc.cookie, { rating: 3, note: 'Steady.' })).status).toBe(
      200,
    );

    expect((await todo(marc.cookie)).board).toBe(false);
    expect((await todo(sam.cookie)).board).toBe(true);
  });

  it('asks again for a commitment last week that he never closed', async () => {
    const marc = await enter(group, 'Marc');
    open.push(marc);

    await put('/api/check-in', marc.cookie, { rating: 3, note: 'Steady.' });
    expect((await todo(marc.cookie)).board).toBe(false);

    // A promise made last week and never closed. `pending` scans
    // back through the shown weeks, so a fortnight away does not lose the
    // question — that is the case this pins.
    const last = previousWeek(isoWeekIn(Date.now(), 'America/Montreal'));
    await env.DB.prepare(
      `INSERT INTO commitments (id, group_id, member_id, week, body, outcome, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
    )
      .bind(
        `cmt_${Math.random().toString(36).slice(2, 10)}`,
        group.id,
        (
          await env.DB.prepare('SELECT id FROM members WHERE group_id = ? AND display_name = ?')
            .bind(group.id, 'Marc')
            .first<{ id: string }>()
        )?.id,
        last,
        'Phone in the drawer at six',
        Date.now(),
      )
      .run();

    expect((await todo(marc.cookie)).board).toBe(true);
  });

  it('does not invent a question for a group whose pool is empty', async () => {
    // A group with no prompt for today has nothing to answer, and a mark
    // pointing at an empty screen is worse than no mark.
    await env.DB.prepare('UPDATE prompts SET active = 0').run();
    try {
      const marc = await enter(group, 'Marc');
      open.push(marc);
      expect((await todo(marc.cookie)).prompt).toBe(false);
    } finally {
      await env.DB.prepare('UPDATE prompts SET active = 1').run();
    }
  });
});
