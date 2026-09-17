import { env, exports as workerExports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { civilDayIn, nextStart, stillToCome, type DadNight } from '../src/shared/dadNight';
import { cookieFrom, postJoin, resetTables, seedGroup } from './helpers';

const worker = workerExports.default;

const TZ = 'America/Montreal';
const NIGHT: DadNight = { weekday: 4, time: '21:00', tz: TZ };

/** A civil date `days` from the group's own today. The group's calendar, not
 * this machine's: the server refuses a day that is already over back home. */
function dayFromToday(days: number): string {
  return civilDayIn(Date.now() + days * 86_400_000, TZ);
}

function vote(cookie: string, day: string, answer: string | null): Request {
  return new Request('https://dads.test/api/poll', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ day, answer }),
  });
}

function pick(cookie: string, day: string, time = '20:30'): Request {
  return new Request('https://dads.test/api/poll/pick', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ day, time }),
  });
}

function read(cookie: string): Request {
  return new Request('https://dads.test/api/poll', { headers: { cookie } });
}

async function comeIn(code: string, name: string): Promise<string> {
  return cookieFrom(await worker.fetch(postJoin({ code, displayName: name })));
}

interface Poll {
  open: boolean;
  today: string;
  time: string;
  days: { day: string; votes: { memberId: string; name: string; answer: string }[] }[];
}

