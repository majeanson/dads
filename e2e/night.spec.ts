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
  await expect(sam.getByTestId('connection')).toHaveText(/here$/);
  // With no night set the room says nothing about it anywhere.
  await expect(sam.locator('.room-head')).not.toContainText('dad night');

  // It is set where it is answered: the menu's own dad-night item.
  await marc.getByRole('button', { name: 'Menu' }).click();
  await marc.getByTestId('dad-night').click();
  await marc.getByLabel('Day').selectOption('4');
  await marc.getByLabel('Time').fill('21:00');
  await marc.getByRole('button', { name: 'Save' }).click();

  // Both headers carry it without a reload: "when is it again" should not
  // cost anybody a tap.
  await expect(marc.locator('.room-head')).toContainText(/dad night/);
  await expect(sam.locator('.room-head')).toContainText(/dad night/);
  await expect(
    sam.getByTestId('line').filter({ hasText: 'Marc set dad night to Thursdays at 21:00.' }),
  ).toBeVisible();

  // It survives a reload, because it lives in D1 and not in the tab.
  await marc.reload();
  await expect(marc.locator('.room-head')).toContainText(/dad night/);

  // And the question the standing slot never answered: who is actually
  // coming. Marc says he is, in front of Sam.
  await marc
    .locator('.room-head')
    .getByRole('button', { name: /dad night/ })
    .click();
  await marc.getByTestId('rsvp-in').click();
  await expect(marc.getByTestId('rsvp-who')).toContainText('In: Marc');
  await expect(sam.getByTestId('line').filter({ hasText: 'Marc is in.' })).toBeVisible();

  // Changing his mind rewrites the answer rather than adding a second one.
  await marc.getByTestId('rsvp-out').click();
  await expect(marc.getByTestId('rsvp-who')).toContainText('Can’t: Marc');
  await expect(marc.getByTestId('rsvp-who')).not.toContainText('In: Marc');
  await expect(sam.getByTestId('line').filter({ hasText: 'Marc can’t make it.' })).toBeVisible();

  // And the thing the standing slot was always missing: what we are there to
  // talk about. Marc puts one up on Tuesday; it is there on Thursday, and Sam
  // sees it go up without opening anything.
  await marc.getByLabel('Add', { exact: true }).fill('How do you handle bedtime?');
  await marc.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(marc.getByTestId('agenda-item')).toContainText('How do you handle bedtime?');
  await expect(marc.getByTestId('agenda-item')).toContainText('Marc');
  await expect(
    sam.getByTestId('line').filter({ hasText: 'Marc, for dad night: How do you handle bedtime?' }),
  ).toBeVisible();

  // Sam sees it in his own sheet, and cannot take back what he did not write.
  await sam.getByRole('button', { name: 'Menu' }).click();
  await sam.getByTestId('dad-night').click();
  const samsView = sam.getByTestId('agenda-item').filter({ hasText: 'bedtime' });
  await expect(samsView).toBeVisible();
  await expect(samsView.getByRole('button', { name: 'Take it back' })).toHaveCount(0);

  // Marc can.
  await marc.getByTestId('agenda-item').getByRole('button', { name: 'Take it back' }).click();
  await expect(marc.getByTestId('agenda-item')).toHaveCount(0);

  await marcCtx.close();
  await samCtx.close();
});
