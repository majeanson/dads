import { expect, test } from '@playwright/test';

test('the stack answers: assets serve the shell, the worker reaches D1', async ({
  page,
  request,
}) => {
  const health = await request.get('/api/health');
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ ok: true, db: true });

  await page.goto('/');
  // The first page a run loads, often while the other worker is hammering
  // the same freshly booted server: the shell can take past the default five
  // seconds to paint, and failing there says nothing about the app.
  await expect(page.getByRole('heading', { name: 'dads' })).toBeVisible({ timeout: 15_000 });
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
  // Only marcportal.com may frame dads (the door, in its portfolio).
  expect(headers['x-frame-options']).toBeUndefined();
  // The CSP is a long line; pin the load-bearing directives rather than the
  // whole string, so adding an origin the client needs is not a test edit too.
  const csp = headers['content-security-policy'];
  expect(csp).toContain("default-src 'self'");
  // Clickjacking is still only the portal's to do.
  expect(csp).toContain("frame-ancestors 'self' https://marcportal.com https://*.marcportal.com");
  // The table is jaffre, framed cross-origin; default-src 'self' alone blocks it.
  expect(csp).toContain('https://jaffre.marcportal.com');
  expect(csp).toContain("object-src 'none'");
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  // HSTS: a page served over plain http once is a page an attacker can rewrite.
  expect(headers['strict-transport-security']).toContain('max-age=31536000');
});
