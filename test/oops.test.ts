import { env, exports as workerExports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/worker/env';
import handler from '../src/worker/index';
import { postOops, recordOops } from '../src/worker/oops';
import { cookieFrom, postJoin, resetTables, seedGroup } from './helpers';

const worker = workerExports.default;

function say(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://dads.test/api/oops', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'iPhone test', ...headers },
    body: JSON.stringify(body),
  });
}

interface Row {
  side: string;
  what: string;
  message: string;
  detail: string | null;
  group_id: string | null;
  member_id: string | null;
  build: string | null;
  agent: string | null;
}

async function rows(): Promise<Row[]> {
  const { results } = await env.DB.prepare('SELECT * FROM oops ORDER BY id').all<Row>();
  return results;
}

describe('a phone saying what went wrong', () => {
  beforeEach(async () => {
    await resetTables();
    await env.DB.prepare('DELETE FROM oops').run();
  });

  it('is heard from the door, before anybody is in a room', async () => {
    const res = await worker.fetch(say({ what: 'web.session', message: 'TypeError: x' }));
    expect(res.status).toBe(204);
    expect(await rows()).toMatchObject([
      { side: 'web', what: 'web.session', message: 'TypeError: x', member_id: null },
    ]);
  });

  it('knows which dad and which room, and what phone', async () => {
    const group = await seedGroup();
    const cookie = cookieFrom(
      await worker.fetch(postJoin({ code: group.code, displayName: 'Marc' })),
    );
    const res = await worker.fetch(
      say(
        { what: 'web.outbox', message: 'gave up after 3 tries', detail: 'stack', build: 'b1' },
        { Cookie: cookie },
      ),
    );
    expect(res.status).toBe(204);
    const [row] = await rows();
    expect(row).toMatchObject({ group_id: group.id, detail: 'stack', build: 'b1' });
    expect(row?.member_id).toMatch(/./);
    expect(row?.agent).toBe('iPhone test');
  });

  it('refuses what is not a report', async () => {
    for (const body of [
      {},
      { what: 'web.x' },
      { what: 'Has Spaces', message: 'm' },
      { what: 'web.x', message: 'm'.repeat(501) },
      { what: 'w'.repeat(81), message: 'm' },
    ]) {
      const res = await worker.fetch(say(body));
      expect([body, res.status]).toEqual([body, 400]);
    }
    expect(await rows()).toEqual([]);
  });

  it('refuses another site', async () => {
    const res = await worker.fetch(
      say({ what: 'web.x', message: 'm' }, { Origin: 'https://evil.example' }),
    );
    expect(res.status).toBe(403);
  });

  it('stops listening to a phone stuck in a loop, quietly', async () => {
    const now = Date.now();
    for (let i = 0; i < 35; i++) {
      const res = await postOops(say({ what: 'web.loop', message: `m${i}` }), env, false, now);
      expect(res.status).toBe(204);
    }
    expect((await rows()).length).toBe(30);
    // An hour on, it is heard again.
    await postOops(say({ what: 'web.loop', message: 'later' }), env, false, now + 61 * 60_000);
    expect((await rows()).length).toBe(31);
  });

  it('forgets after thirty days', async () => {
    const day = 24 * 60 * 60 * 1000;
    const now = Date.now();
    await recordOops(env, { side: 'worker', what: 'old', message: 'm' }, now - 31 * day);
    await recordOops(env, { side: 'worker', what: 'new', message: 'm' }, now);
    expect((await rows()).map((r) => r.what)).toEqual(['new']);
  });
});

describe('the Worker writing down what it did not see coming', () => {
  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM oops').run();
  });

  it('answers a bare 500 and keeps the stack', async () => {
    const pending: Promise<unknown>[] = [];
    const ctx = {
      waitUntil: (p: Promise<unknown>) => pending.push(p),
      passThroughOnException: () => {},
      props: {},
    } as unknown as ExecutionContext;
    const broken = {
      ...env,
      ASSETS: {
        fetch: () => {
          throw new Error('assets fell over');
        },
      },
    } as unknown as Env;

    const res = await handler.fetch(new Request('https://dads.test/somewhere'), broken, ctx);
    expect(res.status).toBe(500);
    await Promise.all(pending);
    const [row] = await rows();
    expect(row).toMatchObject({
      side: 'worker',
      what: 'GET /somewhere',
      message: 'Error: assets fell over',
    });
    expect(row?.detail).toContain('assets fell over');
  });
});
