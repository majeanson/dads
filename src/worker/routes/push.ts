import type { Env } from '../env';
import { pushEnabled } from '../push';
import { currentSession } from './auth';

/**
 * Dad-night reminders: opting in, and opting out again.
 *
 * A notification is the one thing this app does that reaches a dad when he is
 * not looking at it, so it is his to ask for and his to stop — per device,
 * never per group, and never on by default. The standing night is still the
 * mechanism; this is a nudge for the man who wanted one.
 *
 * Every route answers 503 when the VAPID secrets are absent, and the client
 * hides the toggle rather than offering something that cannot work.
 */

interface Body {
  endpoint?: unknown;
  keys?: { p256dh?: unknown; auth?: unknown };
}

/**
 * The push services a browser can hand us an address for.
 *
 * An endpoint is a URL this Worker will later POST to, on a schedule, with
 * nobody watching. "Any https address" quietly makes the room's own server
 * into a small POST relay for whoever asks, so it is the four services that
 * actually issue these and nothing else. A dad on some exotic browser gets no
 * reminders and a line in the log, rather than the rest of us getting a
 * surprise.
 */
const PUSH_HOSTS = [
  'fcm.googleapis.com', // Chrome, Edge, Android
  'web.push.apple.com', // Safari, iOS
  '.push.services.mozilla.com', // Firefox
  '.notify.windows.com', // Windows
];

/** A URL can be long; an endpoint is not. Bounded so a row cannot be used as
 * somewhere to put a payload. */
const MAX_ENDPOINT = 1000;

/**
 * Devices one dad may be reminded on. Enough for a phone, a tablet and a
 * laptop twice over, and a ceiling on how much one member can make the night
 * alarm send.
 */
const MAX_PER_MEMBER = 6;

export function acceptableEndpoint(endpoint: string): boolean {
  if (endpoint.length > MAX_ENDPOINT) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  // No credentials and no port: a push service's own address has neither, and
  // both are how a URL is made to read as one host and reach another.
  if (url.username !== '' || url.password !== '' || url.port !== '') return false;
  return PUSH_HOSTS.some((host) =>
    host.startsWith('.') ? url.hostname.endsWith(host) : url.hostname === host,
  );
}

/** For a log line, never for a response: an endpoint is the caller's. */
function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint).hostname;
  } catch {
    return 'unparseable';
  }
}

/** GET /api/push — the public key to subscribe with, or 503. */
export async function getPushKey(
  request: Request,
  env: Env,
  url: URL,
  isProduction: boolean,
): Promise<Response> {
  const session = await currentSession(request, env, isProduction);
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });
  if (!pushEnabled(env)) return Response.json({ error: 'unavailable' }, { status: 503 });

  // Asked about one endpoint, answer about that one. A browser only ever
  // wants to know about the subscription it is holding, and handing back the
  // addresses of a man's other devices answers a question nobody asked.
  const asking = url.searchParams.get('endpoint') ?? '';
  const known =
    asking === ''
      ? false
      : (await env.DB.prepare(
          'SELECT 1 AS ok FROM push_subscriptions WHERE endpoint = ? AND member_id = ?',
        )
          .bind(asking, session.member.id)
          .first<{ ok: number }>()) !== null;

  return Response.json({ key: env.VAPID_PUBLIC_KEY, known });
}

/** POST /api/push — { endpoint, keys: { p256dh, auth } } */
export async function subscribePush(
  request: Request,
  env: Env,
  isProduction: boolean,
): Promise<Response> {
  const session = await currentSession(request, env, isProduction);
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });
  if (!pushEnabled(env)) return Response.json({ error: 'unavailable' }, { status: 503 });

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }

  const endpoint = typeof body.endpoint === 'string' ? body.endpoint : '';
  const p256dh = typeof body.keys?.p256dh === 'string' ? body.keys.p256dh : '';
  const auth = typeof body.keys?.auth === 'string' ? body.keys.auth : '';
  if (!acceptableEndpoint(endpoint) || !p256dh || !auth) {
    console.error('push: refused an endpoint', { host: hostOf(endpoint) });
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }
  // The keys are base64url of 65 and 16 bytes. Bounded for the same reason as
  // the endpoint: nothing here is a place to put a payload.
  if (p256dh.length > 200 || auth.length > 100) {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }

  const mine = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM push_subscriptions WHERE member_id = ? AND endpoint != ?',
  )
    .bind(session.member.id, endpoint)
    .first<{ n: number }>();
  if ((mine?.n ?? 0) >= MAX_PER_MEMBER) {
    return Response.json({ error: 'too_many' }, { status: 409 });
  }

  await env.DB.prepare(
    `INSERT INTO push_subscriptions (endpoint, group_id, member_id, p256dh, auth, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)
     ON CONFLICT(endpoint) DO UPDATE
       SET group_id = ?2, member_id = ?3, p256dh = ?4, auth = ?5`,
  )
    .bind(endpoint, session.group.id, session.member.id, p256dh, auth, Date.now())
    .run();

  return Response.json({ ok: true });
}

/** DELETE /api/push — { endpoint } */
export async function unsubscribePush(
  request: Request,
  env: Env,
  isProduction: boolean,
): Promise<Response> {
  const session = await currentSession(request, env, isProduction);
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }
  const endpoint = typeof body.endpoint === 'string' ? body.endpoint : '';
  if (!endpoint) return Response.json({ error: 'bad_request' }, { status: 400 });

  // Scoped to the caller: a dad can only ever stop his own device.
  await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND member_id = ?')
    .bind(endpoint, session.member.id)
    .run();

  return Response.json({ ok: true });
}
