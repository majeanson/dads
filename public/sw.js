/* global fetch, URL */
/*
 * The service worker, and it does one job.
 *
 * It exists so a dad can be told the table is open when he is not looking at
 * the app — that is the only thing a browser will not do without one. It does
 * NOT cache anything, does not intercept a single fetch, and has no opinion
 * about being offline: a room full of other people is not useful offline, and
 * a stale shell served from a cache is the classic way to ship a bug that
 * nobody can clear.
 */

// A new version replaces the old one immediately rather than waiting for every
// tab to close. There is no cache to invalidate, so there is nothing to lose.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    // A push with no readable payload still deserves to say something.
  }

  const title = payload.title || 'dads';
  // Only the two actions this worker knows how to answer, whatever the
  // payload says: an action is a button that runs code in here.
  const actions = Array.isArray(payload.actions)
    ? payload.actions.filter((a) => a && (a.action === 'rsvp-in' || a.action === 'rsvp-out'))
    : [];
  event.waitUntil(
    self.registration
      .showNotification(title, {
        body: payload.body || '',
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        // One tag for a kind of thing: two reminders for the same night replace
        // each other rather than stacking up on the lock screen.
        tag: payload.tag || 'dads',
        actions,
      })
      .then(badge, badge),
  );
});

/**
 * A mark on the icon while the app is closed (Marc asked, 2026-11-02).
 *
 * No number: this worker cannot know how many lines he has not read, and an
 * unnumbered badge is a dot that says "something". The app puts the true
 * count there, or clears it, the moment it opens — `useSeen` does that on its
 * first render. The Badging API lives on the worker's `navigator`, not on the
 * registration. Absent on most browsers, refused on some; neither is a fault,
 * and nothing in here may throw.
 */
function badge() {
  return badging('setAppBadge');
}

/** He has looked at it. The app sets the real count when it opens. */
function unbadge() {
  return badging('clearAppBadge');
}

function badging(name) {
  try {
    const nav = self.navigator;
    if (!nav || typeof nav[name] !== 'function') return Promise.resolve();
    return Promise.resolve(nav[name]()).catch(() => {});
  } catch {
    return Promise.resolve();
  }
}

/**
 * Always this app, never an address out of the payload. Only something
 * holding our VAPID private key can send one of these, but a notification
 * that can be talked into opening an arbitrary page is a bad shape to leave
 * lying around whatever the odds.
 *
 * A tab that is already open is the one he wants — focus it rather than
 * opening a second room beside the first.
 */
function openTheApp() {
  const url = self.registration.scope;
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    for (const client of windows) {
      if (client.url.includes(self.registration.scope) && 'focus' in client) {
        return client.focus();
      }
    }
    return self.clients.openWindow(url);
  });
}

/**
 * "Coming" or "Can't" on the reminder files the answer from here, with the
 * same cookie the app would send, and the app never has to open. Anything
 * that goes wrong — the cookie gone, the network, a night that no longer
 * exists — opens the app instead, where the question is still on the card.
 */
function answer(coming) {
  return fetch(new URL('/api/rsvp', self.registration.scope), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ coming }),
  })
    .then((res) => (res.ok ? undefined : openTheApp()))
    .catch(openTheApp);
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // First, and whichever button: he has looked at what the dot was for.
  unbadge();
  if (event.action === 'rsvp-in') return event.waitUntil(answer(true));
  if (event.action === 'rsvp-out') return event.waitUntil(answer(false));
  event.waitUntil(openTheApp());
});
