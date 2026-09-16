import { env, exports as workerExports } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerFrame } from '../src/shared/protocol';
import { isoWeekIn, previousWeek } from '../src/shared/week';
import { buildBoard, currentWeek } from '../src/worker/board';
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

class Dad {
  frames: ServerFrame[] = [];
  constructor(
    readonly ws: WebSocket,
    readonly cookie: string,
    readonly memberId: string,
  ) {
    ws.accept();
    ws.addEventListener('message', (event) => {
      if (event.data === 'pong') return;
      this.frames.push(JSON.parse(event.data as string) as ServerFrame);
    });
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

async function joinAs(group: SeededGroup, name: string) {
  const res = await worker.fetch(postJoin({ code: group.code, displayName: name }));
  const body = (await res.clone().json()) as { member: { id: string } };
  return { cookie: cookieFrom(res), memberId: body.member.id };
}

async function enter(group: SeededGroup, name: string): Promise<Dad> {
  const { cookie, memberId } = await joinAs(group, name);
  const res = await worker.fetch('https://dads.test/ws', {
    headers: { Upgrade: 'websocket', Cookie: cookie },
  });
  expect(res.status).toBe(101);
  const dad = new Dad(res.webSocket!, cookie, memberId);
  await arrived(dad);
  return dad;
}

function put(path: string, cookie: string, body: unknown) {
  return worker.fetch(`https://dads.test${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body),
  });
}

function board(cookie: string) {
  return worker.fetch('https://dads.test/api/board', { headers: { Cookie: cookie } });
}

/** Puts a commitment straight into a past week, the way last week's would be. */
async function seedCommitment(
  group: SeededGroup,
  memberId: string,
  week: string,
  body: string,
  outcome: 'pending' | 'done' | 'missed' = 'pending',
) {
  await env.DB.prepare(
    `INSERT INTO commitments (id, group_id, member_id, week, body, outcome, reflection, created_at)
     VALUES (?, ?, ?, ?, ?, ?, '', ?)`,
  )
    .bind(`cmt_${week}_${memberId}`, group.id, memberId, week, body, outcome, Date.now())
    .run();
}

describe('the current week', () => {
  let group: SeededGroup;
  beforeEach(async () => {
    await resetTables();
    group = await seedGroup();
  });

  it('is the group’s week, taken from the group’s zone', async () => {
    const week = await currentWeek(env, group.id);
    expect(week).toBe(isoWeekIn(Date.now(), 'America/Montreal'));
  });
});

describe('PUT /api/check-in', () => {
  let group: SeededGroup;
  beforeEach(async () => {
    await resetTables();
    group = await seedGroup();
  });

  it('refuses a stranger', async () => {
    const res = await worker.fetch('https://dads.test/api/check-in', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating: 3, note: '' }),
    });
    expect(res.status).toBe(401);
  });

  it('records a rating and a line, and shows it on the board', async () => {
    const { cookie } = await joinAs(group, 'Marc');
    expect(
      (await put('/api/check-in', cookie, { rating: 2, note: 'Rough with bedtimes.' })).status,
    ).toBe(200);

    const data = (await (await board(cookie)).json()) as {
      weeks: { rows: { name: string; checkIn: { rating: number; note: string } | null }[] }[];
    };
    const marc = data.weeks[0]!.rows.find((r) => r.name === 'Marc');
    expect(marc?.checkIn).toEqual({ rating: 2, note: 'Rough with bedtimes.' });
  });

  it('replaces rather than duplicating when a dad changes his mind', async () => {
    const { cookie } = await joinAs(group, 'Marc');
    await put('/api/check-in', cookie, { rating: 2, note: 'Rough.' });
    await put('/api/check-in', cookie, { rating: 4, note: 'Better by Friday.' });

    const rows = await env.DB.prepare('SELECT rating, note FROM check_ins WHERE group_id = ?')
      .bind(group.id)
      .all<{ rating: number; note: string }>();
    expect(rows.results).toEqual([{ rating: 4, note: 'Better by Friday.' }]);
  });

  it('rejects a rating outside one to five', async () => {
    const { cookie } = await joinAs(group, 'Marc');
    for (const rating of [0, 6, 2.5, 'three']) {
      expect((await put('/api/check-in', cookie, { rating, note: '' })).status).toBe(400);
    }
    expect((await put('/api/check-in', cookie, { rating: 3, note: 'x'.repeat(281) })).status).toBe(
      400,
    );
  });
});

describe('PUT /api/commitment', () => {
  let group: SeededGroup;
  beforeEach(async () => {
    await resetTables();
    group = await seedGroup();
  });

  it('records one thing to try, pending by default', async () => {
    const { cookie } = await joinAs(group, 'Marc');
    const res = await put('/api/commitment', cookie, {
      body: '  Phone in the drawer at six.  ',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      body: 'Phone in the drawer at six.',
      outcome: 'pending',
    });
  });

  it('changing it mid-week replaces it and resets the outcome', async () => {
    const { cookie } = await joinAs(group, 'Marc');
    await put('/api/commitment', cookie, { body: 'First idea' });
    const week = await currentWeek(env, group.id);
    await put('/api/commitment-outcome', cookie, { week, outcome: 'done', reflection: 'easy' });
    await put('/api/commitment', cookie, { body: 'Second idea' });

    const rows = await env.DB.prepare(
      'SELECT body, outcome, reflection FROM commitments WHERE group_id = ?',
    )
      .bind(group.id)
      .all<{ body: string; outcome: string; reflection: string }>();
    expect(rows.results).toEqual([{ body: 'Second idea', outcome: 'pending', reflection: '' }]);
  });

  it('refuses an empty or overlong commitment', async () => {
    const { cookie } = await joinAs(group, 'Marc');
    expect((await put('/api/commitment', cookie, { body: '   ' })).status).toBe(400);
    expect((await put('/api/commitment', cookie, { body: 'x'.repeat(201) })).status).toBe(400);
  });
});

describe('PUT /api/commitment-outcome', () => {
  let group: SeededGroup;
  beforeEach(async () => {
    await resetTables();
    group = await seedGroup();
  });

  it('records how it went', async () => {
    const { cookie } = await joinAs(group, 'Marc');
    await put('/api/commitment', cookie, { body: 'Phone in the drawer' });
    const week = await currentWeek(env, group.id);

    const res = await put('/api/commitment-outcome', cookie, {
      week,
      outcome: 'missed',
      reflection: 'Managed it twice.',
    });
    expect(res.status).toBe(200);

    const row = await env.DB.prepare(
      'SELECT outcome, reflection, reflected_at FROM commitments WHERE group_id = ?',
    )
      .bind(group.id)
      .first<{ outcome: string; reflection: string; reflected_at: number }>();
    expect(row?.outcome).toBe('missed');
    expect(row?.reflection).toBe('Managed it twice.');
    expect(row?.reflected_at).toBeGreaterThan(0);
  });

  it('refuses a week with no commitment, and a nonsense outcome or week', async () => {
    const { cookie } = await joinAs(group, 'Marc');
    const week = await currentWeek(env, group.id);
    expect((await put('/api/commitment-outcome', cookie, { week, outcome: 'done' })).status).toBe(
      404,
    );

    await put('/api/commitment', cookie, { body: 'Something' });
    expect((await put('/api/commitment-outcome', cookie, { week, outcome: 'maybe' })).status).toBe(
      400,
    );
    expect(
      (await put('/api/commitment-outcome', cookie, { week: '2026-W99', outcome: 'done' })).status,
    ).toBe(400);
  });

  it('cannot be used to answer for another dad', async () => {
    const marc = await joinAs(group, 'Marc');
    const sam = await joinAs(group, 'Sam');
    await put('/api/commitment', marc.cookie, { body: 'Marc’s thing' });
    const week = await currentWeek(env, group.id);

    // Sam has no commitment of his own that week, so there is nothing for him
    // to close — he cannot reach Marc's.
    expect(
      (await put('/api/commitment-outcome', sam.cookie, { week, outcome: 'done' })).status,
    ).toBe(404);
    const row = await env.DB.prepare('SELECT outcome FROM commitments WHERE member_id = ?')
      .bind(marc.memberId)
      .first<{ outcome: string }>();
    expect(row?.outcome).toBe('pending');
  });
});

describe('the board', () => {
  let group: SeededGroup;
  beforeEach(async () => {
    await resetTables();
    group = await seedGroup();
  });
  afterEach(() => vi.useRealTimers());

  it('gives every dad a row, filled in or not', async () => {
    const marc = await joinAs(group, 'Marc');
    await joinAs(group, 'Sam');
    await put('/api/check-in', marc.cookie, { rating: 4, note: 'Good one.' });

    const data = (await (await board(marc.cookie)).json()) as {
      weeks: { rows: { name: string; checkIn: unknown; commitment: unknown }[] }[];
      you: string;
    };
    expect(data.weeks[0]!.rows.map((r) => r.name)).toEqual(['Marc', 'Sam']);
    expect(data.weeks[0]!.rows.find((r) => r.name === 'Sam')!.checkIn).toBeNull();
    expect(data.you).toBe(marc.memberId);
  });

  it('shows six weeks, newest first', async () => {
    const { cookie } = await joinAs(group, 'Marc');
    const data = (await (await board(cookie)).json()) as {
      week: string;
      weeks: { week: string }[];
    };
    expect(data.weeks).toHaveLength(6);
    expect(data.weeks[0]!.week).toBe(data.week);
    expect(data.weeks[1]!.week).toBe(previousWeek(data.week));
  });

  it('asks how last week’s commitment went', async () => {
    const marc = await joinAs(group, 'Marc');
    const week = await currentWeek(env, group.id);
    await seedCommitment(group, marc.memberId, previousWeek(week), 'Phone in the drawer');

    const data = (await (await board(marc.cookie)).json()) as {
      pending: { week: string; body: string } | null;
    };
    expect(data.pending).toEqual({ week: previousWeek(week), body: 'Phone in the drawer' });
  });

  it('stops asking once it has been answered', async () => {
    const marc = await joinAs(group, 'Marc');
    const week = await currentWeek(env, group.id);
    const last = previousWeek(week);
    await seedCommitment(group, marc.memberId, last, 'Phone in the drawer');
    await put('/api/commitment-outcome', marc.cookie, {
      week: last,
      outcome: 'done',
      reflection: 'Most nights.',
    });

    const data = (await (await board(marc.cookie)).json()) as { pending: unknown };
    expect(data.pending).toBeNull();
  });

  it('never asks about this week’s commitment', async () => {
    const marc = await joinAs(group, 'Marc');
    await put('/api/commitment', marc.cookie, { body: 'Still trying this one' });
    const data = (await (await board(marc.cookie)).json()) as { pending: unknown };
    expect(data.pending).toBeNull();
  });

  it('asks about another dad’s open week only of that dad', async () => {
    const marc = await joinAs(group, 'Marc');
    const sam = await joinAs(group, 'Sam');
    const last = previousWeek(await currentWeek(env, group.id));
    await seedCommitment(group, marc.memberId, last, 'Marc’s thing');

    const marcBoard = (await (await board(marc.cookie)).json()) as { pending: unknown };
    const samBoard = (await (await board(sam.cookie)).json()) as { pending: unknown };
    expect(marcBoard.pending).not.toBeNull();
    expect(samBoard.pending).toBeNull();

    // Sam still sees Marc's commitment on the board — that is the point.
    const seen = (await (await board(sam.cookie)).json()) as {
      weeks: { week: string; rows: { name: string; commitment: { body: string } | null }[] }[];
    };
    const lastWeek = seen.weeks.find((w) => w.week === last)!;
    expect(lastWeek.rows.find((r) => r.name === 'Marc')!.commitment!.body).toBe('Marc’s thing');
  });

  it('reaches back past an unanswered fortnight', async () => {
    const marc = await joinAs(group, 'Marc');
    const week = await currentWeek(env, group.id);
    const twoWeeksAgo = previousWeek(previousWeek(week));
    await seedCommitment(group, marc.memberId, twoWeeksAgo, 'From a fortnight ago');

    const data = (await (await board(marc.cookie)).json()) as { pending: { week: string } | null };
    expect(data.pending?.week).toBe(twoWeeksAgo);
  });

  it('keeps one group’s board out of another’s', async () => {
    const marc = await joinAs(group, 'Marc');
    await put('/api/check-in', marc.cookie, { rating: 5, note: 'Ours alone' });

    const other = await seedGroup();
    const stranger = await joinAs(other, 'Stranger');
    const data = (await (await board(stranger.cookie)).json()) as {
      weeks: { rows: { name: string }[] }[];
    };
    expect(data.weeks[0]!.rows.map((r) => r.name)).toEqual(['Stranger']);
  });

  it('is built directly the same way the route builds it', async () => {
    const marc = await joinAs(group, 'Marc');
    await put('/api/check-in', marc.cookie, { rating: 3, note: 'Fine.' });
    const built = await buildBoard(env, group.id, marc.memberId);
    expect(built.weeks[0]!.rows[0]!.checkIn).toEqual({ rating: 3, note: 'Fine.' });
  });
});

describe('the room hears about it', () => {
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

  it('announces a check-in with what it said', async () => {
    const sam = await enter(group, 'Sam');
    open.push(sam);

    const marc = await joinAs(group, 'Marc');
    await put('/api/check-in', marc.cookie, { rating: 2, note: 'Shouted about shoes.' });
    await until(() => sam.lines().includes('Marc checked in — 2/5. Shouted about shoes.'));
  });

  it('announces a commitment and how it went', async () => {
    const sam = await enter(group, 'Sam');
    open.push(sam);

    const marc = await joinAs(group, 'Marc');
    await put('/api/commitment', marc.cookie, { body: 'Phone in the drawer at six' });
    await until(() => sam.lines().includes('Marc is trying this week: Phone in the drawer at six'));

    const week = await currentWeek(env, group.id);
    await put('/api/commitment-outcome', marc.cookie, {
      week,
      outcome: 'done',
      reflection: 'Four nights out of five.',
    });
    await until(() =>
      sam.lines().includes('Marc did it: Phone in the drawer at six — Four nights out of five.'),
    );
  });

  it('says plainly when a dad did not manage it', async () => {
    const sam = await enter(group, 'Sam');
    open.push(sam);

    const marc = await joinAs(group, 'Marc');
    await put('/api/commitment', marc.cookie, { body: 'Read at bedtime' });
    const week = await currentWeek(env, group.id);
    await put('/api/commitment-outcome', marc.cookie, { week, outcome: 'missed', reflection: '' });
    await until(() => sam.lines().includes('Marc didn’t manage: Read at bedtime'));
  });
});
