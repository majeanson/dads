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
