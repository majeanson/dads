import { runDurableObjectAlarm } from 'cloudflare:test';
import { env, exports as workerExports } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextStart, NIGHT_DURATION_MS, type DadNight } from '../src/shared/dadNight';
import type { ServerFrame } from '../src/shared/protocol';
import { cookieFrom, postJoin, resetTables, seedGroup, type SeededGroup } from './helpers';

const worker = workerExports.default;

const THURSDAY_NIGHT: DadNight = { weekday: 4, time: '21:00', tz: 'America/Montreal' };

/**
 * A night whose next occurrence is a few real days away.
 *
 * Alarm times must be in the REAL future. Faking Date moves what this isolate
 * reads, but not workerd's alarm scheduler: an alarm armed at a past real
 * instant fires at once, re-arms itself from the faked clock, and spins. So
 * the schedule is anchored to real time and only the moment of firing is
 * faked.
 */
function upcomingNight(): { night: DadNight; start: number } {
  const now = Date.now();
  for (let weekday = 0; weekday < 7; weekday++) {
    const night: DadNight = { weekday, time: '21:00', tz: 'America/Montreal' };
    const start = nextStart(night, now)!;
    const days = (start - now) / 86_400_000;
    if (days > 2 && days < 5) return { night, start };
  }
  throw new Error('no candidate night');
}

/**
 * Moves the clock everything in this isolate reads — the Durable Object
 * included. Only Date is faked: the settle helper below needs real timers.
 */
function clockAt(ts: number): void {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(ts);
}
function realClock(): void {
  vi.useRealTimers();
}

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
  say(body: string) {
    this.ws.send(JSON.stringify({ t: 'chat', body }));
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

async function enter(group: SeededGroup, name: string, cookie?: string): Promise<Dad> {
  if (!cookie) {
    cookie = cookieFrom(await worker.fetch(postJoin({ code: group.code, displayName: name })));
  }
  const res = await worker.fetch('https://dads.test/ws', {
    headers: { Upgrade: 'websocket', Cookie: cookie },
  });
  expect(res.status).toBe(101);
  return new Dad(res.webSocket!, cookie);
}

/**
 * Lets queued microtasks and socket deliveries land. Only Date is faked, so
 * setTimeout here is the real one and this must not touch the clock — an
 * earlier version reinstalled fake timers afterwards, which silently reset the
 * system time to now and made a March alarm look long overdue.
 */
function settle(ms = 40): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function fireAlarm(group: SeededGroup): Promise<boolean> {
  return runDurableObjectAlarm(env.ROOM.get(env.ROOM.idFromName(group.id)));
}

describe('PUT /api/night', () => {
  let group: SeededGroup;
  beforeEach(async () => {
    realClock();
    await resetTables();
    group = await seedGroup();
  });

  it('refuses a stranger', async () => {
    const res = await worker.fetch('https://dads.test/api/night', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ night: THURSDAY_NIGHT }),
    });
    expect(res.status).toBe(401);
  });

  it('stores a night and hands it back on /api/me', async () => {
    const cookie = cookieFrom(
      await worker.fetch(postJoin({ code: group.code, displayName: 'Marc' })),
    );

    const res = await worker.fetch('https://dads.test/api/night', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ night: THURSDAY_NIGHT }),
    });
    expect(res.status).toBe(200);

    const me = await worker.fetch('https://dads.test/api/me', { headers: { Cookie: cookie } });
    const body = (await me.json()) as { group: { dadNight: DadNight | null } };
    expect(body.group.dadNight).toEqual(THURSDAY_NIGHT);
  });

  it('rejects a night that could not happen', async () => {
    const cookie = cookieFrom(
      await worker.fetch(postJoin({ code: group.code, displayName: 'Marc' })),
    );
    const put = (night: unknown) =>
      worker.fetch('https://dads.test/api/night', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ night }),
      });

    expect((await put({ ...THURSDAY_NIGHT, weekday: 7 })).status).toBe(400);
    expect((await put({ ...THURSDAY_NIGHT, time: '9pm' })).status).toBe(400);
    expect((await put({ ...THURSDAY_NIGHT, tz: 'Mars/Olympus' })).status).toBe(400);

    const me = await worker.fetch('https://dads.test/api/me', { headers: { Cookie: cookie } });
    expect(((await me.json()) as { group: { dadNight: unknown } }).group.dadNight).toBeNull();
  });

  it('tells the room who changed it, and pushes it to open sockets', async () => {
    const marc = await enter(group, 'Marc');
    const sam = await enter(group, 'Sam');
    await settle();

    await worker.fetch('https://dads.test/api/night', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: marc.cookie },
      body: JSON.stringify({ night: THURSDAY_NIGHT }),
    });
    await settle();

    expect(sam.lines()).toContain('Marc set dad night to Thursdays at 21:00.');
    const pushed = sam.frames.find((f) => f.t === 'night');
    expect(pushed).toEqual({ t: 'night', night: THURSDAY_NIGHT });

    marc.close();
    sam.close();
  });

  it('can be cleared', async () => {
    const withNight = await seedGroup({ night: THURSDAY_NIGHT });
    const marc = await enter(withNight, 'Marc');
    await settle();

    await worker.fetch('https://dads.test/api/night', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: marc.cookie },
      body: JSON.stringify({ night: null }),
    });
    await settle();

    expect(marc.lines()).toContain('Marc cleared dad night.');
    const me = await worker.fetch('https://dads.test/api/me', { headers: { Cookie: marc.cookie } });
    expect(((await me.json()) as { group: { dadNight: unknown } }).group.dadNight).toBeNull();
    marc.close();
  });
});

