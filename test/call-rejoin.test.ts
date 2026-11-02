import { exports as workerExports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ServerFrame } from '../src/shared/protocol';
import { arrived, cookieFrom, postJoin, resetTables, until } from './helpers';

const worker = workerExports.default;

/**
 * A dad back on the call from a new socket (2026-11-02).
 *
 * His phone's socket dropped in the background and came back; the app lets
 * its links go and says "in" again on the new socket. The room's roster is
 * one entry per dad, so it never said he left, and the others would have gone
 * on holding links to a connection he no longer has. The room takes the old
 * socket off the call and tells the others to drop their side, so the roster
 * that follows rebuilds the mesh the way a join does — and the old socket's
 * late close is not a hang-up on the new one.
 */

class Dad {
  frames: ServerFrame[] = [];
  closed = false;
  constructor(readonly ws: WebSocket) {
    ws.accept();
    ws.addEventListener('message', (event) => {
      if (event.data === 'pong') return;
      this.frames.push(JSON.parse(event.data as string) as ServerFrame);
    });
    ws.addEventListener('close', () => {
      this.closed = true;
    });
  }
  hangUpsFrom(memberId: string): number {
    return this.frames.filter(
      (f) =>
        f.t === 'rtc' &&
        f.from === memberId &&
        (f.payload as { hangup?: boolean } | null)?.hangup === true,
    ).length;
  }
  onCall(memberId: string): { muted?: boolean }[] {
    const roster = [...this.frames].reverse().find((f) => f.t === 'call-roster');
    return roster === undefined || roster.t !== 'call-roster'
      ? []
      : roster.members.filter((m) => m.memberId === memberId);
  }
}

async function connect(cookie: string): Promise<Dad> {
  const res = await worker.fetch('https://dads.test/ws', {
    headers: { Upgrade: 'websocket', Cookie: cookie },
  });
  expect(res.status).toBe(101);
  const dad = new Dad(res.webSocket!);
  await arrived(dad);
  return dad;
}

async function roomOfMarcs(word: string) {
  const opened = await worker.fetch(
    new Request('https://dads.test/api/rooms/new', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Marc’s', code: word, displayName: 'Marc' }),
    }),
  );
  const marc = cookieFrom(opened);
  const marcId = ((await opened.json()) as { member: { id: string } }).member.id;
  const joined = await worker.fetch(
    postJoin({ code: word, displayName: 'Sam', deviceToken: 'd'.repeat(43) }),
  );
  const sam = cookieFrom(joined);
  const samId = ((await joined.json()) as { member: { id: string } }).member.id;
  return { marc, marcId, sam, samId };
}

const call = (dad: Dad, muted = false) =>
  dad.ws.send(JSON.stringify({ t: 'call', join: true, muted }));

describe('a dad back on the call from a new socket', () => {
  beforeEach(async () => {
    await resetTables();
  });

  it('is told to the others as a hang-up, once, and the old socket is off the call', async () => {
    const { marc, marcId, sam, samId } = await roomOfMarcs('a word to rejoin');
    const old = await connect(marc);
    const sams = await connect(sam);
    call(old);
    call(sams);
    await until(() => sams.onCall(marcId).length === 1 && sams.onCall(samId).length === 1);
    expect(sams.hangUpsFrom(marcId)).toBe(0);

    // His socket dropped in the background and came back: a new one, "in".
    const fresh = await connect(marc);
    call(fresh);
    // Sam drops his side to rebuild it; the roster still counts Marc once.
    await until(() => sams.hangUpsFrom(marcId) === 1);
    expect(sams.onCall(marcId)).toHaveLength(1);

    // The old socket closing now is not a second hang-up: he is still on,
    // and a mute from the new socket shows on the roster as his.
    old.ws.close();
    call(fresh, true);
    await until(() => sams.onCall(marcId).some((m) => m.muted));
    expect(sams.hangUpsFrom(marcId)).toBe(1);
    expect(sams.onCall(marcId)).toHaveLength(1);
  });

  it('is nothing special for a mute on the socket already on the call', async () => {
    const { marc, marcId, sam, samId } = await roomOfMarcs('a word to mute');
    const marcs = await connect(marc);
    const sams = await connect(sam);
    call(marcs);
    call(sams);
    await until(() => sams.onCall(marcId).length === 1 && sams.onCall(samId).length === 1);
    call(marcs, true);
    await until(() => sams.onCall(marcId).some((m) => m.muted));
    expect(sams.hangUpsFrom(marcId)).toBe(0);
  });
});
