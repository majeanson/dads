import { expect, test } from '@playwright/test';

test('the shell loads and reports the stack it is standing on', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'dads' })).toBeVisible();
  await expect(page.getByTestId('health')).toHaveText('stack: worker up, d1 up');
});
