import { runInDurableObject } from 'cloudflare:test';
import { env, exports as workerExports } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerFrame } from '../src/shared/protocol';
import type { PushPayload } from '../src/worker/push';
import { arrived, cookieFrom, postJoin, resetTables, seedGroup, until } from './helpers';

const worker = workerExports.default;

/**
 * "@Sam" reaches Sam's phone when he is not in the room (2026-11-01, tested
 * 2026-11-02 when Marc asked for the loose ends to be closed).
 *
 * The suite runs with no VAPID keys, which makes every push a no-op — the
 * case that has to stay harmless everywhere else. Here the room object is
 * handed a pair of its own, `fetch` is a stub that keeps what the push
 * services would have been sent, and each push is decrypted with the phone's
 * own key, so what is read is what Sam's phone would read. No seam in the
 * code: the room sends exactly as it does in production.
 */

const b64url = (bytes: ArrayBuffer | Uint8Array): string => {
  let raw = '';
  for (const b of new Uint8Array(bytes)) raw += String.fromCharCode(b);
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const utf8 = (s: string) => new TextEncoder().encode(s);
const join = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};
async function hkdf(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8),
  );
}

/** A phone: the key pair and the secret it would hand the push service. */
interface Phone {
  endpoint: string;
  keys: CryptoKeyPair;
  publicRaw: Uint8Array;
  auth: Uint8Array;
}
async function phone(endpoint: string): Promise<Phone> {
  const keys = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  const publicRaw = new Uint8Array(
    (await crypto.subtle.exportKey('raw', keys.publicKey)) as ArrayBuffer,
  );
  return { endpoint, keys, publicRaw, auth: crypto.getRandomValues(new Uint8Array(16)) };
}

/** RFC 8291 the other way round: what the phone does with what arrived. */
async function opened(on: Phone, body: Uint8Array): Promise<PushPayload> {
  const salt = body.slice(0, 16);
  const idLength = body[20]!;
  const senderRaw = body.slice(21, 21 + idLength);
  const sender = await crypto.subtle.importKey(
    'raw',
    senderRaw,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits(
      // Spelled as the runtime wants it; see `encryptPayload` in push.ts.
      { name: 'ECDH', public: sender } as unknown as SubtleCryptoDeriveKeyAlgorithm,
      on.keys.privateKey,
      256,
    ),
  );
  const ikm = await hkdf(
    shared,
    on.auth,
    join(utf8('WebPush: info\0'), on.publicRaw, senderRaw),
    32,
  );
  const cek = await hkdf(ikm, salt, utf8('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(ikm, salt, utf8('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, body.slice(21 + idLength)),
  );
  // The last byte is the record's delimiter.
  return JSON.parse(new TextDecoder().decode(plain.slice(0, -1))) as PushPayload;
}

class Dad {
  frames: ServerFrame[] = [];
  constructor(readonly ws: WebSocket) {
    ws.accept();
    ws.addEventListener('message', (event) => {
      if (event.data === 'pong') return;
      this.frames.push(JSON.parse(event.data as string) as ServerFrame);
    });
  }
  lines(): string[] {
    return this.frames.flatMap((f) =>
      f.t === 'hello' ? f.messages.map((m) => m.body) : f.t === 'msg' ? [f.message.body] : [],
    );
  }
  /**
   * Says it, then a sentinel, and waits for the sentinel. One socket's frames
   * are handled in order and the push is awaited inside the first, so once
   * the sentinel is back every push the first line made has been sent.
   */
  async say(body: string) {
    this.ws.send(JSON.stringify({ t: 'chat', body }));
    const after = `sentinel ${String(++said).padStart(3, '0')}`;
    this.ws.send(JSON.stringify({ t: 'chat', body: after }));
    await until(() => this.lines().includes(after));
  }
}
let said = 0;

