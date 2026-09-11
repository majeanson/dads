import { env, exports as workerExports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { forget } from '../src/worker/routes/ops';
import { cookieFrom, postJoin, resetTables, seedGroup } from './helpers';

const worker = workerExports.default;

function ask(body: unknown, secret?: string): Request {
  return new Request('https://dads.test/api/ops/forget', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(secret === undefined ? {} : { 'X-Dads-Ops': secret }),
    },
    body: JSON.stringify(body),
  });
}

describe('taking a line back out of the room', () => {
  beforeEach(resetTables);

  it('does not exist unless somebody set the secret', async () => {
    // Absent is a 404, not a 403: a route nobody configured should not be
    // discoverable by the shape of its refusal.
    const res = await forget(ask({ like: '%anything%' }, 'guess'), env);
    expect(res.status).toBe(404);
  });

  it('refuses a wrong secret the same way it refuses no secret', async () => {
    const on = { ...env, OPS_SECRET: 'the-real-one' };
    expect((await forget(ask({ like: '%x%' }, 'wrong'), on)).status).toBe(404);
    expect((await forget(ask({ like: '%x%' }), on)).status).toBe(404);
  });

  it('refuses a pattern broad enough to empty the room by accident', async () => {
    const on = { ...env, OPS_SECRET: 'the-real-one' };
    for (const like of ['%', '%a%', '', 'x'.repeat(201)]) {
      const res = await forget(ask({ like }, 'the-real-one'), on);
      expect([like, res.status]).toEqual([like, 400]);
    }
  });

  it('takes the line out of the archive, and says how many', async () => {
    const on = { ...env, OPS_SECRET: 'the-real-one' };
    const group = await seedGroup();
    const cookie = cookieFrom(
      await worker.fetch(postJoin({ code: group.code, displayName: 'Marc' })),
    );
    expect(cookie).toBeTruthy();

    const member = await env.DB.prepare('SELECT id FROM members').first<{ id: string }>();
    for (const body of ['prove-one said this', 'prove-two said that', 'a real line']) {
      await env.DB.prepare(
        `INSERT INTO messages (id, group_id, member_id, kind, body, created_at)
         VALUES (?, ?, ?, 'chat', ?, ?)`,
      )
        .bind(`msg_${body.slice(0, 8)}`, group.id, member!.id, body, Date.now())
        .run();
    }

    const res = await forget(ask({ like: '%prove-%' }, 'the-real-one'), on);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { archive: number }).archive).toBe(2);

    // And what nobody asked to forget is still there.
    const left = await env.DB.prepare('SELECT body FROM messages').all<{ body: string }>();
    expect(left.results.map((r) => r.body)).toEqual(['a real line']);
  });
});
