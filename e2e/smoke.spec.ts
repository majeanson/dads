import { expect, test } from '@playwright/test';

test('the stack answers: assets serve the shell, the worker reaches D1', async ({
  page,
  request,
}) => {
  const health = await request.get('/api/health');
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ ok: true, db: true });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'dads' })).toBeVisible();
});

/**
 * What a browser asks for before anyone has typed anything.
 *
 * All of it was answered with the SPA's own HTML and a 200 until now, which
 * is how you end up with a blank tab and a blank square on a home screen.
 */
test('the app is a real app to a browser: icon, manifest, and no crawlers', async ({ request }) => {
  const icon = await request.get('/favicon.ico');
  expect(icon.status()).toBe(200);
  expect(icon.headers()['content-type']).toContain('image');

  const svg = await request.get('/icon.svg');
  expect(svg.headers()['content-type']).toContain('svg');

  const apple = await request.get('/apple-touch-icon.png');
  expect(apple.headers()['content-type']).toContain('png');

  const manifest = await request.get('/manifest.webmanifest');
  const parsed = (await manifest.json()) as { name: string; display: string; icons: unknown[] };
  expect(parsed.name).toBe('dads');
  expect(parsed.display).toBe('standalone');
  expect(parsed.icons.length).toBeGreaterThan(2);

  // A private room on a public domain.
  const robots = await request.get('/robots.txt');
  expect(await robots.text()).toContain('Disallow: /');
});

test('the shell carries the headers a page should carry', async ({ request }) => {
  const res = await request.get('/');
  const headers = res.headers();
  expect(headers['x-content-type-options']).toBe('nosniff');
  // Nothing frames dads: we frame jaffre, not the other way round.
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
});
