import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The service worker's badge (Marc asked, 2026-11-02).
 *
 * A push puts a dot on the icon while the app is closed; a tap on the
 * notification takes it off. `public/sw.js` is plain script with no exports,
 * so it is loaded against a stubbed `self` and its listeners are called by
 * hand. No browser lets a test send a real push event, which is why this is
 * here and not in an e2e.
 */
type Listener = (event: unknown) => void;
const listeners = new Map<string, Listener>();
const setAppBadge = vi.fn(() => Promise.resolve());
const clearAppBadge = vi.fn(() => Promise.resolve());
const showNotification = vi.fn(() => Promise.resolve());
const focus = vi.fn(() => Promise.resolve());

const navigator: Record<string, unknown> = { setAppBadge, clearAppBadge };

vi.stubGlobal('self', {
  addEventListener: (type: string, fn: Listener) => listeners.set(type, fn),
  skipWaiting: () => Promise.resolve(),
  navigator,
  registration: { scope: 'https://dads.example/', showNotification },
  clients: {
    claim: () => Promise.resolve(),
    matchAll: () => Promise.resolve([{ url: 'https://dads.example/', focus }]),
    openWindow: () => Promise.resolve(),
  },
});

beforeAll(async () => {
  // A path in a variable so the type checker does not go looking for
  // declarations a plain script does not have.
  const sw = '../public/sw.js';
  await import(/* @vite-ignore */ sw);
});

beforeEach(() => {
  vi.clearAllMocks();
  navigator.setAppBadge = setAppBadge;
  navigator.clearAppBadge = clearAppBadge;
});

/** Fire a listener and wait for everything it handed to `waitUntil`. */
async function fire(type: string, event: Record<string, unknown>) {
  const waits: Promise<unknown>[] = [];
  listeners.get(type)!({ ...event, waitUntil: (p: Promise<unknown>) => waits.push(p) });
  await Promise.all(waits);
}

const push = (body: unknown) => ({ data: { json: () => body } });
const click = (action = '') => ({ action, notification: { close: () => {} } });

describe('the service worker and the icon', () => {
  it('a push shows the notification, then puts an unnumbered badge on the icon', async () => {
    await fire('push', push({ title: 'Dad night', body: 'Tomorrow' }));
    expect(showNotification).toHaveBeenCalledOnce();
    expect(setAppBadge).toHaveBeenCalledOnce();
    // No count: the worker does not know how many lines are unread.
    expect(setAppBadge).toHaveBeenCalledWith();
  });

  it('a tap on the notification clears the badge and opens the app', async () => {
    await fire('notificationclick', click());
    expect(clearAppBadge).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledOnce();
  });

  it('a browser with no badge, or one that refuses, is not a fault', async () => {
    delete navigator.setAppBadge;
    delete navigator.clearAppBadge;
    await fire('push', push({ title: 'x' }));
    await fire('notificationclick', click());
    expect(showNotification).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledOnce();

    navigator.setAppBadge = vi.fn(() => Promise.reject(new Error('no')));
    navigator.clearAppBadge = vi.fn(() => {
      throw new Error('no');
    });
    await fire('push', push({ title: 'x' }));
    await fire('notificationclick', click());
    expect(focus).toHaveBeenCalledTimes(2);
  });

  it('a notification that could not be shown still marks the icon, and still fails', async () => {
    showNotification.mockImplementationOnce(() => Promise.reject(new Error('denied')));
    await expect(fire('push', push({ title: 'x' }))).rejects.toThrow('denied');
    expect(setAppBadge).toHaveBeenCalledOnce();
  });

  it('no dot while he is looking at the app, which keeps the count itself', async () => {
    const clients = (self as unknown as { clients: { matchAll: () => Promise<unknown[]> } })
      .clients;
    const was = clients.matchAll;
    clients.matchAll = () =>
      Promise.resolve([{ url: 'https://dads.example/', focus, visibilityState: 'visible' }]);
    try {
      await fire('push', push({ title: 'x' }));
      expect(showNotification).toHaveBeenCalledOnce();
      expect(setAppBadge).not.toHaveBeenCalled();
    } finally {
      clients.matchAll = was;
    }
  });

  it('a notification swiped away had its look: the dot goes', async () => {
    await fire('notificationclose', {});
    expect(clearAppBadge).toHaveBeenCalledOnce();
  });
});
