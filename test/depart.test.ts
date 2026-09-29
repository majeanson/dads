import { env, exports as workerExports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import type { RosterEntry, ServerFrame } from '../src/shared/protocol';
import { arrived, cookieFrom, postJoin, resetTables, seedGroup, until } from './helpers';

const worker = workerExports.default;

/**
 * Leaving a room, and being taken out of one (2026-09-29).
 *
 * Anybody can open a room at the door now, so anybody can end up in one who
 * should not be — and until this, nobody could get them out, and nobody could
 * walk out of a room himself. A gone dad is marked, never deleted: what he
 * said stays under his name, and everything that let him in stops working.
 */

class Dad {
  frames: ServerFrame[] = [];
  closed = false;
  constructor(
    readonly ws: WebSocket,
    readonly cookie: string,
    readonly id: string,
  ) {
    ws.accept();
    ws.addEventListener('message', (event) => {
      if (event.data === 'pong') return;
      this.frames.push(JSON.parse(event.data as string) as ServerFrame);
    });
    ws.addEventListener('close', () => {
      this.closed = true;
    });
  }
  saw(t: ServerFrame['t']): boolean {
    return this.frames.some((f) => f.t === t);
  }
}

async function connect(cookie: string, id: string): Promise<Dad> {
  const res = await worker.fetch('https://dads.test/ws', {
    headers: { Upgrade: 'websocket', Cookie: cookie },
  });
  expect(res.status).toBe(101);
  const dad = new Dad(res.webSocket!, cookie, id);
  await arrived(dad);
  return dad;
}

/** A room of Marc's, with Sam in it: the creator and a friend. */
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
  const group = await env.DB.prepare('SELECT group_id FROM members WHERE id = ?')
    .bind(marcId)
    .first<{ group_id: string }>();
  return { marc, marcId, sam, samId, groupId: group!.group_id };
}

