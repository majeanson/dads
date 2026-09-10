import { env, exports as workerExports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { currentWindow, nextStart } from '../src/shared/dadNight';
import { occurrenceOf } from '../src/worker/routes/rsvp';
import { cookieFrom, postJoin, resetTables, seedGroup } from './helpers';

const worker = workerExports.default;

function put(cookie: string, coming: boolean): Request {
  return new Request('https://dads.test/api/rsvp', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ coming }),
  });
}

async function comeIn(code: string, name: string): Promise<string> {
  return cookieFrom(await worker.fetch(postJoin({ code, displayName: name })));
}

describe('which evening is being answered', () => {
  const night = { weekday: 4, time: '21:00', tz: 'America/Montreal' };

  it('is the next start when the night is not on', () => {
    const now = Date.now();
    expect(occurrenceOf(night, now)).toBe(nextStart(night, now));
  });

  it('is tonight while tonight is happening', () => {
    // Ten minutes in: a dad saying "I'm in" now means this evening, not the
    // one next week.
    const start = nextStart(night, Date.now())!;
    const inside = start + 10 * 60 * 1000;
    expect(occurrenceOf(night, inside)).toBe(currentWindow(night, inside)!.start);
  });

  it('is nothing at all when the group has no night', () => {
    expect(occurrenceOf(null)).toBeNull();
  });
});

describe('saying whether you are coming', () => {
  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM rsvps').run();
    await resetTables();
  });

  it('records one answer per dad and lets him change it', async () => {
    const group = await seedGroup({ night: { weekday: 4, time: '21:00', tz: 'America/Montreal' } });
    const marc = await comeIn(group.code, 'Marc');

    let res = await worker.fetch(put(marc, true));
    expect(res.status).toBe(200);
    let body = (await res.json()) as { answers: { name: string; coming: boolean }[] };
    expect(body.answers).toEqual([{ memberId: expect.any(String), name: 'Marc', coming: true }]);

    res = await worker.fetch(put(marc, false));
    body = (await res.json()) as { answers: { name: string; coming: boolean }[] };
    // Rewritten, not appended: a man has one answer for one evening.
    expect(body.answers).toHaveLength(1);
    expect(body.answers[0]!.coming).toBe(false);
  });

  it('keeps the dads apart', async () => {
    const group = await seedGroup({ night: { weekday: 4, time: '21:00', tz: 'America/Montreal' } });
    const marc = await comeIn(group.code, 'Marc');
    const sam = await comeIn(group.code, 'Sam');

    await worker.fetch(put(marc, true));
    const res = await worker.fetch(put(sam, false));
    const body = (await res.json()) as { answers: { name: string; coming: boolean }[] };
    expect(body.answers).toHaveLength(2);
  });

  it('has nothing to answer when the group has no night', async () => {
    const group = await seedGroup();
    const marc = await comeIn(group.code, 'Marc');
    expect((await worker.fetch(put(marc, true))).status).toBe(409);
  });

  it('is nobody’s business but a member’s', async () => {
    const res = await worker.fetch(
      new Request('https://dads.test/api/rsvp', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coming: true }),
      }),
    );
    expect(res.status).toBe(401);
  });
});

describe('what we should get into', () => {
  const NIGHT = { weekday: 4, time: '21:00', tz: 'America/Montreal' };

  function add(cookie: string, body: string): Request {
    return new Request('https://dads.test/api/night-item', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ body }),
    });
  }

  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM night_items').run();
    await resetTables();
  });

  it('keeps what the week put up, in the order it was thought of', async () => {
    const group = await seedGroup({ night: NIGHT });
    const marc = await comeIn(group.code, 'Marc');
    const sam = await comeIn(group.code, 'Sam');

    await worker.fetch(add(marc, 'How do you handle bedtime?'));
    const res = await worker.fetch(add(sam, 'The school thing'));
    const body = (await res.json()) as { items: { body: string; name: string }[] };
    expect(body.items.map((i) => i.body)).toEqual([
      'How do you handle bedtime?',
      'The school thing',
    ]);
    // Whose it is travels with it: on the night somebody has to start.
    expect(body.items[0]!.name).toBe('Marc');
  });

  it('lets a dad take back his own and nobody else’s', async () => {
    const group = await seedGroup({ night: NIGHT });
    const marc = await comeIn(group.code, 'Marc');
    const sam = await comeIn(group.code, 'Sam');

    const added = (await (await worker.fetch(add(marc, 'Mine'))).json()) as {
      items: { id: string }[];
    };
    const id = added.items[0]!.id;

    // Sam tries first, and the row is still there afterwards.
    const bySam = (await (
      await worker.fetch(
        new Request(`https://dads.test/api/night-item?id=${id}`, {
          method: 'DELETE',
          headers: { cookie: sam },
        }),
      )
    ).json()) as { items: unknown[] };
    expect(bySam.items).toHaveLength(1);

    const byMarc = (await (
      await worker.fetch(
        new Request(`https://dads.test/api/night-item?id=${id}`, {
          method: 'DELETE',
          headers: { cookie: marc },
        }),
      )
    ).json()) as { items: unknown[] };
    expect(byMarc.items).toHaveLength(0);
  });

  it('refuses an empty one, and one longer than a thought', async () => {
    const group = await seedGroup({ night: NIGHT });
    const marc = await comeIn(group.code, 'Marc');
    expect((await worker.fetch(add(marc, '   '))).status).toBe(400);
    expect((await worker.fetch(add(marc, 'x'.repeat(201)))).status).toBe(400);
  });

  it('has nowhere to put anything when the group has no night', async () => {
    const group = await seedGroup();
    const marc = await comeIn(group.code, 'Marc');
    expect((await worker.fetch(add(marc, 'Something'))).status).toBe(409);
  });
});

describe('the night as a calendar file', () => {
  beforeEach(async () => {
    await resetTables();
  });

  it('repeats weekly in the group’s own zone, not at a fixed instant', async () => {
    const group = await seedGroup({ night: { weekday: 4, time: '21:00', tz: 'America/Montreal' } });
    const marc = await comeIn(group.code, 'Marc');

    const res = await worker.fetch(
      new Request('https://dads.test/api/night.ics', { headers: { cookie: marc } }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/calendar');

    const ics = await res.text();
    // A TZID and a weekly rule, so 21:00 stays 21:00 across a DST shift —
    // the same reason the night is stored as a slot and never as a timestamp.
    expect(ics).toContain('DTSTART;TZID=America/Montreal:');
    expect(ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=TH');
    expect(ics).toContain('T210000');
    expect(ics).toContain('DURATION:PT3H');
  });

  it('is not there when there is no night', async () => {
    const group = await seedGroup();
    const marc = await comeIn(group.code, 'Marc');
    const res = await worker.fetch(
      new Request('https://dads.test/api/night.ics', { headers: { cookie: marc } }),
    );
    expect(res.status).toBe(404);
  });
});
