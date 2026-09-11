import { env, exports as workerExports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { acceptableEndpoint } from '../src/worker/routes/push';
import { cookieFrom, postJoin, resetTables, seedGroup, type SeededGroup } from './helpers';

const worker = workerExports.default;

/**
 * Dad-night reminders.
 *
 * The VAPID secrets are absent in tests, exactly as they are in a checkout
 * that has never set them — which is the case that has to stay harmless.
 */
/**
 * An endpoint is a URL this Worker will later POST to, on a schedule, with
 * nobody watching. Tested here rather than through the route, because without
 * VAPID keys the route answers 503 before it ever looks at the body — which
 * would have been a green test that proved nothing.
 */
describe('an endpoint the room will post to', () => {
  it('takes the services that issue them', () => {
    for (const endpoint of [
      'https://fcm.googleapis.com/fcm/send/abc123',
      'https://web.push.apple.com/QBcd-ef',
      'https://updates.push.services.mozilla.com/wpush/v2/gAAA',
      'https://ABC.notify.windows.com/w/?token=x',
      // What a real Chrome actually handed back when this was driven against
      // production. Not the host Google documents, and the reason the switch
      // would not stay on for most of the dads.
      'https://jmt17.google.com/fcm/send/fknEfdNabms:APA91bGGblD3YGkq',
    ]) {
      expect(acceptableEndpoint(endpoint)).toBe(true);
    }
  });

  it('refuses everywhere else, however it is dressed up', () => {
    for (const endpoint of [
      '',
      'not a url',
      'http://fcm.googleapis.com/x',
      'file:///etc/passwd',
      'https://evil.test/send/abc',
      // A lookalike host, and a real one smuggled past a naive check by
      // credentials or by a port.
      'https://fcm.googleapis.com.evil.test/x',
      'https://fcm.googleapis.com@evil.test/x',
      'https://user:pw@web.push.apple.com/x',
      'https://web.push.apple.com:8443/x',
      `https://web.push.apple.com/${'x'.repeat(1200)}`,
      // Google's hosts are matched by suffix, so the path is what narrows
      // them: anything else on those domains is not a push endpoint.
      'https://jmt17.google.com/robots.txt',
      'https://accounts.google.com/o/oauth2/token',
      'https://google.com.evil.test/fcm/send/x',
    ]) {
      expect(acceptableEndpoint(endpoint)).toBe(false);
    }
  });
});

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
   * The endpoint is a URL this Worker will later POST to, on a schedule, with
   * nobody watching. Anything that is not a real push service's own address is
   * somebody choosing where the room's server sends its requests.
   */
  it('refuses an endpoint that is not a push service', async () => {
    const cookie = await cookieFor();
    for (const endpoint of [
      'http://push.test/x',
      'file:///etc/passwd',
      '',
      'not a url',
      // The shapes that matter: somewhere else entirely, a lookalike host, a
      // host smuggled past a naive check by credentials or by a port.
      'https://evil.test/send/abc',
      'https://fcm.googleapis.com.evil.test/x',
      'https://fcm.googleapis.com@evil.test/x',
      'https://web.push.apple.com:8443/x',
      `https://web.push.apple.com/${'x'.repeat(1200)}`,
    ]) {
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
