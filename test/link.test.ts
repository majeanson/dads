import { env, exports as workerExports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { cookieFrom, postJoin, resetTables, seedGroup, type SeededGroup } from './helpers';

const worker = workerExports.default;

/**
 * One dad on two devices. A second phone joining by name is a second dad; the
 * only way to be the same one is a link minted from a device that already is.
 */
describe('linking another device', () => {
  let group: SeededGroup;
  beforeEach(async () => {
    await resetTables();
    group = await seedGroup();
  });

  const join = async (name: string) => {
    const res = await worker.fetch(postJoin({ code: group.code, displayName: name }));
    const body = (await res.json()) as { member: { id: string }; deviceToken: string };
    return { cookie: cookieFrom(res), id: body.member.id, deviceToken: body.deviceToken };
  };
  const post = (path: string, body: unknown, cookie = '') =>
    worker.fetch(`https://dads.test${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify(body),
    });
  const mint = async (cookie: string) =>
    ((await (await post('/api/link', {}, cookie)).json()) as { token: string }).token;

  it('refuses a stranger a link', async () => {
    expect((await post('/api/link', {})).status).toBe(401);
  });

  it('signs a second device in as the same dad, once', async () => {
    const marc = await join('Marc');
    const token = await mint(marc.cookie);

    const claimed = await post('/api/link/claim', { token });
    expect(claimed.status).toBe(200);
    const cookie = cookieFrom(claimed);
    const me = (await (
      await worker.fetch('https://dads.test/api/me', { headers: { Cookie: cookie } })
    ).json()) as { member: { id: string } };
    expect(me.member.id).toBe(marc.id);

    // Spent.
    expect((await post('/api/link/claim', { token })).status).toBe(401);
  });

  it('lets the linked device come back as him after losing its cookie', async () => {
    const marc = await join('Marc');
    const claimed = await post('/api/link/claim', { token: await mint(marc.cookie) });
    const { deviceToken } = (await claimed.json()) as { deviceToken: string };

    const again = await worker.fetch(
      new Request('https://dads.test/api/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: group.code, displayName: 'Marc', deviceToken }),
      }),
    );
    expect(((await again.json()) as { member: { id: string } }).member.id).toBe(marc.id);
  });

  it('does not find him by name alone', async () => {
    const marc = await join('Marc');
    const other = await join('Marc');
    expect(other.id).not.toBe(marc.id);
  });

  it('refuses an expired or invented link', async () => {
    const marc = await join('Marc');
    const token = await mint(marc.cookie);
    await env.DB.prepare('UPDATE device_links SET expires_at = 1').run();
    expect((await post('/api/link/claim', { token })).status).toBe(401);
    expect((await post('/api/link/claim', { token: 'x'.repeat(43) })).status).toBe(401);
  });

  it('drops a departed dad’s links and devices', async () => {
    const marc = await join('Marc');
    await post('/api/link/claim', { token: await mint(marc.cookie) });
    await mint(marc.cookie);
    const { depart } = await import('../src/worker/depart');
    await depart(env, group.id, marc.id);
    const left = await env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM member_devices) + (SELECT COUNT(*) FROM device_links) AS n`,
    ).first<{ n: number }>();
    expect(left?.n).toBe(0);
  });
});

describe('PUT /api/me/colour', () => {
  let group: SeededGroup;
  beforeEach(async () => {
    await resetTables();
    group = await seedGroup();
  });

  const put = (cookie: string, colour: unknown) =>
    worker.fetch('https://dads.test/api/me/colour', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ colour }),
    });

  it('keeps a colour from the six, and clears it with null', async () => {
    const res = await worker.fetch(postJoin({ code: group.code, displayName: 'Marc' }));
    const cookie = cookieFrom(res);
    const id = ((await res.json()) as { member: { id: string } }).member.id;
    const stored = () =>
      env.DB.prepare('SELECT colour FROM members WHERE id = ?')
        .bind(id)
        .first<{ colour: number | null }>();

    expect((await put(cookie, 4)).status).toBe(200);
    expect((await stored())?.colour).toBe(4);
    expect((await put(cookie, null)).status).toBe(200);
    expect((await stored())?.colour).toBeNull();
  });

  it('refuses anything else', async () => {
    const cookie = cookieFrom(await worker.fetch(postJoin({ code: group.code, displayName: 'M' })));
    for (const bad of [0, 7, 2.5, '3', {}]) expect((await put(cookie, bad)).status).toBe(400);
    expect((await put('', 3)).status).toBe(401);
  });
});
