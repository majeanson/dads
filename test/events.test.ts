import { env, exports as workerExports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { civilDayIn } from '../src/shared/dadNight';
import { parseEventInput, type GroupEvent } from '../src/shared/events';
import { cookieFrom, postJoin, resetTables, seedGroup } from './helpers';

const worker = workerExports.default;
const TZ = 'America/Montreal';
const DAY = 24 * 60 * 60 * 1000;

const inDays = (n: number) => civilDayIn(Date.now() + n * DAY, TZ);

function call(cookie: string, method: string, path: string, body?: unknown): Request {
  return new Request(`https://dads.test${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function comeIn(code: string, name: string): Promise<string> {
  return cookieFrom(await worker.fetch(postJoin({ code, displayName: name })));
}

interface State {
  today: string;
  events: GroupEvent[];
  id?: string;
}

describe('what an event body may say', () => {
  const now = Date.parse('2026-10-27T12:00:00Z');

  it('derives the instant from the civil date in the group’s zone', () => {
    const parsed = parseEventInput({ title: 'Bowling', day: '2026-11-10', time: '19:00' }, TZ, now);
    expect(parsed.ok).toBe(true);
    // 19:00 EST on 10 November is midnight-ish UTC: 00:00 on the 11th.
    if (parsed.ok) expect(new Date(parsed.startsAt).toISOString()).toBe('2026-11-11T00:00:00.000Z');
  });

  it('refuses an empty title, a bad date, a bad time and a time that has gone', () => {
    const bad = (body: unknown) => {
      const parsed = parseEventInput(body, TZ, now);
      return parsed.ok ? 'ok' : parsed.error;
    };
    expect(bad({ title: '  ', day: '2026-11-10', time: '19:00' })).toBe('empty');
    expect(bad({ title: 'x', day: '2026-02-31', time: '19:00' })).toBe('bad_day');
    expect(bad({ title: 'x', day: '2026-11-10', time: '25:00' })).toBe('bad_time');
    expect(bad({ title: 'x', day: '2026-10-01', time: '19:00' })).toBe('bad_day');
    expect(bad({ title: 'x', day: '2026-10-27', time: '06:00' })).toBe('past');
    expect(bad({ title: 'x'.repeat(61), day: '2026-11-10', time: '19:00' })).toBe('too_long');
    expect(bad(null)).toBe('bad_request');
  });

  it('keeps a title to one line', () => {
    const parsed = parseEventInput(
      { title: 'Bowling\n  night', day: '2026-11-10', time: '19:00' },
      TZ,
      now,
    );
    expect(parsed.ok && parsed.value.title).toBe('Bowling night');
  });
});

describe('events', () => {
  beforeEach(async () => {
    await resetTables();
    await env.DB.prepare('DELETE FROM events').run();
  });

  it('lets a dad put one up and every dad see it, soonest first', async () => {
    const group = await seedGroup({ night: { weekday: 4, time: '21:00', tz: TZ } });
    const marc = await comeIn(group.code, 'Marc');
    const luc = await comeIn(group.code, 'Luc');

    await worker.fetch(
      call(marc, 'POST', '/api/events', { title: 'Later', day: inDays(20), time: '19:00' }),
    );
    const made = await worker.fetch(
      call(marc, 'POST', '/api/events', {
        title: 'Bowling',
        place: 'Le Strike',
        day: inDays(10),
        time: '19:00',
      }),
    );
    expect(made.status).toBe(200);

    const seen = (await (await worker.fetch(call(luc, 'GET', '/api/events'))).json()) as State;
    expect(seen.events.map((e) => e.title)).toEqual(['Bowling', 'Later']);
    expect(seen.events[0]).toMatchObject({ place: 'Le Strike', name: 'Marc', answers: [] });
  });

  it('keeps one answer per dad and lets him change it', async () => {
    const group = await seedGroup({ night: { weekday: 4, time: '21:00', tz: TZ } });
    const marc = await comeIn(group.code, 'Marc');
    const luc = await comeIn(group.code, 'Luc');
    const { id } = (await (
      await worker.fetch(
        call(marc, 'POST', '/api/events', { title: 'Bowling', day: inDays(5), time: '19:00' }),
      )
    ).json()) as State;

    await worker.fetch(call(luc, 'PUT', '/api/events/rsvp', { id, answer: 'in' }));
    await worker.fetch(call(luc, 'PUT', '/api/events/rsvp', { id, answer: 'maybe' }));
    const after = (await (
      await worker.fetch(call(marc, 'PUT', '/api/events/rsvp', { id, answer: 'out' }))
    ).json()) as State;

    expect(after.events[0]?.answers).toEqual([
      { memberId: expect.any(String), name: 'Luc', answer: 'maybe' },
      { memberId: expect.any(String), name: 'Marc', answer: 'out' },
    ]);
  });

  it('is the author’s to edit and cancel, and nobody else’s', async () => {
    const group = await seedGroup({ night: { weekday: 4, time: '21:00', tz: TZ } });
    const marc = await comeIn(group.code, 'Marc');
    const luc = await comeIn(group.code, 'Luc');
    const { id } = (await (
      await worker.fetch(
        call(marc, 'POST', '/api/events', { title: 'Bowling', day: inDays(5), time: '19:00' }),
      )
    ).json()) as State;

    const edit = { id, title: 'Axe throwing', day: inDays(6), time: '20:00' };
    expect((await worker.fetch(call(luc, 'PUT', '/api/events', edit))).status).toBe(403);

    // A stranger's DELETE is a no-op, not an error and not a removal.
    await worker.fetch(call(luc, 'DELETE', `/api/events?id=${id}`));
    let seen = (await (await worker.fetch(call(marc, 'GET', '/api/events'))).json()) as State;
    expect(seen.events).toHaveLength(1);

    expect((await worker.fetch(call(marc, 'PUT', '/api/events', edit))).status).toBe(200);
    seen = (await (await worker.fetch(call(marc, 'GET', '/api/events'))).json()) as State;
    expect(seen.events[0]).toMatchObject({ title: 'Axe throwing', time: '20:00' });

    await worker.fetch(call(marc, 'DELETE', `/api/events?id=${id}`));
    seen = (await (await worker.fetch(call(marc, 'GET', '/api/events'))).json()) as State;
    expect(seen.events).toEqual([]);
  });

  it('never shows or answers another room’s event', async () => {
    const ours = await seedGroup({ slug: 'ours', night: { weekday: 4, time: '21:00', tz: TZ } });
    const theirs = await seedGroup({
      slug: 'theirs',
      night: { weekday: 4, time: '21:00', tz: TZ },
    });
    const marc = await comeIn(ours.code, 'Marc');
    const stranger = await comeIn(theirs.code, 'Stranger');
    const { id } = (await (
      await worker.fetch(
        call(marc, 'POST', '/api/events', { title: 'Bowling', day: inDays(5), time: '19:00' }),
      )
    ).json()) as State;

    const seen = (await (await worker.fetch(call(stranger, 'GET', '/api/events'))).json()) as State;
    expect(seen.events).toEqual([]);
    expect(
      (await worker.fetch(call(stranger, 'PUT', '/api/events/rsvp', { id, answer: 'in' }))).status,
    ).toBe(404);
    expect((await worker.fetch(call(stranger, 'GET', `/api/event.ics?id=${id}`))).status).toBe(404);
  });

  it('refuses a date that has gone', async () => {
    const group = await seedGroup({ night: { weekday: 4, time: '21:00', tz: TZ } });
    const marc = await comeIn(group.code, 'Marc');
    const res = await worker.fetch(
      call(marc, 'POST', '/api/events', { title: 'Bowling', day: inDays(-2), time: '19:00' }),
    );
    expect(res.status).toBe(400);
  });

  it('hands a calendar file with its own id and the place', async () => {
    const group = await seedGroup({ night: { weekday: 4, time: '21:00', tz: TZ } });
    const marc = await comeIn(group.code, 'Marc');
    const day = inDays(5);
    const { id } = (await (
      await worker.fetch(
        call(marc, 'POST', '/api/events', {
          title: 'Bowling, loudly',
          place: 'Le Strike',
          day,
          time: '19:00',
        }),
      )
    ).json()) as State;

    const ics = await (await worker.fetch(call(marc, 'GET', `/api/event.ics?id=${id}`))).text();
    expect(ics).toContain(`UID:event-${id}@dads`);
    expect(ics).toContain(`DTSTART;TZID=${TZ}:${day.replace(/-/g, '')}T190000`);
    expect(ics).toContain('SUMMARY:Bowling\\, loudly');
    expect(ics).toContain('LOCATION:Le Strike');
    expect(ics).not.toContain('RRULE');
  });
});