describe('the night itself', () => {
  let group: SeededGroup;
  let night: DadNight;
  let start: number;
  const open: Dad[] = [];

  beforeEach(async () => {
    realClock();
    await resetTables();
    ({ night, start } = upcomingNight());
    group = await seedGroup({ night });
  });

  afterEach(async () => {
    realClock();
    open.splice(0).forEach((d) => d.close());
    // Let any in-flight archive land before the next test drops the group.
    await settle();
  });

  it('opens the night at the appointed hour, not before', async () => {
    const marc = await enter(group, 'Marc');
    open.push(marc);
    await settle();

    // The alarm is armed, but for a few days' time.
    expect(await fireAlarm(group)).toBe(true);
    await settle();
    expect(marc.lines()).not.toContain("Dad night. The table's open.");

    clockAt(start + 1000);
    expect(await fireAlarm(group)).toBe(true);
    await settle();
    expect(marc.lines()).toContain("Dad night. The table's open.");
  });

  it('closes the night with what the group actually did', async () => {
    const marc = await enter(group, 'Marc');
    const sam = await enter(group, 'Sam');
    open.push(marc, sam);
    await settle();

    clockAt(start + 1000);
    expect(await fireAlarm(group)).toBe(true);
    await settle();

    clockAt(start + 60_000);
    marc.say('made it');
    sam.say('me too');
    marc.say('rough week');
    await settle(150);

    clockAt(start + NIGHT_DURATION_MS + 1000);
    expect(await fireAlarm(group)).toBe(true);
    await settle();

    expect(marc.lines()).toContain('Dad night done — 2 dads, 3 lines.');
  });

  it('says plainly when nobody came', async () => {
    const marc = await enter(group, 'Marc');
    open.push(marc);
    await settle();

    clockAt(start + 1000);
    await fireAlarm(group);
    await settle();

    clockAt(start + NIGHT_DURATION_MS + 1000);
    await fireAlarm(group);
    await settle();

    expect(marc.lines()).toContain('Dad night done. Nobody made it this week.');
  });

  it('arms the following week once a night has closed', async () => {
    const marc = await enter(group, 'Marc');
    open.push(marc);
    await settle();

    clockAt(start + 1000);
    await fireAlarm(group);
    await settle();
    clockAt(start + NIGHT_DURATION_MS + 1000);
    await fireAlarm(group);
    await settle();

    // A week on, the next night opens without anyone reconnecting.
    clockAt(start + 7 * 86_400_000 + 1000);
    expect(await fireAlarm(group)).toBe(true);
    await settle();

    expect(marc.lines().filter((b) => b === "Dad night. The table's open.")).toHaveLength(2);
  });

  it('does nothing at all for a group with no night set', async () => {
    const quiet = await seedGroup();
    const marc = await enter(quiet, 'Marc');
    open.push(marc);
    await settle();
    // Nothing armed: no leave pending, no night.
    expect(await fireAlarm(quiet)).toBe(false);
  });
});
