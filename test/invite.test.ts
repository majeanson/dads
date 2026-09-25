import { env, exports as workerExports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { INVITE_TTL_MS } from '../src/worker/routes/invite';
import { cookieFrom, postJoin, resetTables, seedGroup } from './helpers';

const worker = workerExports.default;

function mint(cookie: string): Request {
  return new Request('https://dads.test/api/invite', { method: 'POST', headers: { cookie } });
}

/** A dad in the room, and a link he has just made. */
async function inviteLink(): Promise<{ token: string; groupId: string; cookie: string }> {
  const group = await seedGroup();
  const joined = await worker.fetch(postJoin({ code: group.code, displayName: 'Marc' }));
  const cookie = cookieFrom(joined);
  const res = await worker.fetch(mint(cookie));
  expect(res.status).toBe(200);
  const body = (await res.json()) as { token: string; expiresAt: number };
  return { token: body.token, groupId: group.id, cookie };
}

describe('an invite link', () => {
  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM invites').run();
    await resetTables();
  });

  it('lets a dad in without the code, into the group that minted it', async () => {
    const { token, groupId } = await inviteLink();

    const res = await worker.fetch(postJoin({ invite: token, displayName: 'Sam' }));
    expect(res.status).toBe(200);
    const session = (await res.json()) as { group: { id: string } };
    expect(session.group.id).toBe(groupId);
  });

  it('keeps only the hash, so the table is worth nothing on its own', async () => {
    const { token } = await inviteLink();
    const row = await env.DB.prepare('SELECT token_hash FROM invites').first<{
      token_hash: string;
    }>();
    expect(row?.token_hash).toBeTruthy();
    expect(row?.token_hash).not.toBe(token);
  });

  it('refuses an expired one, and says only what a wrong code says', async () => {
    const { token } = await inviteLink();
    await env.DB.prepare('UPDATE invites SET expires_at = ?')
      .bind(Date.now() - 1000)
      .run();

    const res = await worker.fetch(postJoin({ invite: token, displayName: 'Sam' }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'bad_code' });
  });

  it('refuses an invented one', async () => {
    await inviteLink();
    const res = await worker.fetch(postJoin({ invite: 'x'.repeat(43), displayName: 'Sam' }));
    expect(res.status).toBe(401);
  });

  it('is a week long, and sweeps up the dead ones when a new one is made', async () => {
    const { cookie } = await inviteLink();
    const before = await env.DB.prepare('SELECT expires_at FROM invites').first<{
      expires_at: number;
    }>();
    expect(before!.expires_at - Date.now()).toBeGreaterThan(INVITE_TTL_MS - 60_000);

    await env.DB.prepare('UPDATE invites SET expires_at = ?')
      .bind(Date.now() - 1)
      .run();
    await worker.fetch(mint(cookie));

    const { results } = await env.DB.prepare('SELECT id FROM invites').all();
    expect(results).toHaveLength(1);
  });

  it('remembers the language it was sent in, and nothing that is not one', async () => {
    const { cookie } = await inviteLink();
    const send = (lang: unknown) =>
      worker.fetch(
        new Request('https://dads.test/api/invite', {
          method: 'POST',
          headers: { cookie, 'Content-Type': 'application/json' },
          body: JSON.stringify({ lang }),
        }),
      );
    const langs = async () =>
      (
        await env.DB.prepare('SELECT lang FROM invites ORDER BY created_at').all<{
          lang: string | null;
        }>()
      ).results.map((r) => r.lang);

    expect((await send('fr')).status).toBe(200);
    expect((await send('klingon')).status).toBe(200);
    // The one minted with no body at all, then French, then no language.
    expect(await langs()).toEqual([null, 'fr', null]);
  });

  it('cannot be minted by somebody who is not in the room', async () => {
    const res = await worker.fetch(new Request('https://dads.test/api/invite', { method: 'POST' }));
    expect(res.status).toBe(401);
  });
});
