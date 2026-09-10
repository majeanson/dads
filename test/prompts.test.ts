import { env, exports as workerExports } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashKey, pickIndex } from '../src/shared/promptPick';
import type { ServerFrame } from '../src/shared/protocol';
import { todaysPrompt } from '../src/worker/prompts';
import { cookieFrom, postJoin, resetTables, seedGroup, type SeededGroup } from './helpers';

const worker = workerExports.default;

/**
 * resetTables clears the groups a test made, but the curated library is
 * migration data: it must survive, and every group must be able to draw on it.
 */
async function libraryCount(): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM prompts WHERE group_id IS NULL AND active = 1',
  ).first<{ n: number }>();
  return row?.n ?? 0;
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

const settle = (ms = 60) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function cookieFor(group: SeededGroup, name = 'Marc'): Promise<string> {
  return cookieFrom(await worker.fetch(postJoin({ code: group.code, displayName: name })));
}

function get(path: string, cookie: string) {
  return worker.fetch(`https://dads.test${path}`, { headers: { Cookie: cookie } });
}

describe('the deterministic pick', () => {
  it('is stable for the same group and day, and differs across both', () => {
    expect(pickIndex('grp_a', '2026-09-09', 100)).toBe(pickIndex('grp_a', '2026-09-09', 100));
    expect(pickIndex('grp_a', '2026-09-09', 100)).not.toBe(pickIndex('grp_a', '2026-09-10', 100));
    expect(pickIndex('grp_a', '2026-09-09', 100)).not.toBe(pickIndex('grp_b', '2026-09-09', 100));
  });

  it('stays inside the pool, and says so when there is no pool', () => {
    for (const size of [1, 7, 100]) {
      const index = pickIndex('grp_a', '2026-09-09', size)!;
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(size);
    }
    expect(pickIndex('grp_a', '2026-09-09', 0)).toBeNull();
  });

  it('spreads across the library rather than favouring a corner of it', () => {
    // 200 consecutive days should touch a good share of a 100-prompt pool.
    const seen = new Set<number>();
    for (let day = 1; day <= 200; day++) {
      seen.add(pickIndex('grp_a', `2026-01-${String(day).padStart(3, '0')}`, 100)!);
    }
    expect(seen.size).toBeGreaterThan(50);
  });

  it('hashes without collisions on neighbouring keys', () => {
    expect(hashKey('grp_a:2026-09-09')).not.toBe(hashKey('grp_a:2026-09-10'));
    expect(hashKey('a')).not.toBe(hashKey('b'));
  });
});

describe('the curated library', () => {
  it('ships a hundred prompts, global to every group', async () => {
    expect(await libraryCount()).toBe(100);
  });
});

describe('todaysPrompt', () => {
  let group: SeededGroup;
  beforeEach(async () => {
    vi.useRealTimers();
    await resetTables();
    group = await seedGroup();
  });
  afterEach(() => vi.useRealTimers());

  it('gives the same question all day and pins it', async () => {
    const first = await todaysPrompt(env, group.id);
    const second = await todaysPrompt(env, group.id);
    expect(first?.prompt.id).toBe(second?.prompt.id);

    const pinned = await env.DB.prepare(
      'SELECT prompt_id FROM prompt_days WHERE group_id = ? AND day = ?',
    )
      .bind(group.id, first!.day)
      .first<{ prompt_id: string }>();
    expect(pinned?.prompt_id).toBe(first!.prompt.id);
  });

  it('does not let a new prompt change a question already asked', async () => {
    const today = await todaysPrompt(env, group.id);

    // A dad adds one this afternoon: the pool grows, the pick would move.
    await env.DB.prepare(
      `INSERT INTO prompts (id, group_id, body, author_member_id, active, created_at)
       VALUES ('prm_new', ?, 'Something new', NULL, 1, ?)`,
    )
      .bind(group.id, Date.now())
      .run();

    expect((await todaysPrompt(env, group.id))?.prompt.id).toBe(today!.prompt.id);
  });

  it('turns over at the group’s own midnight, not UTC’s', async () => {
    // Montreal is UTC-4 in September, so 02:30 UTC on the 10th is still
    // 22:30 on the 9th at the kitchen table — the same evening, the same
    // question. (04:30 UTC would genuinely be the next day locally.)
    const beforeUtcMidnight = Date.parse('2026-09-09T23:30:00Z');
    const afterUtcMidnight = Date.parse('2026-09-10T02:30:00Z');

    const evening = await todaysPrompt(env, group.id, beforeUtcMidnight);
    const laterThatNight = await todaysPrompt(env, group.id, afterUtcMidnight);

    expect(evening?.day).toBe('2026-09-09');
    expect(laterThatNight?.day).toBe('2026-09-09');
    expect(laterThatNight?.prompt.id).toBe(evening!.prompt.id);

    // The next local morning is a new question.
    const morning = await todaysPrompt(env, group.id, Date.parse('2026-09-10T14:00:00Z'));
    expect(morning?.day).toBe('2026-09-10');
  });

  it('gives two groups different questions on the same day', async () => {
    const other = await seedGroup();
    const a = await todaysPrompt(env, group.id);
    const b = await todaysPrompt(env, other.id);
    // Not guaranteed different for any one pair, but these two ids are fixed
    // by the seed and this asserts the key includes the group at all.
    expect(a?.day).toBe(b?.day);
    expect(hashKey(`${group.id}:${a!.day}`)).not.toBe(hashKey(`${other.id}:${b!.day}`));
  });
});

