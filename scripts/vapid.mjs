// Generate a VAPID keypair in the exact encoding src/worker/push.ts
// expects: public = base64url uncompressed P-256 point (65 bytes),
// private = base64url raw scalar `d`. Run once, then feed each value to
// `wrangler secret put VAPID_PUBLIC_KEY` / `wrangler secret put VAPID_PRIVATE_KEY`.
import { webcrypto as crypto } from 'node:crypto';

const b64url = (bytes) => Buffer.from(bytes).toString('base64url');

const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
  'sign',
  'verify',
]);
const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);

console.log('VAPID_PUBLIC_KEY=' + b64url(pub));
console.log('VAPID_PRIVATE_KEY=' + jwk.d);