describe('a dad named with "@"', () => {
  let groupId: string;
  let code: string;
  /** Every POST the room made to a push service. */
  let sent: { endpoint: string; body: Uint8Array }[];
  const phones = new Map<string, Phone>();
  const open: WebSocket[] = [];

  beforeEach(async () => {
    await resetTables();
    await env.DB.prepare('DELETE FROM push_subscriptions').run();
    const group = await seedGroup();
    groupId = group.id;
    code = group.code;
    phones.clear();
    sent = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      sent.push({ endpoint: request.url, body: new Uint8Array(await request.arrayBuffer()) });
      return new Response(null, { status: 201 });
    });

    // The room's own VAPID pair, for this object only.
    const vapid = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
    ])) as CryptoKeyPair;
    const jwk = (await crypto.subtle.exportKey('jwk', vapid.privateKey)) as JsonWebKey;
    const raw = (await crypto.subtle.exportKey('raw', vapid.publicKey)) as ArrayBuffer;
    await runInDurableObject(env.ROOM.get(env.ROOM.idFromName(groupId)), (instance) => {
      const its = (instance as unknown as { env: Record<string, unknown> }).env;
      its.VAPID_PUBLIC_KEY = b64url(raw);
      its.VAPID_PRIVATE_KEY = jwk.d;
    });
  });

  afterEach(() => {
    open.splice(0).forEach((ws) => ws.close(1000, 'bye'));
    vi.unstubAllGlobals();
  });

  /** Joins, and says yes to the reminders on one phone. */
  async function member(name: string): Promise<{ cookie: string; id: string }> {
    const res = await worker.fetch(postJoin({ code, displayName: name }));
    const cookie = cookieFrom(res);
    const id = ((await res.json()) as { member: { id: string } }).member.id;
    const on = await phone(`https://fcm.googleapis.com/fcm/send/${name.toLowerCase()}`);
    phones.set(name, on);
    await subscribe(id, on);
    return { cookie, id };
  }
  async function subscribe(memberId: string, on: Phone) {
    await env.DB.prepare(
      `INSERT INTO push_subscriptions (endpoint, group_id, member_id, p256dh, auth, created_at)
       VALUES (?, ?, ?, ?, ?, 0)`,
    )
      .bind(on.endpoint, groupId, memberId, b64url(on.publicRaw), b64url(on.auth))
      .run();
  }
  async function connect(cookie: string): Promise<Dad> {
    const res = await worker.fetch('https://dads.test/ws', {
      headers: { Upgrade: 'websocket', Cookie: cookie },
    });
    expect(res.status).toBe(101);
    open.push(res.webSocket!);
    const dad = new Dad(res.webSocket!);
    await arrived(dad);
    return dad;
  }
  const pushedTo = (name: string) => sent.filter((s) => s.endpoint === phones.get(name)!.endpoint);

  it('reaches him when he is not in the room, under the name of the man who said it', async () => {
    const marc = await member('Marc');
    await member('Sam');
    const room = await connect(marc.cookie);

    await room.say('@Sam bring the cards');
    expect(pushedTo('Sam')).toHaveLength(1);
    expect(pushedTo('Marc')).toHaveLength(0);
    const payload = await opened(phones.get('Sam')!, pushedTo('Sam')[0]!.body);
    expect(payload).toEqual({ title: 'Marc', body: '@Sam bring the cards', tag: `tag-${marc.id}` });

    // A long line is cut, not sent whole: 140 characters, the last an ellipsis.
    await room.say(`@Sam ${'x'.repeat(200)}`);
    expect(pushedTo('Sam')).toHaveLength(2);
    const cut = await opened(phones.get('Sam')!, pushedTo('Sam')[1]!.body);
    expect([...cut.body]).toHaveLength(140);
    expect(cut.body.endsWith('…')).toBe(true);

    // A line naming nobody pushes nothing (nor did any sentinel).
    await room.say('nobody in particular');
    expect(sent).toHaveLength(2);
  });

  it('stays quiet while he has the room open', async () => {
    const marc = await member('Marc');
    const sam = await member('Sam');
    const room = await connect(marc.cookie);
    await connect(sam.cookie);

    await room.say('@Sam you there');
    expect(sent).toHaveLength(0);
  });

  it('never pushes a man his own name', async () => {
    const marc = await member('Marc');
    const room = await connect(marc.cookie);
    await room.say('@Marc talking to myself');
    expect(sent).toHaveLength(0);
  });

  it('never pushes a dad who has left, even through a subscription that outlived him', async () => {
    const marc = await member('Marc');
    const sam = await member('Sam');
    const left = await worker.fetch('https://dads.test/api/rooms/leave', {
      method: 'POST',
      headers: { Cookie: sam.cookie },
    });
    expect(left.status).toBe(204);
    // Leaving drops his subscriptions; one put back is the row that matters.
    await subscribe(sam.id, phones.get('Sam')!);

    const room = await connect(marc.cookie);
    await room.say('@Sam where did you go');
    expect(sent).toHaveLength(0);
    // The same line to a dad still here does go: the quiet above was the
    // departure, not a room that had stopped sending.
    await member('Luc');
    await room.say('@Luc and you');
    expect(pushedTo('Luc')).toHaveLength(1);
  });
});
