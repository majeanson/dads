import { expect, test } from '@playwright/test';
import { E2E_LINKS_GROUP } from './global-setup';
import { talk } from './talk';

/**
 * A link in the conversation gets a card: what the page says about itself,
 * fetched by the Worker. The page is the app's own door — the one page this
 * stack serves with Open Graph tags on it, and the one address a test can
 * trust to be there.
 */
test.describe.configure({ mode: 'serial' });

async function comeIn(page: Parameters<typeof talk>[0], name: string): Promise<void> {
  await page.goto('/');
  await page.getByLabel('The word').fill(E2E_LINKS_GROUP.code);
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Come in' }).click();
  await expect(page.getByTestId('connection')).toHaveText(/here$/);
  await talk(page);
}

test('a link gets a card with what the page says about itself', async ({ page, baseURL }) => {
  await comeIn(page, 'Lou Link');
  const href = `${baseURL}/`;
  await page.getByLabel('Say something').fill(`have a look ${href}`);
  await page.getByRole('button', { name: 'Send' }).click();

  const line = page.getByTestId('line').filter({ hasText: 'have a look' });
  await expect(line).toBeVisible();
  // The words are still a link of their own; the card is the second way in.
  await expect(line.locator('.body > a').first()).toHaveAttribute('href', href);
  const card = line.getByTestId('link-card');
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute('href', href);
  await expect(card.locator('.link-card-title')).toHaveText('dads');
  await expect(card.locator('.link-card-site')).toHaveText('dads');
});

test('a page with nothing to say leaves the line as it was', async ({ page, baseURL }) => {
  await comeIn(page, 'Lou Link');
  const href = `${baseURL}/api/health`;
  const asked = page.waitForResponse((res) => res.url().includes('/api/unfurl?'));
  await page.getByLabel('Say something').fill(`nothing here ${href}`);
  await page.getByRole('button', { name: 'Send' }).click();
  const line = page.getByTestId('line').filter({ hasText: 'nothing here' });
  await expect(line).toBeVisible();
  expect((await asked).status()).toBe(204);
  await expect(line.getByTestId('link-card')).toHaveCount(0);
});
