import { expect, test, type Browser, type Page } from '@playwright/test';
import { E2E_HOME_GROUP } from './global-setup';
import { talk } from './talk';

/**
 * Where the app opens.
 *
 * Four of the five questions a dad has when he picks up his phone are not
 * "what was said": when the night is, whether anyone is about, whether he has
 * answered, and whether anything is waiting for him. This is that screen, and
 * the conversation is one tap past it.
 */
test.describe.configure({ mode: 'serial' });

async function comeIn(browser: Browser, name: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/');
  await page.getByLabel('Code').fill(E2E_HOME_GROUP.code);
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Come in' }).click();
  await expect(page.getByTestId('connection')).toHaveText(/here$/);
  return page;
}

test('the app opens on home, and the conversation is one tap away', async ({ browser }) => {
  const marc = await comeIn(browser, 'Marc');

  // Through the door and onto home, not into the conversation.
  await expect(marc.getByTestId('home')).toBeVisible();
  await expect(marc.getByLabel('Say something')).toBeHidden();

  await marc.getByTestId('home-go').click();
  await expect(marc.getByLabel('Say something')).toBeVisible();
  await expect(marc.getByTestId('home')).toBeHidden();

  // And back, by the group's own name — where a logo goes in every app
  // anybody has ever used.
  await marc.getByTestId('go-home').click();
  await expect(marc.getByTestId('home')).toBeVisible();

  await marc.context().close();
});

test('home says when the night is, and takes his answer', async ({ browser }) => {
  const marc = await comeIn(browser, 'Marc');

  // Set from the menu, which is reachable from home like everything else.
  await marc.getByRole('button', { name: 'Menu' }).click();
  await marc.getByTestId('dad-night').click();
  await marc.getByLabel('Day').selectOption('4');
  await marc.getByLabel('Time').fill('21:00');
  await marc.getByRole('button', { name: 'Save' }).click();
  await marc.getByRole('button', { name: 'Close', exact: true }).click();

  await expect(marc.getByTestId('home-when')).toContainText('Thursdays at 21:00');

  // Answering is on home rather than two taps into a sheet: who is coming is
  // the question that decides turnout.
  await marc.getByTestId('home-in').click();
  await expect(marc.getByTestId('home-who-coming')).toContainText('In: Marc');

  await marc.context().close();
});

test('home says who is about, and counts what he has not read', async ({ browser }) => {
  const marc = await comeIn(browser, 'Marc');
  const sam = await comeIn(browser, 'Sam');

  // Live, because the socket is open behind home rather than opened on the
  // way into the conversation. By name: which of his friends is about is the
  // thing he opened the app to find out, and a count is not that.
  await expect(marc.getByTestId('home-faces')).toContainText('Sam');

  // Sam talks while Marc is standing on home. The way in says how many.
  // Counted as a CHANGE rather than an absolute: the room's own lines are
  // lines too, and an earlier test in this group set the night.
  const count = async () => {
    const mark = marc.getByTestId('home-new');
    if ((await mark.count()) === 0) return 0;
    return Number(/\d+/.exec((await mark.textContent()) ?? '')?.[0] ?? 1);
  };
  const before = await count();

  await talk(sam);
  await sam.getByLabel('Say something').fill('bedtime was a war tonight');
  await sam.getByRole('button', { name: 'Send' }).click();
  await expect.poll(count).toBe(before + 1);

  // And going in clears it.
  await marc.getByTestId('home-go').click();
  await expect(marc.getByTestId('line').filter({ hasText: 'bedtime was a war' })).toBeVisible();
  await marc.getByTestId('go-home').click();
  await expect(marc.getByTestId('home-new')).toHaveCount(0);

  await marc.context().close();
  await sam.context().close();
});

test('what he has already read is not announced again on the next open', async ({ browser }) => {
  const marc = await comeIn(browser, 'Reader');
  const sam = await comeIn(browser, 'Teller');

  await talk(sam);
  for (const line of ['one', 'two', 'three']) {
    await sam.getByLabel('Say something').fill(`something ${line}`);
    await sam.getByRole('button', { name: 'Send' }).click();
    await expect(sam.getByTestId('line').filter({ hasText: `something ${line}` })).toBeVisible();
  }

  // He reads them: into the conversation, at the bottom, tab in front of him.
  await marc.getByTestId('home-go').click();
  await expect(marc.getByTestId('line').filter({ hasText: 'something three' })).toBeVisible();
  await marc.getByTestId('go-home').click();
  await expect(marc.getByTestId('home-new')).toHaveCount(0);

  // And a cold open says nothing new, because it counts against what he has
  // read rather than tallying whatever the backfill happens to carry. That
  // tally began each load at nought, which announced the whole evening again.
  await marc.reload();
  await expect(marc.getByTestId('connection')).toHaveText(/here$/);
  await expect(marc.getByTestId('home')).toBeVisible();
  await expect(marc.getByTestId('home-new')).toHaveCount(0);

  // A line said while he is on home still counts, and only that one.
  await sam.getByLabel('Say something').fill('and one more');
  await sam.getByRole('button', { name: 'Send' }).click();
  await expect(marc.getByTestId('home-new')).toContainText('1 new');

  await marc.context().close();
  await sam.context().close();
});

test('home names who is about, and the header has its own way back', async ({ browser }) => {
  const marc = await comeIn(browser, 'Ned');
  const sam = await comeIn(browser, 'Otto');

  // Names, not only a count: which of his friends is about is what he opened
  // the app to find out.
  await expect(marc.getByTestId('home-faces')).toContainText('Otto');

  // The way back is a control of its own, not the group's name.
  await marc.getByTestId('home-go').click();
  const back = marc.getByTestId('go-home');
  await expect(back).toBeVisible();
  await expect(back).toHaveAccessibleName('Home');
  const box = (await back.boundingBox())!;
  expect(box.height, 'a thumb has to be able to hit it').toBeGreaterThanOrEqual(36);
  await back.click();
  await expect(marc.getByTestId('home')).toBeVisible();

  await marc.context().close();
  await sam.context().close();
});

test('home keeps up with who is coming while he sits on it', async ({ browser }) => {
  const marc = await comeIn(browser, 'Pim');
  const sam = await comeIn(browser, 'Quill');

  // Marc stays on home. Sam goes and answers from the sheet.
  await expect(marc.getByTestId('home')).toBeVisible();
  await sam.getByRole('button', { name: 'Menu' }).click();
  await sam.getByTestId('dad-night').click();
  await sam.getByTestId('rsvp-in').click();
  await expect(sam.getByTestId('rsvp-who')).toContainText('Quill');

  // Home is a live screen, so it must not go on showing a list the room has
  // already contradicted a foot below.
  await expect(marc.getByTestId('home-who-coming')).toContainText('Quill', { timeout: 10_000 });

  await marc.context().close();
  await sam.context().close();
});
