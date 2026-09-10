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
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      // One tag for a kind of thing: two reminders for the same night replace
      // each other rather than stacking up on the lock screen.
      tag: payload.tag || 'dads',
      data: { url: payload.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';

  // A tab that is already open is the one he wants — focus it rather than
  // opening a second room beside the first.
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if (client.url.includes(self.registration.scope) && 'focus' in client) {
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
