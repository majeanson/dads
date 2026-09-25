import { expect, test } from '@playwright/test';
import { invite, talk } from './talk';
import { E2E_INVITE_GROUP } from './global-setup';

test('a dad sends a link, and the man who follows it never sees the code', async ({ browser }) => {
  const first = await browser.newContext();
  const marc = await first.newPage();

  await marc.goto('/');
  await marc.getByLabel('Code').fill(E2E_INVITE_GROUP.code);
  await marc.getByLabel('Your name').fill('Marc');
  await marc.getByRole('button', { name: 'Come in' }).click();
  await expect(marc.getByTestId('connection')).toHaveText(/here$/);
  await invite(marc);
  const link = await marc.getByTestId('invite-link').inputValue();
  expect(link).toMatch(/\/i\/[A-Za-z0-9_-]{32,}$/);

  // What a chat app unfurls from it: a crawler runs no script, so the room's
  // name has to be in the HTML the link itself serves — and a link that
  // opens nothing gets the plain preview, so a guess learns nothing.
  const unfurled = await (await first.request.get(link)).text();
  // Exactly one title: a crawler takes the first, and the shell's own "dads"
  // used to sit ahead of the room's name.
  expect(unfurled.match(/property="og:title"/g)).toHaveLength(1);
  expect(unfurled).toContain(`<meta property="og:title" content="${E2E_INVITE_GROUP.name}" />`);
  expect(unfurled).toContain('/og.png');
  expect(unfurled).toContain('<div id="root">');
  const made = new URL(link);
  const nothing = await (await first.request.get(`${made.origin}/i/${'x'.repeat(43)}`)).text();
  expect(nothing.match(/property="og:title"/g)).toHaveLength(1);
  expect(nothing).toContain('<meta property="og:title" content="dads" />');
  expect(nothing).not.toContain(E2E_INVITE_GROUP.name);

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

test('a link sent in French unfurls in French, and opens a French door', async ({ browser }) => {
  // The preview speaks the sender's language, not both — and his friend,
  // on a phone that has never chosen and is set to English, lands on the
  // door in the same language the link was sent in.
  const first = await browser.newContext({ locale: 'fr-CA' });
  const luc = await first.newPage();
  await luc.goto('/');
  await luc.getByRole('button', { name: 'FR', exact: true }).click();
  await luc.getByLabel('Code').fill(E2E_INVITE_GROUP.code);
  await luc.getByLabel('Ton nom').fill('Luc Invite');
  await luc.getByRole('button', { name: 'Entre' }).click();
  await expect(luc.getByTestId('connection')).toBeVisible();
  await invite(luc);
  const link = await luc.getByTestId('invite-link').inputValue();

  const unfurled = await (await first.request.get(link)).text();
  expect(unfurled).toContain('T’es invité.');
  expect(unfurled).not.toContain('invited');
  expect(unfurled).toContain('/og-fr.png');
  expect(unfurled).toMatch(/<html[^>]* lang="fr"/);

  const second = await browser.newContext({ locale: 'en-US' });
  const guy = await second.newPage();
  await guy.goto(link);
  await expect(guy.getByLabel('Ton nom')).toBeVisible();
  // And it stays his language once he is in, reload and all.
  await guy.getByLabel('Ton nom').fill('Guy Invite');
  await guy.getByRole('button', { name: 'Entre' }).click();
  await expect(guy.getByTestId('connection')).toBeVisible();
  await guy.reload();
  await expect(guy.getByTestId('home-go')).toContainText('Va jaser');

  await first.close();
  await second.close();
});
