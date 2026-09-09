import { env, exports as workerExports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { sessionSecret } from '../src/worker/env';

const worker = workerExports.default;

describe('M0 skeleton', () => {
  it('reports a healthy worker and a reachable D1', async () => {
    const res = await worker.fetch('https://dads.test/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, db: true });
  });

  it('404s unknown api routes as JSON rather than falling through to assets', async () => {
    const res = await worker.fetch('https://dads.test/api/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('applies the schema: every v1 table exists', async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    ).all<{ name: string }>();
    const names = results.map((r: { name: string }) => r.name);
    for (const table of [
      'groups',
      'members',
      'messages',
      'prompts',
      'prompt_days',
      'check_ins',
      'commitments',
    ]) {
      expect(names).toContain(table);
    }
  });

  it('refuses a websocket without a session', async () => {
    const res = await worker.fetch('https://dads.test/ws', {
      headers: { Upgrade: 'websocket' },
    });
    expect(res.status).toBe(401);
  });

  it('refuses a plain GET on the websocket path', async () => {
    const res = await worker.fetch('https://dads.test/ws');
    expect(res.status).toBe(426);
  });

  it('gives each group slug its own Durable Object', async () => {
    const read = async (name: string) => {
      const stub = env.ROOM.get(env.ROOM.idFromName(name));
      return (await (await stub.fetch('https://do/health')).json()) as { id: string };
    };
    const [a, b] = await Promise.all([read('the-dads'), read('other-dads')]);
    expect(a.id).not.toBe(b.id);
  });

  it('refuses to fall back to the dev session secret in production', () => {
    expect(() => sessionSecret({} as never, true)).toThrow('SESSION_SECRET is not set');
    expect(sessionSecret({} as never, false)).toBe('dev-only-insecure-secret');
  });
});