const post = (path: string, cookie: string, body?: unknown) =>
  worker.fetch(`https://dads.test/api/rooms/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const me = (cookie: string) =>
  worker.fetch('https://dads.test/api/me', { headers: { Cookie: cookie } });

describe('taking a dad out', () => {
  beforeEach(async () => {
    await resetTables();
  });

  it('closes his room on every socket, and tells the others', async () => {
    const { marc, marcId, sam, samId } = await roomOfMarcs('a word to remove');
    const marcs = await connect(marc, marcId);
    const sams = await connect(sam, samId);

    expect((await post('remove', marc, { memberId: samId })).status).toBe(204);

    // His socket is told, then closed: the cookie stops working on the next
    // request, but a socket already open never makes one.
    await until(() => sams.saw('removed') && sams.closed);
    await until(() => marcs.frames.some((f) => f.t === 'departed' && f.memberId === samId));
    await until(() =>
      marcs.frames.some(
        (f) => f.t === 'roster' && !f.roster.some((r: RosterEntry) => r.memberId === samId),
      ),
    );
    // And the cookie opens nothing now.
    expect((await me(sam)).status).toBe(204);
  });

  it('keeps what he said, under his name, and marks him gone', async () => {
    const { marc, marcId, sam, samId } = await roomOfMarcs('a word to keep');
    const sams = await connect(sam, samId);
    sams.ws.send(JSON.stringify({ t: 'chat', body: 'still mine' }));
    await until(() => sams.frames.some((f) => f.t === 'msg'));
    await until(async () => {
      const row = await env.DB.prepare('SELECT 1 AS n FROM messages WHERE member_id = ?')
        .bind(samId)
        .first();
      return row !== null;
    });

    await post('remove', marc, { memberId: samId });

    const row = await env.DB.prepare('SELECT gone_at, device_token_hash FROM members WHERE id = ?')
      .bind(samId)
      .first<{ gone_at: number | null; device_token_hash: string | null }>();
    expect(row?.gone_at).not.toBeNull();
    expect(row?.device_token_hash).toBe(`gone:${samId}`);

    // A socket that opens now is handed his line, and his face with it.
    const marcs = await connect(marc, marcId);
    const hello = marcs.frames.find((f) => f.t === 'hello');
    if (hello?.t !== 'hello') throw new Error('no hello');
    expect(hello.messages.some((m) => m.body === 'still mine' && m.name === 'Sam')).toBe(true);
    expect(hello.members.find((m) => m.memberId === samId)?.gone).toBe(true);
    expect(hello.members.find((m) => m.memberId === marcId)?.gone).toBeUndefined();
  });

  it('is the creator’s, and not his own or a stranger’s', async () => {
    const { marc, marcId, sam, samId } = await roomOfMarcs('a word to guard');
    expect((await post('remove', sam, { memberId: marcId })).status).toBe(403);
    expect((await post('remove', marc, { memberId: marcId })).status).toBe(400);
    expect((await post('remove', marc, { memberId: 'mem_nobody' })).status).toBe(400);
    // Twice is nobody the second time.
    expect((await post('remove', marc, { memberId: samId })).status).toBe(204);
    expect((await post('remove', marc, { memberId: samId })).status).toBe(400);
  });

  it('is nobody’s in a room with no creator', async () => {
    // Everybody's would be the switches' rule, and a switch can be turned
    // back. A friend taken out of his own room by another cannot.
    const group = await seedGroup();
    const a = await worker.fetch(postJoin({ code: group.code, displayName: 'A' }));
    const b = await worker.fetch(postJoin({ code: group.code, displayName: 'B' }));
    const bId = ((await b.json()) as { member: { id: string } }).member.id;
    expect((await post('remove', cookieFrom(a), { memberId: bId })).status).toBe(403);
  });

  it('lets him back only as a new dad, with the word', async () => {
    const { marc, sam, samId } = await roomOfMarcs('a word he knows');
    await post('remove', marc, { memberId: samId });

    // His phone's token no longer finds him; the word still opens the door,
    // which is why the client offers to change it.
    const back = await worker.fetch(
      postJoin({ code: 'a word he knows', displayName: 'Sam', deviceToken: 'd'.repeat(43) }),
    );
    expect(back.status).toBe(200);
    const again = ((await back.json()) as { member: { id: string } }).member.id;
    expect(again).not.toBe(samId);
    expect((await me(sam)).status).toBe(204);
  });

  it('takes back his answer for a night still to come, and his marks on the calendar', async () => {
    const { marc, samId, groupId } = await roomOfMarcs('a word for thursday');
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO rsvps (group_id, member_id, occurrence, answer, updated_at)
         VALUES (?, ?, ?, 'in', ?), (?, ?, ?, 'in', ?)`,
      ).bind(groupId, samId, now + 86_400_000, now, groupId, samId, now - 86_400_000, now),
      env.DB.prepare(
        `INSERT INTO night_votes (group_id, member_id, day, answer, updated_at)
         VALUES (?, ?, '2099-01-01', 'in', ?)`,
      ).bind(groupId, samId, now),
    ]);

    await post('remove', marc, { memberId: samId });

    const rsvps = await env.DB.prepare('SELECT occurrence FROM rsvps WHERE member_id = ?')
      .bind(samId)
      .all<{ occurrence: number }>();
    // Last week's yes is a fact; Thursday's is a promise nobody will keep.
    expect(rsvps.results.map((r) => r.occurrence)).toEqual([now - 86_400_000]);
    const votes = await env.DB.prepare('SELECT 1 FROM night_votes WHERE member_id = ?')
      .bind(samId)
      .all();
    expect(votes.results).toHaveLength(0);
  });
});

describe('leaving', () => {
  beforeEach(async () => {
    await resetTables();
  });

  it('is anybody’s, and takes the cookie with him', async () => {
    const { sam, samId } = await roomOfMarcs('a word to leave');
    const sams = await connect(sam, samId);

    const left = await post('leave', sam);
    expect(left.status).toBe(204);
    expect(left.headers.get('Set-Cookie') ?? '').toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/);
    await until(() => sams.saw('removed') && sams.closed);
    expect((await me(sam)).status).toBe(204);
  });

  it('is the creator’s only once nobody else is in it', async () => {
    const { marc, sam } = await roomOfMarcs('a word to hand on');
    // Leaving would leave the word and the switches with nobody.
    const refused = await post('leave', marc);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: 'hand_over_first' });

    expect((await post('leave', sam)).status).toBe(204);
    // The last man out may go.
    expect((await post('leave', marc)).status).toBe(204);
  });

  it('leaves his weeks on the board and no blank row for the week he missed', async () => {
    const { marc, sam, samId } = await roomOfMarcs('a word for the board');
    const board = async () =>
      (await (
        await worker.fetch('https://dads.test/api/board', { headers: { Cookie: marc } })
      ).json()) as {
        weeks: { rows: { memberId: string }[] }[];
      };
    expect((await board()).weeks[0]!.rows.some((r) => r.memberId === samId)).toBe(true);

    await post('leave', sam);
    expect((await board()).weeks[0]!.rows.some((r) => r.memberId === samId)).toBe(false);
  });
});

