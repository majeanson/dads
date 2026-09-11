/**
 * Web Push from the Worker and the DO, with no dependencies.
 *
 * VAPID (RFC 8292) auth as an ES256 JWT, payload encryption per RFC 8291
 * (aes128gcm), all on WebCrypto — the node `web-push` package cannot run on
 * Workers. Ported from jaffre, which has been sending these in production on
 * this same runtime for months; the two apps share no code, so this is a copy
 * on purpose, and the crypto is the part that is worth not writing twice.
 *
 * OPTIONAL BY DESIGN, like TURN: with no VAPID secrets the endpoints answer
 * 503, the client never offers the toggle, and everything else in the app
 * carries on exactly as before.
 *
 *   npm run vapid            # prints both keys
 *   wrangler secret put VAPID_PUBLIC_KEY
 *   wrangler secret put VAPID_PRIVATE_KEY
 */

import type { Env } from './env';

export interface PushSubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export function pushEnabled(env: Env): boolean {
  return (
    typeof env.VAPID_PUBLIC_KEY === 'string' &&
    env.VAPID_PUBLIC_KEY.length > 0 &&
    typeof env.VAPID_PRIVATE_KEY === 'string' &&
    env.VAPID_PRIVATE_KEY.length > 0
  );
}

/* ── base64url ─────────────────────────────────────────────────────────── */

function b64urlDecode(s: string): Uint8Array {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function b64urlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let raw = '';
  for (const b of arr) raw += String.fromCharCode(b);
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/* ── VAPID JWT (ES256) ─────────────────────────────────────────────────── */

async function vapidJwt(env: Env, audience: string): Promise<string> {
  // Private key: base64url of the raw 32-byte scalar `d`; public key:
  // base64url of the uncompressed point (65 bytes) — x/y are its two halves.
  const pub = b64urlDecode(env.VAPID_PUBLIC_KEY as string);
  const key = await crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      d: env.VAPID_PRIVATE_KEY as string,
      x: b64urlEncode(pub.slice(1, 33)),
      y: b64urlEncode(pub.slice(33, 65)),
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const header = b64urlEncode(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64urlEncode(
    utf8(
      JSON.stringify({
        aud: audience,
        exp: Math.floor(Date.now() / 1000) + 12 * 3600,
        sub: 'https://dads.marcportal.com',
      }),
    ),
  );
  const signingInput = `${header}.${claims}`;
  // WebCrypto ECDSA yields the raw r||s form JWS wants — no DER wrangling.
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, utf8(signingInput));
  return `${signingInput}.${b64urlEncode(sig)}`;
}

/* ── RFC 8291 payload encryption (aes128gcm) ───────────────────────────── */

async function hkdf(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: info as BufferSource },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

async function encryptPayload(
  plaintext: string,
  p256dh: string,
  auth: string,
): Promise<Uint8Array> {
  const uaPublic = b64urlDecode(p256dh); // 65-byte uncompressed EC point
  const authSecret = b64urlDecode(auth); // 16-byte shared auth secret

  const asKeys = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  const asPublic = new Uint8Array(
    (await crypto.subtle.exportKey('raw', asKeys.publicKey)) as ArrayBuffer,
  );
  const uaKey = await crypto.subtle.importKey(
    'raw',
    uaPublic as BufferSource,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits(
      // workers-types spells the ECDH peer-key field `$public`; the runtime
      // (and every other WebCrypto typing) wants `public` — cast around it.
      { name: 'ECDH', public: uaKey } as unknown as SubtleCryptoDeriveKeyAlgorithm,
      asKeys.privateKey,
      256,
    ),
  );

  // RFC 8291 §3.3–3.4: two HKDF stages, then AES-128-GCM over one record.
  const ikm = await hkdf(
    shared,
    authSecret,
    concat(utf8('WebPush: info\0'), uaPublic, asPublic),
    32,
  );
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(ikm, salt, utf8('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(ikm, salt, utf8('Content-Encoding: nonce\0'), 12);

  const aesKey = await crypto.subtle.importKey('raw', cek as BufferSource, 'AES-GCM', false, [
    'encrypt',
  ]);
  // 0x02 delimiter marks the (only) record as final.
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce as BufferSource },
      aesKey,
      concat(utf8(plaintext), new Uint8Array([2])) as BufferSource,
    ),
  );

  // aes128gcm header: salt(16) | record size(4, BE) | key id length(1) | key
  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, ciphertext);
}

/* ── send ──────────────────────────────────────────────────────────────── */

export interface PushPayload {
  title: string;
  body: string;
  tag?: string;
}

/**
 * POST one encrypted notification to a push service. Returns false when the
 * subscription is dead (404/410) and should be dropped.
 */
async function sendWebPush(
  env: Env,
  sub: PushSubscriptionRow,
  payload: PushPayload,
): Promise<boolean> {
  const jwt = await vapidJwt(env, new URL(sub.endpoint).origin);
  const body = await encryptPayload(JSON.stringify(payload), sub.p256dh, sub.auth);
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY as string}`,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      // The table is open for three hours; a reminder that arrives after it
      // has shut is worse than none. Not 'high': this is an invitation, not
      // an alarm, and a phone should be free to batch it.
      TTL: '3600',
      Urgency: 'normal',
    },
    body: body as BodyInit,
  });
  if (res.status === 404 || res.status === 410) return false;
  if (!res.ok) console.error('[push] send failed', res.status, await res.text());
  return true;
}

/**
 * Tell every dad in a group, on every device he has said yes on.
 *
 * Best-effort from end to end: a push service that is down, or a subscription
 * that has died with the browser that made it, must never take down the alarm
 * that was posting the line in the room. Dead ones are dropped as they are
 * found — a subscription outlives the browser that created it, and nothing
 * else ever tells us.
 */
export async function notifyGroup(env: Env, groupId: string, payload: PushPayload): Promise<void> {
  await notify(
    env,
    env.DB.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE group_id = ?').bind(
      groupId,
    ),
    payload,
  );
}

/** One dad, every device he said yes on. For the things that are his alone. */
export async function notifyMember(
  env: Env,
  memberId: string,
  payload: PushPayload,
): Promise<void> {
  await notify(
    env,
    env.DB.prepare(
      'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE member_id = ?',
    ).bind(memberId),
    payload,
  );
}

async function notify(env: Env, query: D1PreparedStatement, payload: PushPayload): Promise<void> {
  if (!pushEnabled(env)) return;
  try {
    const { results } = await query.all<PushSubscriptionRow>();

    for (const sub of results) {
      const alive = await sendWebPush(env, sub, payload).catch((err) => {
        console.error('push send threw', err);
        return true;
      });
      if (!alive) {
        await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?')
          .bind(sub.endpoint)
          .run();
      }
    }
  } catch (err) {
    console.error('notify failed', err);
  }
}
