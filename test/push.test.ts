import { env, exports as workerExports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { cookieFrom, postJoin, resetTables, seedGroup, type SeededGroup } from './helpers';

const worker = workerExports.default;

/**
 * Dad-night reminders.
 *
 * The VAPID secrets are absent in tests, exactly as they are in a checkout
 * that has never set them — which is the case that has to stay harmless.
 */
describe('push', () => {
  let group: SeededGroup;

  beforeEach(async () => {
    await resetTables();
    group = await seedGroup();
  });

  async function cookieFor(name = 'Marc'): Promise<string> {
    return cookieFrom(await worker.fetch(postJoin({ code: group.code, displayName: name })));
  }

  it('says plainly that it cannot, rather than half-working', async () => {
    const cookie = await cookieFor();
    const res = await worker.fetch('https://dads.test/api/push', { headers: { cookie } });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe('unavailable');
  });

  it('never takes a subscription from a stranger', async () => {
    for (const method of ['GET', 'POST', 'DELETE']) {
      const res = await worker.fetch('https://dads.test/api/push', {
        method,
        body: method === 'GET' ? undefined : JSON.stringify({ endpoint: 'https://push.test/x' }),
      });
      expect(res.status).toBe(401);
    }
  });

  /**
   * The endpoint is a URL this Worker will later POST to. Anything that is not
   * a push service's own https address is somebody choosing where our server
   * sends its requests.
   */
  it('refuses an endpoint that is not an https address', async () => {
    const cookie = await cookieFor();
    for (const endpoint of ['http://push.test/x', 'file:///etc/passwd', '', 'not a url']) {
      const res = await worker.fetch('https://dads.test/api/push', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint, keys: { p256dh: 'k', auth: 'a' } }),
      });
      // 503 while the keys are absent, 400 once they are: never a write.
      expect([400, 503]).toContain(res.status);
    }
    const { results } = await env.DB.prepare('SELECT endpoint FROM push_subscriptions').all();
    expect(results).toHaveLength(0);
  });
});
