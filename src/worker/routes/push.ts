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

/** GET /api/push — the public key to subscribe with, or 503. */
export async function getPushKey(
  request: Request,
  env: Env,
  isProduction: boolean,
): Promise<Response> {
  const session = await currentSession(request, env, isProduction);
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });
  if (!pushEnabled(env)) return Response.json({ error: 'unavailable' }, { status: 503 });

  const { results } = await env.DB.prepare(
    'SELECT endpoint FROM push_subscriptions WHERE member_id = ?',
  )
    .bind(session.member.id)
    .all<{ endpoint: string }>();

  return Response.json({
    key: env.VAPID_PUBLIC_KEY,
    // What this dad has said yes on, so a browser can tell whether the
    // subscription it holds is one we know about.
    endpoints: results.map((r) => r.endpoint),
  });
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
  // An endpoint is a URL a push service gave the browser; anything else is
  // somebody trying to make this Worker post to an address of their choosing.
  if (!endpoint.startsWith('https://') || !p256dh || !auth) {
    return Response.json({ error: 'bad_request' }, { status: 400 });
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
