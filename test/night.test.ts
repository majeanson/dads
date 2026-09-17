import { runDurableObjectAlarm } from 'cloudflare:test';
import { env, exports as workerExports } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { civilDayIn, nextStart, NIGHT_DURATION_MS, type DadNight } from '../src/shared/dadNight';
import { isoWeekIn, previousWeek } from '../src/shared/week';
import type { ServerFrame } from '../src/shared/protocol';
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

const THURSDAY_NIGHT: DadNight = { weekday: 4, time: '21:00', tz: 'America/Montreal' };
const OPEN = 'Dad night. The table’s open.';

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
  const dad = new Dad(res.webSocket!, cookie);
  await arrived(dad);
  return dad;
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

  it('moves an arranged evening to another date without making it weekly', async () => {
    const cookie = cookieFrom(
      await worker.fetch(postJoin({ code: group.code, displayName: 'Marc' })),
    );
    const put = (night: unknown) =>
      worker.fetch('https://dads.test/api/night', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ night }),
      });

    // 2026-09-24 is a Thursday, 2026-09-26 a Saturday. The weekday sent is
    // deliberately wrong both times: the server derives it from the date, so
    // the two halves of "Thursday the 24th" can never disagree.
    await put({ weekday: 0, time: '21:00', date: '2026-09-24' });
    const moved = await put({ weekday: 0, time: '20:30', date: '2026-09-26' });
    expect(moved.status).toBe(200);

    const me = await worker.fetch('https://dads.test/api/me', { headers: { Cookie: cookie } });
    const night = ((await me.json()) as { group: { dadNight: DadNight | null } }).group.dadNight;
    // Still an arranged evening, on the new date, with the new time — not a
    // standing Saturday, which is what editing it through the weekday
    // dropdown used to turn it into.
    expect(night?.date).toBe('2026-09-26');
    expect(night?.time).toBe('20:30');
    expect(night?.weekday).toBe(6);
  });

  it('calls an arranged evening off, and says which one', async () => {
    // Its own socket, closed at the end: this describe has no shared pool.
    // `enter` has already waited for the room to say hello.
    const sam = await enter(group, 'Sam');
    const cookie = cookieFrom(
      await worker.fetch(postJoin({ code: group.code, displayName: 'Marc' })),
    );
    const put = (night: unknown) =>
      worker.fetch('https://dads.test/api/night', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ night }),
      });

    const said = (kind: string) =>
      sam.frames.find((f) => f.t === 'msg' && f.message.said?.k === kind);

    await put({ weekday: 4, time: '21:00', date: '2026-09-24' });
    await until(() => said('night_set') !== undefined);

    expect((await put(null)).status).toBe(200);

    // Not "cleared dad night": four men arranged their week around this, and
    // the room says which evening is off and asks what follows from it.
    await until(() => said('night_off') !== undefined);
    const off = said('night_off');
    expect(off?.t === 'msg' ? off.message.said : null).toMatchObject({
      k: 'night_off',
      date: '2026-09-24',
    });

    // And the group is unstuck: no evening to come means the calendar is the
    // question again.
    const me = await worker.fetch('https://dads.test/api/me', { headers: { Cookie: cookie } });
    expect(
      ((await me.json()) as { group: { dadNight: DadNight | null } }).group.dadNight,
    ).toBeNull();

    sam.close();
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

    await worker.fetch('https://dads.test/api/night', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: marc.cookie },
      body: JSON.stringify({ night: THURSDAY_NIGHT }),
    });
    await until(() => sam.lines().includes('Marc set dad night to Thursdays at 21:00.'));
    const pushed = sam.frames.find((f) => f.t === 'night');
    expect(pushed).toEqual({ t: 'night', night: THURSDAY_NIGHT });

    marc.close();
    sam.close();
  });

  it('can be cleared', async () => {
    const withNight = await seedGroup({ night: THURSDAY_NIGHT });
    const marc = await enter(withNight, 'Marc');

    await worker.fetch('https://dads.test/api/night', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: marc.cookie },
      body: JSON.stringify({ night: null }),
    });
    await until(() => marc.lines().includes('Marc cleared dad night.'));
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

    // The alarm is armed, but for a few days' time.
    expect(await fireAlarm(group)).toBe(true);

    clockAt(start + 1000);
    expect(await fireAlarm(group)).toBe(true);
    await until(() => marc.lines().includes(OPEN));
    // One socket hears things in order, so a line from the early firing would
    // have landed ahead of this one. Exactly one is the proof there was none.
    expect(marc.lines().filter((b) => b === OPEN)).toHaveLength(1);
  });

  it('opens with what the week put up for it', async () => {
    const marc = await enter(group, 'Marc');
    open.push(marc);

    const who = await env.DB.prepare('SELECT id FROM members WHERE group_id = ?')
      .bind(group.id)
      .first<{ id: string }>();

    // Two things thought of during the week, filed against this evening.
    for (const body of ['Bedtime', 'The school thing']) {
      await env.DB.prepare(
        `INSERT INTO night_items (id, group_id, member_id, occurrence, body, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
        .bind(`item_${body}`, group.id, who!.id, start, body, Date.now())
        .run();
    }

    clockAt(start + 1000);
    expect(await fireAlarm(group)).toBe(true);

    // The count, not the list: the line is what makes a man open the sheet.
    await until(() => marc.lines().includes('Dad night. The table’s open — 2 things to get into.'));
  });

  it('nudges the day before without saying anything in the room', async () => {
    const marc = await enter(group, 'Marc');
    open.push(marc);

    // The reminder is its own timer on the same alarm. Firing it must not
    // open the night — a third kind sharing one alarm is exactly how the
    // start gets eaten.
    clockAt(start - 24 * 60 * 60 * 1000 + 1000);
    expect(await fireAlarm(group)).toBe(true);

    // And the night still opens at the hour it always did — once. A line from
    // the reminder would have arrived ahead of this one on the same socket.
    clockAt(start + 1000);
    expect(await fireAlarm(group)).toBe(true);
    await until(() => marc.lines().includes(OPEN));
    expect(marc.lines().filter((b) => b === OPEN)).toHaveLength(1);
  });

  it('closes the night with what the group actually did', async () => {
    const marc = await enter(group, 'Marc');
    const sam = await enter(group, 'Sam');
    open.push(marc, sam);

    clockAt(start + 1000);
    expect(await fireAlarm(group)).toBe(true);
    await until(() => marc.lines().includes(OPEN));

    clockAt(start + 60_000);
    marc.say('made it');
    sam.say('me too');
    marc.say('rough week');
    // The summary counts the ARCHIVE, so the three lines have to be in D1
    // before the alarm fires — not merely likely to be.
    await until(() => ['made it', 'me too', 'rough week'].every((l) => marc.lines().includes(l)));

    clockAt(start + NIGHT_DURATION_MS + 1000);
    expect(await fireAlarm(group)).toBe(true);
    await until(() => marc.lines().includes('Dad night done — 2 dads turned up, 3 lines.'));
  });

  it('carries the week: what is being tried, and how last week went', async () => {
    const marc = await enter(group, 'Marc');
    const sam = await enter(group, 'Sam');
    open.push(marc, sam);

    const members = (
      await env.DB.prepare('SELECT id FROM members WHERE group_id = ? ORDER BY joined_at')
        .bind(group.id)
        .all<{ id: string }>()
    ).results;
    const thisWeek = isoWeekIn(start, night.tz);
    const lastWeek = previousWeek(thisWeek);
    // This week: one thing being tried. Last week: two promised, one kept.
    for (const [id, memberId, week, outcome] of [
      ['c_now', members[0]!.id, thisWeek, 'pending'],
      ['c_then_marc', members[0]!.id, lastWeek, 'done'],
      ['c_then_sam', members[1]!.id, lastWeek, 'missed'],
    ] as const) {
      await env.DB.prepare(
        `INSERT INTO commitments (id, group_id, member_id, week, body, outcome, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(id, group.id, memberId, week, 'Bedtime', outcome, Date.now())
        .run();
    }

    clockAt(start + 1000);
    expect(await fireAlarm(group)).toBe(true);
    await until(() => marc.lines().includes(OPEN));
    clockAt(start + 60_000);
    marc.say('made it');
    await until(() => marc.lines().includes('made it'));

    clockAt(start + NIGHT_DURATION_MS + 1000);
    expect(await fireAlarm(group)).toBe(true);
    await until(() =>
      marc
        .lines()
        .includes(
          'Dad night done — one dad turned up, one line. One thing being tried this week, last week 1 of 2 kept.',
        ),
    );
  });

  it('says plainly when nobody came', async () => {
    const marc = await enter(group, 'Marc');
    open.push(marc);

    clockAt(start + 1000);
    await fireAlarm(group);
    await until(() => marc.lines().includes(OPEN));

    clockAt(start + NIGHT_DURATION_MS + 1000);
    await fireAlarm(group);
    await until(() => marc.lines().includes('Dad night done. Nobody made it this week.'));
  });

  it('arms the following week once a night has closed', async () => {
    const marc = await enter(group, 'Marc');
    open.push(marc);

    clockAt(start + 1000);
    await fireAlarm(group);
    await until(() => marc.lines().includes(OPEN));
    clockAt(start + NIGHT_DURATION_MS + 1000);
    await fireAlarm(group);
    await until(() => marc.lines().some((b) => b.startsWith('Dad night done')));

    // A week on, the next night opens without anyone reconnecting.
    clockAt(start + 7 * 86_400_000 + 1000);
    expect(await fireAlarm(group)).toBe(true);
    await until(() => marc.lines().filter((b) => b === OPEN).length === 2);
  });

  it('does nothing at all for a group with no night set', async () => {
    const quiet = await seedGroup();
    const marc = await enter(quiet, 'Marc');
    open.push(marc);
    // Nothing armed: no leave pending, no night.
    expect(await fireAlarm(quiet)).toBe(false);
  });
});