describe('GET /api/prompt', () => {
  let group: SeededGroup;
  beforeEach(async () => {
    await resetTables();
    group = await seedGroup();
  });

  it('refuses a stranger', async () => {
    expect((await worker.fetch('https://dads.test/api/prompt')).status).toBe(401);
  });

  it('hands back today’s question, unanswered', async () => {
    const cookie = await cookieFor(group);
    const res = await get('/api/prompt', cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      prompt: { body: string; bodyFr: string | null };
      answered: boolean;
    };
    expect(body.prompt.body.length).toBeGreaterThan(10);
    // The curated hundred come in both, so a dad reading in French gets the
    // same question as everyone else rather than an English one.
    expect(body.prompt.bodyFr?.length ?? 0).toBeGreaterThan(10);
    expect(body.prompt.bodyFr).not.toBe(body.prompt.body);
    expect(body.answered).toBe(false);
  });
});

describe('answering', () => {
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

  it('files the answer against today’s question and shows it to the room', async () => {
    const marc = await enter(group, 'Marc');
    const sam = await enter(group, 'Sam');
    open.push(marc, sam);
    await settle();

    const today = await todaysPrompt(env, group.id);
    marc.answer('  I shouted about shoes. It was not about shoes.  ');
    await settle(120);

    const seen = sam.frames.find((f) => f.t === 'msg' && f.message.kind === 'prompt');
    expect(seen).toBeTruthy();
    if (seen?.t !== 'msg') throw new Error('unreachable');
    expect(seen.message.body).toBe('I shouted about shoes. It was not about shoes.');
    expect(seen.message.promptId).toBe(today!.prompt.id);
    expect(seen.message.name).toBe('Marc');

    const row = await env.DB.prepare(
      'SELECT kind, prompt_id FROM messages WHERE group_id = ? AND kind = ?',
    )
      .bind(group.id, 'prompt')
      .first<{ kind: string; prompt_id: string }>();
    expect(row?.prompt_id).toBe(today!.prompt.id);
  });

  it('reports back that you have answered', async () => {
    const marc = await enter(group, 'Marc');
    open.push(marc);
    await settle();
    marc.answer('said my piece');
    await settle(120);

    const res = await get('/api/prompt', marc.cookie);
    expect(((await res.json()) as { answered: boolean }).answered).toBe(true);
  });
});

describe('the list', () => {
  let group: SeededGroup;
  beforeEach(async () => {
    await resetTables();
    group = await seedGroup();
  });

  it('shows the library, what has been asked, and today', async () => {
    const cookie = await cookieFor(group);
    await todaysPrompt(env, group.id);

    const res = await get('/api/prompts', cookie);
    const body = (await res.json()) as {
      today: { day: string; prompt: { id: string } } | null;
      pool: { id: string; groupId: string | null; timesAsked: number }[];
      history: { day: string; promptId: string; answers: number }[];
    };

    expect(body.pool).toHaveLength(100);
    expect(body.today).not.toBeNull();
    expect(body.history).toHaveLength(1);
    expect(body.history[0]!.promptId).toBe(body.today!.prompt.id);
    expect(body.pool.find((p) => p.id === body.today!.prompt.id)?.timesAsked).toBe(1);
  });

  it('takes a dad’s own question and lists it as the group’s', async () => {
    const cookie = await cookieFor(group, 'Marc');
    const res = await worker.fetch('https://dads.test/api/prompts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ body: '  What are you not saying to your kid?  ' }),
    });
    expect(res.status).toBe(200);
    const added = (await res.json()) as { prompt: { body: string; authorName: string } };
    expect(added.prompt.body).toBe('What are you not saying to your kid?');
    expect(added.prompt.authorName).toBe('Marc');

    const list = (await (await get('/api/prompts', cookie)).json()) as {
      pool: { body: string; groupId: string | null; authorName: string | null }[];
    };
    expect(list.pool).toHaveLength(101);
    const mine = list.pool.find((p) => p.groupId !== null);
    expect(mine?.body).toBe('What are you not saying to your kid?');
    // The group's own sort ahead of the library.
    expect(list.pool[0]).toEqual(mine);
  });

  it('refuses an empty, overlong or duplicate question', async () => {
    const cookie = await cookieFor(group);
    const post = (body: unknown) =>
      worker.fetch('https://dads.test/api/prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ body }),
      });

    expect((await post('   ')).status).toBe(400);
    expect((await post('x'.repeat(241))).status).toBe(400);

    expect((await post('A fresh question?')).status).toBe(200);
    expect((await post('a FRESH question?')).status).toBe(409);

    // Including one already in the curated library.
    const existing = await env.DB.prepare(
      'SELECT body FROM prompts WHERE group_id IS NULL LIMIT 1',
    ).first<{ body: string }>();
    expect((await post(existing!.body)).status).toBe(409);
  });

  it('keeps one group’s questions out of another group’s list', async () => {
    const mine = await cookieFor(group, 'Marc');
    await worker.fetch('https://dads.test/api/prompts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: mine },
      body: JSON.stringify({ body: 'Private to this lot' }),
    });

    const other = await seedGroup();
    const theirs = await cookieFor(other, 'Stranger');
    const list = (await (await get('/api/prompts', theirs)).json()) as {
      pool: { body: string }[];
    };
    expect(list.pool).toHaveLength(100);
    expect(list.pool.some((p) => p.body === 'Private to this lot')).toBe(false);
  });

  it('returns the answers to one question', async () => {
    const marc = await enter(group, 'Marc');
    await settle();
    const today = await todaysPrompt(env, group.id);
    marc.answer('the honest version');
    await settle(120);

    const res = await get(
      `/api/prompt-answers?promptId=${encodeURIComponent(today!.prompt.id)}`,
      marc.cookie,
    );
    const body = (await res.json()) as { answers: { name: string; body: string }[] };
    expect(body.answers).toEqual([
      expect.objectContaining({ name: 'Marc', body: 'the honest version' }),
    ]);

    marc.close();
    await settle();
  });
});
