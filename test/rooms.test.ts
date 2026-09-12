import { env, exports as workerExports } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RoomsOpen, ServerFrame } from '../src/shared/protocol';
import { cookieFrom, postJoin, resetTables, seedGroup, type SeededGroup } from './helpers';

const worker = workerExports.default;

/**
 * PUT /api/rooms — what this group has open.
 *
 * Three switches that decide what every dad in the group can see, changeable
 * by any of them and by nobody else. It had no test at all, which for the one
 * route that can take a room away from four other men is the wrong amount.
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

function setRooms(cookie: string, body: unknown) {
  return worker.fetch('https://dads.test/api/rooms', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body),
  });
}

async function stored(group: SeededGroup) {
  return await env.DB.prepare('SELECT questions_on, week_on, table_on FROM groups WHERE id = ?')
    .bind(group.id)
    .first<{ questions_on: number; week_on: number; table_on: number }>();
}

describe('what the group has open', () => {
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

  it('is not a stranger’s to change', async () => {
    expect((await setRooms('', { questions: false })).status).toBe(401);
  });

  it('refuses a body that is not a body', async () => {
    const marc = await enter(group, 'Marc');
    open.push(marc);
    const res = await worker.fetch('https://dads.test/api/rooms', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: marc.cookie },
      body: 'not json',
    });
    expect(res.status).toBe(400);
  });

  it('changes only what was sent', async () => {
    const marc = await enter(group, 'Marc');
    open.push(marc);

    const res = await setRooms(marc.cookie, { week: false });
    expect(res.status).toBe(200);
    expect((await res.json<{ rooms: RoomsOpen }>()).rooms).toEqual({
      questions: true,
      week: false,
      table: true,
    });
    expect(await stored(group)).toEqual({ questions_on: 1, week_on: 0, table_on: 1 });
  });

  it('is the group’s, so any dad may change it and every dad sees it', async () => {
    const marc = await enter(group, 'Marc');
    const sam = await enter(group, 'Sam');
    open.push(marc, sam);
    await settle();

    // Sam, who set nothing up and is nobody's admin.
    expect((await setRooms(sam.cookie, { table: false })).status).toBe(200);
    await settle(120);

    // Marc finds out without a reload.
    const told = marc.frames.find((f) => f.t === 'rooms');
    expect(told).toBeTruthy();
    if (told?.t !== 'rooms') throw new Error('unreachable');
    expect(told.rooms.table).toBe(false);
  });

  it('will not take a junk value for a switch', async () => {
    const marc = await enter(group, 'Marc');
    open.push(marc);

    // A string is not a switch. It used to go straight into Number(), and a
    // NaN bound to D1 is a NULL rather than a nought — so the row's NOT NULL
    // constraint threw and the dad got a 500 with a stack behind it.
    for (const junk of [{ questions: 'off' }, { week: 0 }, { table: 'true' }, { questions: [] }]) {
      expect((await setRooms(marc.cookie, junk)).status, JSON.stringify(junk)).toBe(400);
    }

    // And nothing moved.
    expect(await stored(group)).toEqual({ questions_on: 1, week_on: 1, table_on: 1 });
  });

  it('takes an absent switch as leave it alone, and a false one as off', async () => {
    const marc = await enter(group, 'Marc');
    open.push(marc);

    await setRooms(marc.cookie, { questions: false });
    expect(await stored(group)).toEqual({ questions_on: 0, week_on: 1, table_on: 1 });

    // null is how a client says nothing rather than says off.
    await setRooms(marc.cookie, { questions: null, week: false });
    expect(await stored(group)).toEqual({ questions_on: 0, week_on: 0, table_on: 1 });
  });
});