describe('the calendar that picks the next night', () => {
  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM night_votes').run();
    await resetTables();
  });

  it('is open exactly when there is no evening still to come', async () => {
    const weekly = await seedGroup({ night: NIGHT });
    const marc = await comeIn(weekly.code, 'Marc');
    expect(((await (await worker.fetch(read(marc))).json()) as Poll).open).toBe(false);

    // A one-off that has already happened is not a group that forgot to set a
    // night; it is a group whose next question is when the next one is.
    const gone = await seedGroup({ night: { ...NIGHT, date: dayFromToday(-7) } });
    const sam = await comeIn(gone.code, 'Sam');
    expect(((await (await worker.fetch(read(sam))).json()) as Poll).open).toBe(true);

    const never = await seedGroup();
    const dave = await comeIn(never.code, 'Dave');
    expect(((await (await worker.fetch(read(dave))).json()) as Poll).open).toBe(true);
  });

  it('holds one mark per dad per day, and lets him change it or take it off', async () => {
    const group = await seedGroup();
    const marc = await comeIn(group.code, 'Marc');
    const day = dayFromToday(10);

    let poll = (await (await worker.fetch(vote(marc, day, 'in'))).json()) as Poll;
    expect(poll.days).toHaveLength(1);
    expect(poll.days[0]!.votes).toEqual([
      { memberId: expect.any(String), name: 'Marc', answer: 'in' },
    ]);

    poll = (await (await worker.fetch(vote(marc, day, 'maybe'))).json()) as Poll;
    expect(poll.days[0]!.votes).toHaveLength(1);
    expect(poll.days[0]!.votes[0]!.answer).toBe('maybe');

    // Null is not "can't": it is a man who has not looked at that day.
    poll = (await (await worker.fetch(vote(marc, day, null))).json()) as Poll;
    expect(poll.days).toEqual([]);
  });

  it('keeps the dads apart and puts the days in order', async () => {
    const group = await seedGroup();
    const marc = await comeIn(group.code, 'Marc');
    const sam = await comeIn(group.code, 'Sam');
    const near = dayFromToday(3);
    const far = dayFromToday(12);

    await worker.fetch(vote(marc, far, 'in'));
    await worker.fetch(vote(sam, far, 'maybe'));
    const poll = (await (await worker.fetch(vote(marc, near, 'in'))).json()) as Poll;

    expect(poll.days.map((d) => d.day)).toEqual([near, far]);
    expect(poll.days[1]!.votes.map((v) => v.answer).sort()).toEqual(['in', 'maybe']);
  });

  it('refuses a day that is over, one that is nonsense, and one a year out', async () => {
    const group = await seedGroup();
    const marc = await comeIn(group.code, 'Marc');

    expect((await worker.fetch(vote(marc, dayFromToday(-1), 'in'))).status).toBe(400);
    expect((await worker.fetch(vote(marc, '2026-02-30', 'in'))).status).toBe(400);
    expect((await worker.fetch(vote(marc, 'next thursday', 'in'))).status).toBe(400);
    expect((await worker.fetch(vote(marc, dayFromToday(400), 'in'))).status).toBe(400);
    expect((await worker.fetch(vote(marc, dayFromToday(3), 'soon'))).status).toBe(400);
  });

  it('forgets days that have been and gone rather than reporting them', async () => {
    const group = await seedGroup();
    const marc = await comeIn(group.code, 'Marc');
    // Written past the route, because the route rightly refuses it.
    await env.DB.prepare(
      `INSERT INTO night_votes (group_id, member_id, day, answer, updated_at)
       SELECT ?, id, ?, 'in', ? FROM members WHERE group_id = ?`,
    )
      .bind(group.id, dayFromToday(-3), Date.now(), group.id)
      .run();

    const poll = (await (await worker.fetch(read(marc))).json()) as Poll;
    expect(poll.days).toEqual([]);
  });

  it('makes the picked day the night — once, and with the votes cleared', async () => {
    const group = await seedGroup({ night: NIGHT });
    const marc = await comeIn(group.code, 'Marc');
    const day = dayFromToday(9);
    await worker.fetch(vote(marc, day, 'in'));

    const res = await worker.fetch(pick(marc, day));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { night: DadNight; poll: Poll };

    expect(body.night.date).toBe(day);
    expect(body.night.time).toBe('20:30');
    expect(body.night.tz).toBe(TZ);
    // Derived from the date rather than believed, so the two can never
    // disagree about which day this is.
    expect(body.night.weekday).toBe(new Date(`${day}T00:00:00Z`).getUTCDay());

    // A round is over the moment it is answered.
    expect(body.poll.days).toEqual([]);
    expect(body.poll.open).toBe(false);

    const stored = await env.DB.prepare(
      'SELECT dad_night_weekday, dad_night_time, dad_night_date FROM groups WHERE id = ?',
    )
      .bind(group.id)
      .first<{ dad_night_weekday: number; dad_night_time: string; dad_night_date: string }>();
    expect(stored?.dad_night_date).toBe(day);
    expect(stored?.dad_night_time).toBe('20:30');

    // And it is genuinely a one-off: an evening to come, and then none.
    const night: DadNight = {
      weekday: stored!.dad_night_weekday,
      time: stored!.dad_night_time,
      tz: TZ,
      date: stored!.dad_night_date,
    };
    const start = nextStart(night, Date.now())!;
    expect(stillToCome(night, start - 1000)).toBe(true);
    expect(stillToCome(night, start + 4 * 3_600_000)).toBe(false);
  });

  it('refuses to pick a day nobody could turn up on', async () => {
    const group = await seedGroup();
    const marc = await comeIn(group.code, 'Marc');
    expect((await worker.fetch(pick(marc, dayFromToday(-2)))).status).toBe(400);
  });

  it('offers the hour the group last used, so nobody re-answers it', async () => {
    const group = await seedGroup({ night: { ...NIGHT, time: '19:45' } });
    const marc = await comeIn(group.code, 'Marc');
    const poll = (await (await worker.fetch(read(marc))).json()) as Poll;
    expect(poll.time).toBe('19:45');
  });

  it('is nobody’s business but a member’s', async () => {
    const anon = new Request('https://dads.test/api/poll');
    expect((await worker.fetch(anon)).status).toBe(401);
    expect(
      (
        await worker.fetch(
          new Request('https://dads.test/api/poll', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ day: dayFromToday(3), answer: 'in' }),
          }),
        )
      ).status,
    ).toBe(401);
  });
});
