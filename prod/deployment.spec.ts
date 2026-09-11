import { expect, test } from '@playwright/test';

/**
 * The deployment, not the code.
 *
 * Everything here is answered by something that only exists in production: the
 * custom domain, the assets binding, `public/_headers`, and secrets that are
 * deliberately absent everywhere else.
 */
test.describe.configure({ mode: 'serial' });

test('the worker is up and can reach its database', async ({ request }) => {
  const health = await request.get('/api/health');
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ ok: true, db: true });
});

test('the headers are the ones public/_headers ships', async ({ request }) => {
  // These cannot come from the Worker: run_worker_first covers only /api and
  // /ws, so for every other path the assets binding answers first and a
  // wrapper around env.ASSETS.fetch never runs. If this fails, the file did
  // not ship — which is invisible until somebody frames the room.
  const res = await request.get('/');
  const headers = res.headers();
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
});

test('the SPA fallback does not swallow the API', async ({ request }) => {
  // A browser-navigated GET to an unknown API route must be a 404 from the
  // Worker, not the shell with a 200 — which is how a broken endpoint looks
  // like a blank page instead of an error.
  const missing = await request.get('/api/nothing-here', {
    headers: { Accept: 'text/html', 'Sec-Fetch-Mode': 'navigate' },
  });
  expect(missing.status()).toBe(404);
  expect(missing.headers()['content-type']).toContain('json');

  // And an unknown page IS the shell, because the room is a single page.
  const page = await request.get('/some/deep/link');
  expect(page.status()).toBe(200);
  expect(await page.text()).toContain('<div id="root">');
});

test('a private room stays out of the index', async ({ request }) => {
  const robots = await request.get('/robots.txt');
  expect(await robots.text()).toContain('Disallow: /');

  const shell = await (await request.get('/')).text();
  expect(shell).toContain('noindex');
});

test('it is a real app to a phone, not a bookmark', async ({ request }) => {
  const manifest = await request.get('/manifest.webmanifest');
  const parsed = (await manifest.json()) as { name: string; display: string; icons: unknown[] };
  expect(parsed.display).toBe('standalone');
  expect(parsed.icons.length).toBeGreaterThan(2);

  for (const [path, type] of [
    ['/favicon.ico', 'image'],
    ['/icon.svg', 'svg'],
    ['/apple-touch-icon.png', 'png'],
    ['/icon-192.png', 'png'],
    ['/icon-512.png', 'png'],
    ['/sw.js', 'javascript'],
  ]) {
    const res = await request.get(path!);
    expect(res.status(), path).toBe(200);
    expect(res.headers()['content-type'], path).toContain(type!);
  }
});

test('nothing behind the door answers without a session', async ({ request }) => {
  // Every one of these reads or writes somebody's group. Checked against the
  // real cookie check rather than a faked one.
  for (const path of [
    '/api/me',
    '/api/todo',
    '/api/board',
    '/api/night',
    '/api/prompt',
    '/api/prompts',
    '/api/presence',
    '/api/table',
    '/api/ice',
    '/api/push',
    '/api/media?id=anything',
    '/api/media-list',
    '/api/night.ics',
  ]) {
    const res = await request.get(path);
    // /api/me is the one that answers "nobody" rather than "no": a first
    // visit is the normal state, not a failure.
    expect([path, res.status()]).toEqual([path, path === '/api/me' ? 204 : 401]);
  }
});
