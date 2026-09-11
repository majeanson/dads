import { expect, test } from '@playwright/test';
import { CODE, named } from './names';

/**
 * The front door, against the real PBKDF2 and the real throttle.
 *
 * Deliberately frugal with wrong guesses: ten per IP per ten minutes is the
 * throttle, and this suite shares an address with whoever is running it.
 */
test.describe.configure({ mode: 'serial' });

test('the code is a passphrase, not a password', async ({ request }) => {
  // Said out loud, typed by a thumb, autocapitalised by a phone. None of that
  // may be the reason a dad cannot get in.
  const res = await request.post('/api/join', {
    data: { code: `  ${CODE.toUpperCase()} `, displayName: named('shouty') },
  });
  expect(res.status()).toBe(200);
  const session = (await res.json()) as {
    group: { name: string };
    member: { displayName: string };
  };
  expect(session.group.name).toBeTruthy();
});

test('a wrong code says nothing about how close it was', async ({ request }) => {
  const wrong = await request.post('/api/join', {
    data: { code: 'not the code at all', displayName: named('stranger') },
  });
  expect(wrong.status()).toBe(401);
  expect(await wrong.json()).toEqual({ error: 'bad_code' });

  // And an empty one is an empty one, not an invitation.
  const empty = await request.post('/api/join', { data: { displayName: named('stranger') } });
  expect(empty.status()).toBe(400);
  expect(await empty.json()).toEqual({ error: 'missing_code' });
});

test('a name is required, and bounded', async ({ request }) => {
  const nameless = await request.post('/api/join', { data: { code: CODE } });
  expect(nameless.status()).toBe(400);
  expect(await nameless.json()).toEqual({ error: 'missing_name' });

  const long = await request.post('/api/join', {
    data: { code: CODE, displayName: 'x'.repeat(33) },
  });
  expect(long.status()).toBe(400);
  expect(await long.json()).toEqual({ error: 'name_too_long' });
});

test('a dad who comes back is the same dad, not a second one', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/');
  await page.getByLabel('Code').fill(CODE);
  await page.getByLabel('Your name').fill(named('returning'));
  await page.getByRole('button', { name: 'Come in' }).click();
  await expect(page.getByTestId('connection')).toHaveText(/here$/, { timeout: 20_000 });

  const first = await page.evaluate(async () => {
    const r = await fetch('/api/me');
    return ((await r.json()) as { member: { id: string } }).member.id;
  });

  // The cookie is gone; the device token in localStorage is what is left.
  await context.clearCookies();
  await page.reload();
  await expect(page.getByLabel('Code')).toBeVisible();
  await page.getByLabel('Code').fill(CODE);
  await page.getByLabel('Your name').fill(named('returning'));
  await page.getByRole('button', { name: 'Come in' }).click();
  await expect(page.getByTestId('connection')).toHaveText(/here$/, { timeout: 20_000 });

  const second = await page.evaluate(async () => {
    const r = await fetch('/api/me');
    return ((await r.json()) as { member: { id: string } }).member.id;
  });
  expect(second).toBe(first);

  await context.close();
});

test('a link opens the door, and a dead one is just a wrong code', async ({ browser }) => {
  const host = await browser.newContext();
  const page = await host.newPage();
  await page.goto('/');
  await page.getByLabel('Code').fill(CODE);
  await page.getByLabel('Your name').fill(named('host'));
  await page.getByRole('button', { name: 'Come in' }).click();
  await expect(page.getByTestId('connection')).toHaveText(/here$/, { timeout: 20_000 });

  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: 'Invite a dad' }).click();
  const link = await page.getByTestId('invite-link').inputValue();
  expect(link).toMatch(/^https:\/\/.+\/i\/[A-Za-z0-9_-]{32,}$/);

  // A stranger with the link and no code.
  const guest = await browser.newContext();
  const them = await guest.newPage();
  await them.goto(link);
  await expect(them.getByLabel('Your name')).toBeVisible();
  await expect(them.getByLabel('Code')).toHaveCount(0);
  // The token is off the address bar before he has typed anything.
  expect(new URL(them.url()).pathname).toBe('/');
  await them.getByLabel('Your name').fill(named('guest'));
  await them.getByRole('button', { name: 'Come in' }).click();
  await expect(them.getByTestId('connection')).toHaveText(/here$/, { timeout: 20_000 });

  // An invented token fails into the same message a wrong code gets.
  const made = await them.request.post('/api/join', {
    data: { invite: 'z'.repeat(43), displayName: named('nobody') },
  });
  expect(made.status()).toBe(401);
  expect(await made.json()).toEqual({ error: 'bad_code' });

  await host.close();
  await guest.close();
});
