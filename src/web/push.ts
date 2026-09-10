/**
 * Asking to be told when the table opens.
 *
 * The whole of the browser side: register the worker, ask the man, hand the
 * subscription to the server. Nothing here is automatic — a notification is
 * the one thing this app does that reaches a dad when he is not looking at
 * it, so it is only ever something he pressed a button for.
 *
 * On an iPhone this works only once the app is on the home screen. That is
 * Apple's rule, not ours, and `pushShape` is how the menu knows to say so
 * rather than offering a switch that cannot do anything.
 */

export type PushShape =
  | { kind: 'unsupported' }
  /** iOS, in a browser tab: it has to be added to the home screen first. */
  | { kind: 'needs-install' }
  /** The server has no VAPID keys, so there is nothing to offer. */
  | { kind: 'unavailable' }
  | { kind: 'blocked' }
  | { kind: 'ready'; on: boolean };

function standalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // Safari's own, older flag. Still the only one that is true on an iPhone.
    (navigator as { standalone?: boolean }).standalone === true
  );
}

function isIOS(): boolean {
  // iPadOS reports itself as a Mac; the touch points give it away.
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.userAgent.includes('Mac') && navigator.maxTouchPoints > 1)
  );
}

async function registration(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register('/sw.js', { scope: '/' });
}

/** What, if anything, this browser can be offered. */
export async function pushShape(): Promise<PushShape> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return isIOS() && !standalone() ? { kind: 'needs-install' } : { kind: 'unsupported' };
  }
  if (isIOS() && !standalone()) return { kind: 'needs-install' };
  if (Notification.permission === 'denied') return { kind: 'blocked' };

  const res = await fetch('/api/push');
  if (res.status === 503) return { kind: 'unavailable' };
  if (!res.ok) return { kind: 'unsupported' };
  const { endpoints } = (await res.json()) as { key: string; endpoints: string[] };

  try {
    const reg = await registration();
    const sub = await reg.pushManager.getSubscription();
    // On only if THIS browser holds a subscription the server also knows
    // about: a subscription the server has forgotten is a promise nobody kept.
    return { kind: 'ready', on: sub !== null && endpoints.includes(sub.endpoint) };
  } catch {
    return { kind: 'unsupported' };
  }
}

function keyBytes(base64url: string): Uint8Array {
  const padded = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** @returns whether he is now subscribed. */
export async function enablePush(): Promise<boolean> {
  const res = await fetch('/api/push');
  if (!res.ok) return false;
  const { key } = (await res.json()) as { key: string };

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return false;

  const reg = await registration();
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      // Non-blank is not optional: every browser refuses a silent push.
      userVisibleOnly: true,
      applicationServerKey: keyBytes(key) as BufferSource,
    }));

  const saved = await fetch('/api/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sub.toJSON()),
  });
  return saved.ok;
}

export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;

  // Tell the server first: if the browser drops it and the row survives, the
  // server goes on posting into a void until the push service says gone.
  await fetch('/api/push', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: sub.endpoint }),
  }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}
