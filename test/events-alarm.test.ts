import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { env, exports as workerExports } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { civilDayIn, nextStart, type DadNight } from '../src/shared/dadNight';
import { EVENT_REMIND_BEFORE_MS } from '../src/shared/events';
import { arrived, cookieFrom, postJoin, resetTables, seedGroup } from './helpers';

const worker = workerExports.default;
const TZ = 'America/Montreal';
const DAY = 24 * 60 * 60 * 1000;

/** A Thursday night a few days off, so the night has timers of its own. */
function upcomingNight(): DadNight {
  const now = Date.now();
  for (let weekday = 0; weekday < 7; weekday++) {
    const night: DadNight = { weekday, time: '21:00', tz: TZ };
    const days = (nextStart(night, now)! - now) / DAY;
    if (days > 2 && days < 5) return night;
  }
  throw new Error('no candidate night');
}

async function schedule(groupId: string): Promise<string[]> {
  return runInDurableObject(env.ROOM.get(env.ROOM.idFromName(groupId)), (_i, state) =>
    state.storage.sql
      .exec<{ kind: string }>('SELECT kind FROM schedule ORDER BY kind')
      .toArray()
      .map((r) => r.kind),
  );
}

const stamps = (id: string) =>
  env.DB.prepare('SELECT reminded_at, started_at FROM events WHERE id = ?')
    .bind(id)
    .first<{ reminded_at: number | null; started_at: number | null }>();

describe('the event timer', () => {
  beforeEach(async () => {
    await resetTables();
    await env.DB.prepare('DELETE FROM events').run();
  });
  afterEach(() => vi.useRealTimers());

  it('shares the queue with the night without stopping it, and fires each push once', async () => {
    const night = upcomingNight();
    const group = await seedGroup({ night });
    const cookie = cookieFrom(
      await worker.fetch(postJoin({ code: group.code, displayName: 'Marc' })),
    );
    const res = await worker.fetch('https://dads.test/ws', {
      headers: { Upgrade: 'websocket', Cookie: cookie },
    });
    const ws = res.webSocket!;
    ws.accept();
    const frames: { t: string }[] = [];
    ws.addEventListener('message', (e) => {
      if (e.data !== 'pong') frames.push(JSON.parse(e.data as string) as { t: string });
    });
    await arrived({ frames });

    // An event comfortably more than a day away, so both pushes are ahead.
    const day = civilDayIn(Date.now() + 4 * DAY, TZ);
    const made = await worker.fetch(
      new Request('https://dads.test/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ title: 'Bowling', day, time: '19:00' }),
      }),
    );
    const { id, events } = (await made.json()) as { id: string; events: { startsAt: number }[] };
    const startsAt = events[0]!.startsAt;

    // The event's timer is in the queue beside the night's, not instead.
    const kinds = await schedule(group.id);
    expect(kinds).toContain('event_due');
    expect(kinds).toContain('night_start');

    // Inside the last day: the reminder is due, once.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(startsAt - EVENT_REMIND_BEFORE_MS + 60_000);
    await runDurableObjectAlarm(env.ROOM.get(env.ROOM.idFromName(group.id)));
    let row = await stamps(id);
    expect(row?.reminded_at).not.toBeNull();
    expect(row?.started_at).toBeNull();
    // The start is still owed, so the timer is armed again for it.
    expect(await schedule(group.id)).toContain('event_due');

    // It starts: the second push goes, and nothing is left to wait for.
    vi.setSystemTime(startsAt + 60_000);
    await runDurableObjectAlarm(env.ROOM.get(env.ROOM.idFromName(group.id)));
    row = await stamps(id);
    expect(row?.started_at).not.toBeNull();
    expect(await schedule(group.id)).not.toContain('event_due');

    ws.close(1000, 'bye');
  });

  it('does not remind of an event made less than a day out', async () => {
    const group = await seedGroup({ night: upcomingNight() });
    const cookie = cookieFrom(
      await worker.fetch(postJoin({ code: group.code, displayName: 'Marc' })),
    );
    // Three hours from now, in the group's own calendar.
    const soon = Date.now() + 3 * 60 * 60 * 1000;
    const day = civilDayIn(soon, TZ);
    const time = new Intl.DateTimeFormat('en-GB', {
      timeZone: TZ,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(soon);
    const made = await worker.fetch(
      new Request('https://dads.test/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ title: 'Game', day, time }),
      }),
    );
    expect(made.status).toBe(200);
    const { id } = (await made.json()) as { id: string };
    expect((await stamps(id))?.reminded_at).not.toBeNull();
  });
});
