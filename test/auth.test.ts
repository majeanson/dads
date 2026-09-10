import { env, exports as workerExports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  hashInviteCode,
  normalizeInviteCode,
  PBKDF2_ITERATIONS,
  timingSafeEqual,
} from '../src/worker/crypto';
import { identityCookie, signIdentity, verifyIdentity } from '../src/worker/identity';
import { cookieFrom, postJoin, resetTables, seedGroup, type SeededGroup } from './helpers';

const worker = workerExports.default;

describe('crypto', () => {
  it('stays under the ceiling the Workers runtime actually enforces', () => {
    // Local workerd allows more; production does not, and fails the request
    // outright rather than degrading. This test is the only thing standing
    // between a raised constant and a dead front door.
    expect(PBKDF2_ITERATIONS).toBeLessThanOrEqual(100_000);
  });

  it('normalizes invite codes so case and spacing never lock a dad out', () => {
    expect(normalizeInviteCode('  Maple   OTTER cedar\tFern ')).toBe('maple otter cedar fern');
  });

  it('hashes normalized codes identically and different codes differently', async () => {
    const a = await hashInviteCode('Maple Otter', 'salt');
    expect(await hashInviteCode('maple  otter', 'salt')).toBe(a);
    expect(await hashInviteCode('maple otter', 'other-salt')).not.toBe(a);
    expect(await hashInviteCode('maple badger', 'salt')).not.toBe(a);
  });

  it('compares in constant time', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'ab')).toBe(false);
  });
});

describe('identity cookie', () => {
  const identity = { groupId: 'grp_1', memberId: 'mem_1' };

  it('round-trips a signed identity', async () => {
    const value = await signIdentity(env, identity, false);
    expect(await verifyIdentity(env, value, false)).toEqual(identity);
  });

  it('rejects a tampered payload, a bad signature, and garbage', async () => {
    const value = await signIdentity(env, identity, false);
    const [body, sig] = value.split('.') as [string, string];
    const forged = btoa(JSON.stringify({ v: 1, groupId: 'grp_1', memberId: 'mem_2' })).replace(
      /=+$/,
      '',
    );
    expect(await verifyIdentity(env, `${forged}.${sig}`, false)).toBeNull();
    expect(await verifyIdentity(env, `${body}.${sig.slice(0, -1)}x`, false)).toBeNull();
    expect(await verifyIdentity(env, 'nonsense', false)).toBeNull();
    expect(await verifyIdentity(env, null, false)).toBeNull();
  });

  it('is Secure only in production, HttpOnly and Lax always', () => {
    expect(identityCookie('v', true)).toContain('Secure');
    expect(identityCookie('v', false)).not.toContain('Secure');
    for (const prod of [true, false]) {
      expect(identityCookie('v', prod)).toContain('HttpOnly');
      expect(identityCookie('v', prod)).toContain('SameSite=Lax');
    }
  });
});

