import { env, exports as workerExports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { cookieFrom, postJoin, resetTables, seedGroup, type SeededGroup } from './helpers';

const worker = workerExports.default;

/**
 * The new device asks, a device that already is him says yes. A home-screen
 * app cannot open a link made in Safari, so the code goes the other way.
 */
describe('pairing a new device by a code', () => {
  let group: SeededGroup;
  beforeEach(async () => {
    await resetTables();
    group = await seedGroup();
  });

  const post = (path: string, body: unknown, cookie = '') =>
    worker.fetch(`https://dads.test${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify(body),
    });
  const join = async (name: string) => {
    const res = await worker.fetch(postJoin({ code: group.code, displayName: name }));
    const body = (await res.json()) as { member: { id: string } };
    return { cookie: cookieFrom(res), id: body.member.id };
  };
  const ask = async () =>
    (await (await post('/api/pair', {})).json()) as { code: string; poll: string };

  it('waits until a device says yes, then signs in as that dad, once', async () => {
    const marc = await join('Marc');
    const { code, poll } = await ask();
    expect(code).toMatch(/^[A-Z2-9]{8}$/);

    expect((await post('/api/pair/poll', { poll })).status).toBe(202);

    // Typed by hand: any case, any spacing.
    const yes = await post(
      '/api/pair/approve',
      { code: code.toLowerCase().replace(/^(....)/, '$1 ') },
      marc.cookie,
    );
    expect(yes.status).toBe(200);

    const got = await post('/api/pair/poll', { poll });
    expect(got.status).toBe(200);
    const me = (await (
      await worker.fetch('https://dads.test/api/me', { headers: { Cookie: cookieFrom(got) } })
    ).json()) as { member: { id: string } };
    expect(me.member.id).toBe(marc.id);

    expect((await post('/api/pair/poll', { poll })).status).toBe(404);
  });

  it('is only a dad who is already in who can say yes', async () => {
    const { code } = await ask();
    expect((await post('/api/pair/approve', { code })).status).toBe(401);
  });

  it('refuses a code nobody asked for, and counts it', async () => {
    const marc = await join('Marc');
    const no = await post('/api/pair/approve', { code: 'AAAAAAAA' }, marc.cookie);
    expect(no.status).toBe(404);
    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM join_attempts').first<{
      n: number;
    }>();
    expect(row!.n).toBeGreaterThan(0);
  });

  it('does not let a second dad take a code a first already answered', async () => {
    const marc = await join('Marc');
    const sam = await join('Sam');
    const { code } = await ask();
    expect((await post('/api/pair/approve', { code }, marc.cookie)).status).toBe(200);
    expect((await post('/api/pair/approve', { code }, sam.cookie)).status).toBe(404);
  });

  it('is dead after ten minutes', async () => {
    const marc = await join('Marc');
    const { code, poll } = await ask();
    await env.DB.prepare('UPDATE device_pairs SET expires_at = 1').run();
    expect((await post('/api/pair/approve', { code }, marc.cookie)).status).toBe(404);
    expect((await post('/api/pair/poll', { poll })).status).toBe(404);
  });
});