/**
 * A night arranged for one evening, rather than a standing slot.
 *
 * The same alarm and the same summary; the difference is what happens after.
 * A weekly night arms the following week and says nothing more. A one-off has
 * used itself up, so the room asks the question that has to be asked while
 * everybody is still there.
 */
describe('a night that happens once', () => {
  const ASK = 'That’s the night done. When’s the next one?';
  let group: SeededGroup;
  let night: DadNight;
  let start: number;
  const open: Dad[] = [];

  beforeEach(async () => {
    realClock();
    await resetTables();
    const upcoming = upcomingNight();
    start = upcoming.start;
    night = { ...upcoming.night, date: civilDayIn(start, upcoming.night.tz) };
    group = await seedGroup({ night });
  });

  afterEach(async () => {
    realClock();
    open.splice(0).forEach((d) => d.close());
    await settle();
  });

  it('opens and closes like any other, then asks when the next one is', async () => {
    const marc = await enter(group, 'Marc');
    open.push(marc);

    clockAt(start + 1000);
    expect(await fireAlarm(group)).toBe(true);
    await until(() => marc.lines().includes(OPEN));

    clockAt(start + 60_000);
    marc.say('made it');
    await until(() => marc.lines().includes('made it'));

    clockAt(start + NIGHT_DURATION_MS + 1000);
    expect(await fireAlarm(group)).toBe(true);
    await until(() => marc.lines().includes(ASK));
    // In that order: the evening is summed up, and only then is the next one
    // asked about. One socket hears things in order, so this is the proof.
    const said = marc.lines();
    expect(said.findIndex((b) => b.startsWith('Dad night done'))).toBeLessThan(said.indexOf(ASK));
  });

  it('arms nothing afterwards, because there is nothing left to arm', async () => {
    const marc = await enter(group, 'Marc');
    open.push(marc);

    clockAt(start + 1000);
    await fireAlarm(group);
    await until(() => marc.lines().includes(OPEN));
    clockAt(start + NIGHT_DURATION_MS + 1000);
    await fireAlarm(group);
    await until(() => marc.lines().includes(ASK));

    // A week on, a standing night would have opened again. This one is over.
    clockAt(start + 7 * 86_400_000 + 1000);
    expect(await fireAlarm(group)).toBe(false);
    expect(marc.lines().filter((b) => b === OPEN)).toHaveLength(1);
  });

  it('does not ask a group whose night comes round again', async () => {
    const weekly = await seedGroup({ night: { ...night, date: null } });
    const marc = await enter(weekly, 'Marc');
    open.push(marc);

    clockAt(start + 1000);
    await fireAlarm(weekly);
    await until(() => marc.lines().includes(OPEN));
    clockAt(start + NIGHT_DURATION_MS + 1000);
    await fireAlarm(weekly);
    // The summary is the sentinel: once it is back, anything the room was
    // going to say about the poll has already been and gone.
    await until(() => marc.lines().some((b) => b.startsWith('Dad night done')));
    expect(marc.lines()).not.toContain(ASK);
  });

  it('announces a date being locked in as a date, not as a standing night', async () => {
    const fresh = await seedGroup();
    const marc = await enter(fresh, 'Marc');
    open.push(marc);

    const day = civilDayIn(Date.now() + 9 * 86_400_000, 'America/Montreal');
    const res = await worker.fetch('https://dads.test/api/poll/pick', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: marc.cookie },
      body: JSON.stringify({ day, time: '20:30' }),
    });
    expect(res.status).toBe(200);

    await until(() => marc.lines().some((b) => b.startsWith('Marc locked in ')));
    expect(marc.lines().some((b) => b.includes('set dad night to'))).toBe(false);
    // And every open socket is handed the new night without a reload.
    const pushed = marc.frames.filter((f) => f.t === 'night').at(-1);
    expect(pushed).toMatchObject({ t: 'night', night: { date: day, time: '20:30' } });
  });
});