describe('POST /api/join', () => {
  let group: SeededGroup;
  beforeEach(async () => {
    await resetTables();
    group = await seedGroup();
  });

  it('lets a dad in with the right code and sets the identity cookie', async () => {
    const res = await worker.fetch(postJoin({ code: group.code, displayName: 'Marc' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      group: { slug: string };
      member: { id: string; displayName: string };
      deviceToken: string;
    };
    expect(body.group.slug).toBe(group.slug);
    expect(body.member.displayName).toBe('Marc');
    expect(body.deviceToken).toBeTruthy();
    expect(res.headers.get('Set-Cookie')).toMatch(
      /^dads_id=[^;]+; Path=\/; HttpOnly; SameSite=Lax/,
    );
  });

  it('accepts the code regardless of case and spacing', async () => {
    const res = await worker.fetch(
      postJoin({ code: `  ${group.code.toUpperCase()}  `, displayName: 'Marc' }),
    );
    expect(res.status).toBe(200);
  });

  it('rejects a wrong code without saying why', async () => {
    const res = await worker.fetch(
      postJoin({ code: 'maple otter cedar fer', displayName: 'Marc' }),
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'bad_code' });
    expect(res.headers.get('Set-Cookie')).toBeNull();
  });

  it('validates the name', async () => {
    expect((await worker.fetch(postJoin({ code: group.code, displayName: '   ' }))).status).toBe(
      400,
    );
    expect(
      (await worker.fetch(postJoin({ code: group.code, displayName: 'x'.repeat(33) }))).status,
    ).toBe(400);
    expect((await worker.fetch(postJoin({ displayName: 'Marc' }))).status).toBe(400);
  });

  it('recognises the same device on return instead of creating a second dad', async () => {
    const first = (await (
      await worker.fetch(postJoin({ code: group.code, displayName: 'Marc' }))
    ).json()) as { member: { id: string }; deviceToken: string };

    const again = (await (
      await worker.fetch(
        postJoin({ code: group.code, displayName: 'Marc J', deviceToken: first.deviceToken }),
      )
    ).json()) as { member: { id: string; displayName: string } };

    expect(again.member.id).toBe(first.member.id);
    expect(again.member.displayName).toBe('Marc J');

    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM members WHERE group_id = ?')
      .bind(group.id)
      .first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it('treats a new device as a new member', async () => {
    await worker.fetch(postJoin({ code: group.code, displayName: 'Marc' }));
    await worker.fetch(postJoin({ code: group.code, displayName: 'Marc' }));
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM members WHERE group_id = ?')
      .bind(group.id)
      .first<{ n: number }>();
    expect(count?.n).toBe(2);
  });

  it('lands in the right group when several exist', async () => {
    const other = await seedGroup({ name: 'Other Dads', code: 'Birch Comet Quill Sage' });
    const res = await worker.fetch(postJoin({ code: other.code, displayName: 'Sam' }));
    const body = (await res.json()) as { group: { slug: string } };
    expect(body.group.slug).toBe(other.slug);
  });

  it('locks an address out after ten failures and lets it back in after a success', async () => {
    const ip = { 'CF-Connecting-IP': '203.0.113.7' };
    for (let i = 0; i < 10; i++) {
      const res = await worker.fetch(postJoin({ code: 'wrong', displayName: 'x' }, ip));
      expect(res.status).toBe(401);
    }
    const locked = await worker.fetch(postJoin({ code: group.code, displayName: 'Marc' }, ip));
    expect(locked.status).toBe(429);
    expect(locked.headers.get('Retry-After')).toMatch(/^\d+$/);

    // A different address is unaffected.
    const other = await worker.fetch(
      postJoin({ code: group.code, displayName: 'Marc' }, { 'CF-Connecting-IP': '203.0.113.8' }),
    );
    expect(other.status).toBe(200);
  });

  it('does not count a successful join as a failure', async () => {
    const ip = { 'CF-Connecting-IP': '203.0.113.9' };
    for (let i = 0; i < 9; i++) {
      await worker.fetch(postJoin({ code: 'wrong', displayName: 'x' }, ip));
    }
    expect(
      (await worker.fetch(postJoin({ code: group.code, displayName: 'Marc' }, ip))).status,
    ).toBe(200);
    // The success cleared the bucket: nine more wrong tries are allowed again.
    for (let i = 0; i < 9; i++) {
      expect((await worker.fetch(postJoin({ code: 'wrong', displayName: 'x' }, ip))).status).toBe(
        401,
      );
    }
  });
});

describe('GET /api/me and POST /api/leave', () => {
  beforeEach(resetTables);

  it('is 204 for a stranger', async () => {
    const res = await worker.fetch('https://dads.test/api/me');
    expect(res.status).toBe(204);
  });

  it('returns the session behind a valid cookie', async () => {
    const group = await seedGroup();
    const joined = await worker.fetch(postJoin({ code: group.code, displayName: 'Marc' }));
    const cookie = cookieFrom(joined);

    const res = await worker.fetch('https://dads.test/api/me', { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { group: { slug: string }; member: { displayName: string } };
    expect(body.group.slug).toBe(group.slug);
    expect(body.member.displayName).toBe('Marc');
  });

  it('is 204 once the member behind the cookie is gone', async () => {
    const group = await seedGroup();
    const joined = await worker.fetch(postJoin({ code: group.code, displayName: 'Marc' }));
    const cookie = cookieFrom(joined);
    await env.DB.prepare('DELETE FROM members WHERE group_id = ?').bind(group.id).run();

    const res = await worker.fetch('https://dads.test/api/me', { headers: { Cookie: cookie } });
    expect(res.status).toBe(204);
  });

  it('leave clears the cookie', async () => {
    const res = await worker.fetch('https://dads.test/api/leave', { method: 'POST' });
    expect(res.status).toBe(204);
    expect(res.headers.get('Set-Cookie')).toMatch(/^dads_id=; .*Max-Age=0/);
  });
});
