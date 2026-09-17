import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { env, exports as workerExports } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { civilDayIn, nextStart, NIGHT_DURATION_MS, type DadNight } from '../src/shared/dadNight';
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

/**
 * What the object has queued.
 *
 * The room used to narrate its own timers — "the table's open", "that's the
 * night done" — and every test in here watched the schedule through those
 * lines. The conversation is what the dads typed now, so the tests read the
 * schedule itself, which is what the lines were standing in for and a
 * straighter thing to assert on.
 */
async function armed(group: SeededGroup): Promise<string[]> {
  return runInDurableObject(env.ROOM.get(env.ROOM.idFromName(group.id)), (_instance, state) =>
    state.storage.sql
      .exec<{ kind: string }>('SELECT kind FROM schedule ORDER BY kind')
      .toArray()
      .map((r) => r.kind),
  );
}

/**
 * Nothing was said but what he said himself.
 *
 * A socket's frames are handled in order, so a line the room WILL answer,
 * sent after the ones it must not, is back only once they have been and gone.
 */
async function quiet(dad: Dad, ...his: string[]): Promise<void> {
  dad.say('sentinel');
  await until(() => dad.lines().includes('sentinel'));
  expect(dad.lines()).toEqual([...his, 'sentinel']);
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

  it('calls an arranged evening off, and says nothing about it', async () => {
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

    await put({ weekday: 4, time: '21:00', date: '2026-09-24' });
    expect((await put(null)).status).toBe(200);

    // The group is unstuck, which is the whole point: no evening to come
    // means home and the sheet are the calendar again. Nothing was said in
    // the conversation about any of it — the state IS the news.
    const me = await worker.fetch('https://dads.test/api/me', { headers: { Cookie: cookie } });
    expect(
      ((await me.json()) as { group: { dadNight: DadNight | null } }).group.dadNight,
    ).toBeNull();
    await quiet(sam);

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

  it('pushes it to open sockets, and says nothing in the room', async () => {
    const marc = await enter(group, 'Marc');
    const sam = await enter(group, 'Sam');

    await worker.fetch('https://dads.test/api/night', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: marc.cookie },
      body: JSON.stringify({ night: THURSDAY_NIGHT }),
    });

    // Every open phone has the new night without a reload. That is what the
    // line used to be for, and the frame does it better: home shows the
    // night itself rather than a sentence about it having been set.
    await until(() => sam.frames.some((f) => f.t === 'night'));
    expect(sam.frames.find((f) => f.t === 'night')).toEqual({
      t: 'night',
      night: THURSDAY_NIGHT,
    });
    await quiet(sam);

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
    await until(() => marc.frames.some((f) => f.t === 'night' && f.night === null));
    const me = await worker.fetch('https://dads.test/api/me', { headers: { Cookie: marc.cookie } });
    expect(((await me.json()) as { group: { dadNight: unknown } }).group.dadNight).toBeNull();
    await quiet(marc);
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

    // Armed, but for a few days' time: firing early does nothing but re-arm.
    expect(await fireAlarm(group)).toBe(true);
    expect(await armed(group)).not.toContain('night_end');

    clockAt(start + 1000);
    expect(await fireAlarm(group)).toBe(true);
    // The evening is running, which is what the object knows and what the
    // line used to say: its end is queued.
    await until(async () => (await armed(group)).includes('night_end'));
    await quiet(marc);
  });

  it('puts what the week collected on the sheet, and not in the room', async () => {
    const marc = await enter(group, 'Marc');
    open.push(marc);

    const who = await env.DB.prepare('SELECT id FROM members WHERE group_id = ?')
      .bind(group.id)
      .first<{ id: string }>();
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

    // The count used to ride the opening line. It is on the night's own
    // screen, which is where a man goes to read the things themselves.
    const sheet = await worker.fetch('https://dads.test/api/night', {
      headers: { Cookie: marc.cookie },
    });
    const body = JSON.stringify(await sheet.json());
    expect(body).toContain('Bedtime');
    expect(body).toContain('The school thing');
    await quiet(marc);
  });

  it('nudges the day before without saying anything in the room', async () => {
    const marc = await enter(group, 'Marc');
    open.push(marc);

    // The reminder is its own timer on the same alarm. Firing it must not
    // eat the start — a third kind sharing one alarm is exactly how that
    // happens.
    clockAt(start - 24 * 60 * 60 * 1000 + 1000);
    expect(await fireAlarm(group)).toBe(true);
    expect(await armed(group)).toContain('night_start');

    clockAt(start + 1000);
    expect(await fireAlarm(group)).toBe(true);
    await until(async () => (await armed(group)).includes('night_end'));
    await quiet(marc);
  });

  it('closes the night and arms the following week, saying nothing', async () => {
    const marc = await enter(group, 'Marc');
    const sam = await enter(group, 'Sam');
    open.push(marc, sam);

    clockAt(start + 1000);
    expect(await fireAlarm(group)).toBe(true);

    clockAt(start + 60_000);
    marc.say('made it');
    sam.say('me too');
    await until(() => marc.lines().includes('me too'));

    clockAt(start + NIGHT_DURATION_MS + 1000);
    expect(await fireAlarm(group)).toBe(true);
    // A week on, the next one opens without anybody reconnecting — which is
    // the only thing the closing line ever really proved.
    await until(async () => (await armed(group)).includes('night_start'));
    clockAt(start + 7 * 86_400_000 + 1000);
    expect(await fireAlarm(group)).toBe(true);

    // And the evening reads as the evening: two men talking, and not a word
    // from the room about its own timers.
    await quiet(marc, 'made it', 'me too');
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

  it('opens and closes like any other, and leaves nothing armed', async () => {
    const marc = await enter(group, 'Marc');
    open.push(marc);

    clockAt(start + 1000);
    expect(await fireAlarm(group)).toBe(true);
    clockAt(start + 60_000);
    marc.say('made it');
    await until(() => marc.lines().includes('made it'));

    clockAt(start + NIGHT_DURATION_MS + 1000);
    expect(await fireAlarm(group)).toBe(true);

    // It has used itself up. The room used to ask when the next one was;
    // there is nothing to ask with now, and nothing needs it — the group has
    // no evening to come, so home and the sheet are the calendar again.
    clockAt(start + 7 * 86_400_000 + 1000);
    expect(await fireAlarm(group)).toBe(false);
    await quiet(marc, 'made it');
  });

  it('a weekly night comes round again where a one-off does not', async () => {
    const weekly = await seedGroup({ night: { ...night, date: null } });
    const marc = await enter(weekly, 'Marc');
    open.push(marc);

    clockAt(start + 1000);
    await fireAlarm(weekly);
    clockAt(start + NIGHT_DURATION_MS + 1000);
    await fireAlarm(weekly);

    // The difference between the two shapes, and the only one that matters
    // once nothing is said out loud: this one is armed again.
    await until(async () => (await armed(weekly)).includes('night_start'));
    clockAt(start + 7 * 86_400_000 + 1000);
    expect(await fireAlarm(weekly)).toBe(true);
    await quiet(marc);
  });

  it('a date locked in reaches every open socket, without a line', async () => {
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

    // The night itself, pushed: home shows the date it was locked in to,
    // which is the thing a man wanted to know.
    await until(() => marc.frames.some((f) => f.t === 'night' && f.night?.date === day));
    const pushed = marc.frames.filter((f) => f.t === 'night').at(-1);
    expect(pushed).toMatchObject({ t: 'night', night: { date: day, time: '20:30' } });
    await quiet(marc);
  });
});
