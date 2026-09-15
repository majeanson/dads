import { expect, test } from '@playwright/test';
import { home, talk } from './talk';
import { E2E_INVITE_GROUP } from './global-setup';

test('a dad sends a link, and the man who follows it never sees the code', async ({ browser }) => {
  const first = await browser.newContext();
  const marc = await first.newPage();

  await marc.goto('/');
  await marc.getByLabel('Code').fill(E2E_INVITE_GROUP.code);
  await marc.getByLabel('Your name').fill('Marc');
  await marc.getByRole('button', { name: 'Come in' }).click();
  await expect(marc.getByTestId('connection')).toHaveText(/here$/);
  await home(marc);
  await marc.getByRole('button', { name: 'Invite a dad' }).click();
  const link = await marc.getByTestId('invite-link').inputValue();
  expect(link).toMatch(/\/i\/[A-Za-z0-9_-]{32,}$/);

  // A fresh browser is a stranger: no cookie, no device token, no code.
  const second = await browser.newContext();
  const sam = await second.newPage();
  await sam.goto(link);

  await expect(sam.getByLabel('Your name')).toBeVisible();
  await expect(sam.getByLabel('Code')).toHaveCount(0);
  // And the token is off the address bar before he has typed anything: it is
  // a credential, and it has no business in a screenshot of the door.
  expect(new URL(sam.url()).pathname).toBe('/');

  await sam.getByLabel('Your name').fill('Sam');
  await sam.getByRole('button', { name: 'Come in' }).click();

  await expect(sam.getByTestId('connection')).toHaveText(/here$/);

  await talk(sam);
  await expect(marc.getByTestId('connection')).toHaveText('2 here');

  await first.close();
  await second.close();
});