describe('a gone dad is nobody in the room', () => {
  beforeEach(async () => {
    await resetTables();
  });

  it('cannot be handed the room', async () => {
    const { marc, samId } = await roomOfMarcs('a word to hand to nobody');
    await post('remove', marc, { memberId: samId });
    const hand = await worker.fetch('https://dads.test/api/rooms/owner', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: marc },
      body: JSON.stringify({ memberId: samId }),
    });
    // The switches would land with a man who cannot reach them.
    expect(hand.status).toBe(400);
  });

  it('drops out of his phone’s rooms, and cannot be switched back into it', async () => {
    // The same phone as his join in roomOfMarcs, so the same device token.
    const token = 'd'.repeat(43);
    const { marc, samId, groupId } = await roomOfMarcs('a word he leaves');
    // Sam is in a second room on the same phone.
    const other = await seedGroup({ name: 'The Other Lot' });
    await worker.fetch(postJoin({ code: other.code, displayName: 'Sam', deviceToken: token }));

    const mine = async () =>
      (
        (await (
          await worker.fetch('https://dads.test/api/rooms/mine', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deviceToken: token }),
          })
        ).json()) as { rooms: { id: string }[] }
      ).rooms.map((r) => r.id);
    expect((await mine()).sort()).toEqual([groupId, other.id].sort());

    await post('remove', marc, { memberId: samId });
    expect(await mine()).toEqual([other.id]);
    const back = await worker.fetch('https://dads.test/api/rooms/switch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId, deviceToken: token }),
    });
    expect(back.status).toBe(403);
  });

  it('is not crowned for a game he is still named in', async () => {
    const { marc, marcId, samId } = await roomOfMarcs('a word for the table');
    const marcs = await connect(marc, marcId);
    await post('remove', marc, { memberId: samId });

    marcs.ws.send(
      JSON.stringify({
        t: 'table',
        event: { v: 1, t: 'game-over', summary: '41-37', winners: ['Marc', 'Sam'] },
      }),
    );
    await until(() => marcs.saw('champions'));
    const crown = marcs.frames.find((f) => f.t === 'champions');
    if (crown?.t !== 'champions') throw new Error('no crown');
    expect(crown.champions?.ids).toEqual([marcId]);
  });

  it('loses his phones’ reminders, and the comings and goings say he went', async () => {
    const { marc, sam, samId, groupId } = await roomOfMarcs('a word for the log');
    await env.DB.prepare(
      `INSERT INTO push_subscriptions (endpoint, group_id, member_id, p256dh, auth, created_at)
       VALUES (?, ?, ?, 'k', 'a', ?)`,
    )
      .bind('https://fcm.googleapis.com/fcm/send/sam', groupId, samId, Date.now())
      .run();
    const sams = await connect(sam, samId);

    await post('remove', marc, { memberId: samId });
    await until(() => sams.closed);

    const subs = await env.DB.prepare('SELECT 1 FROM push_subscriptions WHERE member_id = ?')
      .bind(samId)
      .all();
    expect(subs.results).toHaveLength(0);
    // Written straight away, not after the fifteen-second grace a dropped
    // socket gets: he did not lose the wifi.
    await until(async () => {
      const out = await env.DB.prepare(
        "SELECT 1 FROM presence WHERE member_id = ? AND kind = 'out'",
      )
        .bind(samId)
        .first();
      return out !== null;
    });
  });

  it('is off the call the moment he is out, and the others hang up on him', async () => {
    const { marc, marcId, sam, samId } = await roomOfMarcs('a word for the call');
    const marcs = await connect(marc, marcId);
    const sams = await connect(sam, samId);
    sams.ws.send(JSON.stringify({ t: 'call', join: true }));
    await until(() =>
      marcs.frames.some(
        (f) => f.t === 'call-roster' && f.members.some((m) => m.memberId === samId),
      ),
    );
    const before = marcs.frames.length;

    await post('remove', marc, { memberId: samId });

    await until(() =>
      marcs.frames
        .slice(before)
        .some((f) => f.t === 'call-roster' && !f.members.some((m) => m.memberId === samId)),
    );
    await until(() =>
      marcs.frames
        .slice(before)
        .some(
          (f) =>
            f.t === 'rtc' &&
            f.from === samId &&
            (f.payload as { hangup?: boolean } | null)?.hangup === true,
        ),
    );
  });

  it('can leave a room with no creator, like anybody', async () => {
    const group = await seedGroup();
    const a = cookieFrom(await worker.fetch(postJoin({ code: group.code, displayName: 'A' })));
    await worker.fetch(postJoin({ code: group.code, displayName: 'B' }));
    expect((await post('leave', a)).status).toBe(204);
    expect((await me(a)).status).toBe(204);
  });

  it('asks for a session before anything', async () => {
    expect((await post('remove', '', { memberId: 'x' })).status).toBe(401);
    expect((await post('leave', '')).status).toBe(401);
  });
});
