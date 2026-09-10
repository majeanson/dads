import { expect, test } from '@playwright/test';
import { E2E_NIGHT_GROUP } from './global-setup';

// One group, one schedule: these would overwrite each other in parallel.
test.describe.configure({ mode: 'serial' });

test('a dad sets the group’s night and everyone sees it', async ({ browser }) => {
  const marcCtx = await browser.newContext();
  const marc = await marcCtx.newPage();
  await marc.goto('/');
  await marc.getByLabel('Code').fill(E2E_NIGHT_GROUP.code);
  await marc.getByLabel('Your name').fill('Marc');
  await marc.getByRole('button', { name: 'Come in' }).click();
  await expect(marc.getByTestId('connection')).toHaveText(/here$/);

  // A second dad is already in the room, watching.
  const samCtx = await browser.newContext();
  const sam = await samCtx.newPage();
  await sam.goto('/');
  await sam.getByLabel('Code').fill(E2E_NIGHT_GROUP.code);
  await sam.getByLabel('Your name').fill('Sam');
  await sam.getByRole('button', { name: 'Come in' }).click();
  // With no night set the bar is one link and nothing else.
  await expect(sam.getByTestId('dad-night')).toContainText('Set dad night');

  await marc.getByRole('button', { name: 'Set dad night' }).click();
  await marc.getByLabel('Day').selectOption('4');
  await marc.getByLabel('Time').fill('21:00');
  await marc.getByRole('button', { name: 'Save' }).click();

  // Marc sees the countdown; Sam gets it pushed without reloading.
  await expect(marc.getByTestId('dad-night')).toContainText('thursdays at 21:00');
  await expect(marc.getByTestId('dad-night')).toContainText(/in \d+ (day|hour|minute)/);
  await expect(sam.getByTestId('dad-night')).toContainText('thursdays at 21:00');
  await expect(
    sam.getByTestId('line').filter({ hasText: 'Marc set dad night to Thursdays at 21:00.' }),
  ).toBeVisible();

  // It survives a reload, because it lives in D1 and not in the tab.
  await marc.reload();
  await expect(marc.getByTestId('dad-night')).toContainText('thursdays at 21:00');

  await marcCtx.close();
  await samCtx.close();
});
