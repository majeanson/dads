import { expect, test } from '@playwright/test';
import { night, talk } from './talk';
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
  await talk(marc);

  // A second dad is already in the room, watching.
  const samCtx = await browser.newContext();
  const sam = await samCtx.newPage();
  await sam.goto('/');
  await sam.getByLabel('Code').fill(E2E_NIGHT_GROUP.code);
  await sam.getByLabel('Your name').fill('Sam');
  await sam.getByRole('button', { name: 'Come in' }).click();
  await expect(sam.getByTestId('connection')).toHaveText(/here$/);
  await talk(sam);
  // With no night set the room says nothing about it anywhere.
  await expect(sam.getByTestId('night-soon')).toHaveCount(0);

  // It is set where it is answered: home's card, which is the night.
  await night(marc);
  await marc.getByTestId('night-standing').click();
  await marc.getByLabel('Day').selectOption('4');
  await marc.getByLabel('Time').fill('21:00');
  await marc.getByRole('button', { name: 'Save' }).click();
  await marc.getByRole('button', { name: 'Close', exact: true }).click();
  await talk(marc);

  // Both headers carry it without a reload: "when is it again" should not
  // cost anybody a tap.
  // Asserted on the control, not on its words: what it says depends on how
  // close the night is, and this test runs on every day of the week.
  await expect(marc.getByTestId('night-soon')).toBeVisible();
  await expect(sam.getByTestId('night-soon')).toBeVisible();
  // Sam's screen has it without a reload and without being told in words:
  // the night is a thing the app SHOWS, in the header and on home, and a
  // line saying it had been set was the room narrating its own state.
  await expect(sam.getByTestId('line')).toHaveCount(0);

  // It survives a reload, because it lives in D1 and not in the tab. A reload
  // lands on home, where the night is the first thing on the screen rather
  // than a line in the header — the header does not repeat it there.
  await marc.reload();
  const when = marc.getByTestId('home-when');
  await expect(when).toContainText('Thursday');
  await expect(when).toContainText('21:00');
  await talk(marc);
  await expect(marc.getByTestId('night-soon')).toBeVisible();

  // And the question the standing slot never answered: who is actually
  // coming. Marc says he is, in front of Sam.
  await marc.getByTestId('night-soon').click();
  await marc.getByTestId('rsvp-in').click();
  await expect(marc.getByTestId('rsvp-who')).toContainText('In: Marc');
  // Sam finds out on the night's own screen, live — the answer itself rather
  // than a sentence about somebody having answered.
  await night(sam);
  await expect(sam.getByTestId('rsvp-who')).toContainText('In: Marc', { timeout: 15_000 });

  // Changing his mind rewrites the answer rather than adding a second one.
  await marc.getByTestId('rsvp-out').click();
  await expect(marc.getByTestId('rsvp-who')).toContainText('Can’t: Marc');
  await expect(marc.getByTestId('rsvp-who')).not.toContainText('In: Marc');
  await expect(sam.getByTestId('rsvp-who')).toContainText('Can’t: Marc', { timeout: 15_000 });

  // And the thing the standing slot was always missing: what we are there to
  // talk about. Marc puts one up on Tuesday; it is there on Thursday, and Sam
  // sees it go up without opening anything.
  await marc.getByLabel('Add', { exact: true }).fill('How do you handle bedtime?');
  await marc.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(marc.getByTestId('agenda-item')).toContainText('How do you handle bedtime?');
  await expect(marc.getByTestId('agenda-item')).toContainText('Marc');

  // Sam sees it in his own sheet — which is where the things themselves are,
  // and always was — without touching anything: the sheet has been open in
  // front of him the whole time and keeps up on its own.
  const samsView = sam.getByTestId('agenda-item').filter({ hasText: 'bedtime' });
  await expect(samsView).toBeVisible({ timeout: 15_000 });
  await expect(samsView.getByRole('button', { name: 'Take it back' })).toHaveCount(0);

  // Marc can.
  await marc.getByTestId('agenda-item').getByRole('button', { name: 'Take it back' }).click();
  await expect(marc.getByTestId('agenda-item')).toHaveCount(0);

  await marcCtx.close();
  await samCtx.close();
});
