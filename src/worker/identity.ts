import { hmac, randomToken, timingSafeEqual } from './crypto';
import type { Env } from './env';
import { sessionSecret } from './env';

export const COOKIE_NAME = 'dads_id';

/**
 * A year. The whole point of the identity model is that a dad types his name
 * once and the site remembers him; a session that expires between dad nights
 * would defeat it. The cookie carries no personal data — an opaque pair of ids
 * — and can be dropped at any time by signing out.
 */
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

export interface Identity {
  groupId: string;
  memberId: string;
}

interface CookiePayload extends Identity {
  v: 1;
}

/**
 * `<base64url(json)>.<base64url(hmac)>`. Deliberately not a JWT: there is one
 * issuer, one audience and one algorithm, so a format with an attacker-chosen
 * `alg` header would be strictly more surface for zero benefit.
 */
export async function signIdentity(env: Env, identity: Identity, isProduction: boolean) {
  const payload: CookiePayload = { v: 1, ...identity };
  const body = btoa(JSON.stringify(payload))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const signature = await hmac(sessionSecret(env, isProduction), body);
  return `${body}.${signature}`;
}

export async function verifyIdentity(
  env: Env,
  value: string | null,
  isProduction: boolean,
): Promise<Identity | null> {
  if (!value) return null;
  const [body, signature] = value.split('.');
  if (!body || !signature) return null;

  const expected = await hmac(sessionSecret(env, isProduction), body);
  if (!timingSafeEqual(signature, expected)) return null;

  try {
    const padded = body.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(padded + '='.repeat((4 - (padded.length % 4)) % 4)));
    if (payload?.v !== 1 || !payload.groupId || !payload.memberId) return null;
    return { groupId: payload.groupId, memberId: payload.memberId };
  } catch {
    // A signed-but-unparseable cookie means our own format changed under a
    // live session. Treat it as signed out rather than as an error.
    return null;
  }
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

export function identityCookie(value: string, isProduction: boolean): string {
  const attrs = [
    `${COOKIE_NAME}=${value}`,
    'Path=/',
    'HttpOnly',
    // Lax, not Strict: the share link a dad sends in a group chat is a
    // cross-site navigation, and Strict would land him on the join screen he
    // already passed. Lax still blocks the cookie on cross-site subrequests.
    'SameSite=Lax',
    `Max-Age=${COOKIE_MAX_AGE}`,
  ];
  // Secure would make the cookie invisible over plain http, which is exactly
  // how `wrangler dev` and the e2e suite serve the app.
  if (isProduction) attrs.push('Secure');
  return attrs.join('; ');
}

export function clearedIdentityCookie(isProduction: boolean): string {
  const attrs = [`${COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (isProduction) attrs.push('Secure');
  return attrs.join('; ');
}

/** Ids are opaque; random beats sequential here because they appear in URLs. */
export function newId(prefix: string): string {
  return `${prefix}_${randomToken(12)}`;
}
