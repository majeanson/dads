import { env, exports as workerExports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { cookieFrom, postJoin, resetTables, seedGroup } from './helpers';
import { slugOf } from '../src/worker/routes/create';

const worker = workerExports.default;

/**
 * POST /api/rooms/new — a room anybody can open.
 *
 * This is the route that changed what the app is. Before it, a group existed
 * because somebody with a shell made one; now the door makes them, which means
 * the door is open to the world and everything here is about what that costs.
 */
function postRoom(body: Record<string, unknown>, headers: Record<string, string> = {}): Request {
  return new Request('https://dads.test/api/rooms/new', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function putRooms(cookie: string, body: Record<string, unknown>): Request {
  return new Request('https://dads.test/api/rooms', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body),
  });
}

describe('opening a room', () => {
  beforeEach(async () => {
    await resetTables();
  });

  it('makes the room, makes the man who opened it, and lets him straight in', async () => {
    const res = await worker.fetch(
      postRoom({ name: 'The Thursday Lot', code: 'cedar lantern', displayName: 'Marc' }),
    );
    expect(res.status).toBe(200);
    const body = (await res.clone().json()) as {
      group: { id: string; slug: string; name: string; createdBy: string | null };
      member: { id: string; displayName: string };
      deviceToken: string;
    };

    expect(body.group.name).toBe('The Thursday Lot');
    expect(body.group.slug).toBe('the-thursday-lot');
    // He is the creator, and the creator is a real member of it.
    expect(body.group.createdBy).toBe(body.member.id);
    expect(body.member.displayName).toBe('Marc');
    // And he is through the door already: no second trip to /api/join.
    expect(cookieFrom(res)).toContain('=');
    expect(body.deviceToken).toMatch(/^[A-Za-z0-9_-]{32,}$/);

    const row = await env.DB.prepare(
      'SELECT created_by, invite_code_lookup FROM groups WHERE id = ?',
    )
      .bind(body.group.id)
      .first<{ created_by: string; invite_code_lookup: string | null }>();
    expect(row?.created_by).toBe(body.member.id);
    // The word has a fingerprint, so joining it is a lookup and not a scan.
    expect(row?.invite_code_lookup).toBeTruthy();
  });

  it('opens to another dad who is given the word', async () => {
    await worker.fetch(
      postRoom({ name: 'The Thursday Lot', code: 'cedar lantern', displayName: 'Marc' }),
    );
    const joined = await worker.fetch(postJoin({ code: 'Cedar  Lantern', displayName: 'Sam' }));
    expect(joined.status).toBe(200);
    const session = (await joined.json()) as { group: { name: string; createdBy: string | null } };
    // Case and spacing do not matter, here as at every other door.
    expect(session.group.name).toBe('The Thursday Lot');
    // And he can see whose room it is, which is what hides the switches.
    expect(session.group.createdBy).toBeTruthy();
  });

  it('refuses a word another room already has', async () => {
    await worker.fetch(postRoom({ name: 'First', code: 'shared word', displayName: 'Marc' }));
    const second = await worker.fetch(
      postRoom({ name: 'Second', code: 'SHARED WORD', displayName: 'Sam' }),
    );
    // Two rooms behind one word is a dad typing the right thing and landing
    // among strangers. The second room is simply not made.
    expect(second.status).toBe(409);
    expect(((await second.json()) as { error: string }).error).toBe('code_taken');
  });

  it('refuses a word too short to be worth anything', async () => {
    const res = await worker.fetch(postRoom({ name: 'Room', code: 'ab', displayName: 'Marc' }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('code_too_short');
  });

  it('wants a room name and a name to put on it', async () => {
    expect(
      (await worker.fetch(postRoom({ code: 'long enough', displayName: 'Marc' }))).status,
    ).toBe(400);
    expect((await worker.fetch(postRoom({ name: 'Room', code: 'long enough' }))).status).toBe(400);
  });

  it('gives two rooms of the same name different addresses', async () => {
    const a = await worker.fetch(
      postRoom({ name: 'The Dads', code: 'word one', displayName: 'A' }),
    );
    const b = await worker.fetch(
      postRoom({ name: 'The Dads', code: 'word two', displayName: 'B' }),
    );
    const slugA = ((await a.json()) as { group: { slug: string } }).group.slug;
    const slugB = ((await b.json()) as { group: { slug: string } }).group.slug;
    // Two groups of friends may both call themselves The Dads; only the
    // address has to be theirs alone.
    expect(slugA).toBe('the-dads');
    expect(slugB).toMatch(/^the-dads-/);
    expect(slugB).not.toBe(slugA);
  });

  it('stops one address opening rooms all day', async () => {
    for (let i = 0; i < 3; i++) {
      const ok = await worker.fetch(
        postRoom({ name: `Room ${i}`, code: `a word number ${i}`, displayName: 'Marc' }),
      );
      expect(ok.status).toBe(200);
    }
    const fourth = await worker.fetch(
      postRoom({ name: 'Room 4', code: 'a word number four', displayName: 'Marc' }),
    );
    expect(fourth.status).toBe(429);
    expect(((await fourth.json()) as { error: string }).error).toBe('too_many_rooms');
  });

  describe('and whose switches they are', () => {
    it('lets the creator change what the room has open, and nobody else', async () => {
      const made = await worker.fetch(
        postRoom({ name: 'His Room', code: 'his own word', displayName: 'Marc' }),
      );
      const creator = cookieFrom(made);

      const his = await worker.fetch(putRooms(creator, { questions: false }));
      expect(his.status).toBe(200);
      expect(((await his.json()) as { rooms: { questions: boolean } }).rooms.questions).toBe(false);

      const sam = cookieFrom(
        await worker.fetch(postJoin({ code: 'his own word', displayName: 'Sam' })),
      );
      const refused = await worker.fetch(putRooms(sam, { questions: true }));
      // He is in the room and can see the switches, so this is a 403 and not
      // a 404: pretending they are not there is a lie he can disprove.
      expect(refused.status).toBe(403);
      expect(((await refused.json()) as { error: string }).error).toBe('not_yours');

      const after = await env.DB.prepare('SELECT questions_on FROM groups WHERE slug = ?')
        .bind('his-room')
        .first<{ questions_on: number }>();
      expect(after?.questions_on).toBe(0);
    });

    it('leaves a room with no creator exactly as it was: everybody’s', async () => {
      // Every group that predates this has created_by NULL, and the rule it
      // agreed to was that any dad may change the switches. That still holds.
      const group = await seedGroup({ slug: 'old-room' });
      const anyone = cookieFrom(
        await worker.fetch(postJoin({ code: group.code, displayName: 'Dave' })),
      );
      const res = await worker.fetch(putRooms(anyone, { table: false }));
      expect(res.status).toBe(200);
      expect(((await res.json()) as { rooms: { table: boolean } }).rooms.table).toBe(false);
    });

    it('teaches an old room its word the first time somebody uses it', async () => {
      const group = await seedGroup({ slug: 'old-room-2' });
      const before = await env.DB.prepare('SELECT invite_code_lookup FROM groups WHERE id = ?')
        .bind(group.id)
        .first<{ invite_code_lookup: string | null }>();
      expect(before?.invite_code_lookup).toBeNull();

      const joined = await worker.fetch(postJoin({ code: group.code, displayName: 'Dave' }));
      expect(joined.status).toBe(200);

      const after = await env.DB.prepare('SELECT invite_code_lookup FROM groups WHERE id = ?')
        .bind(group.id)
        .first<{ invite_code_lookup: string | null }>();
      // Healed on use, because the fingerprint is keyed with the Worker's
      // secret and the script that made this room could not have known it.
      expect(after?.invite_code_lookup).toBeTruthy();

      // And it still opens, now by the fast path rather than the scan.
      const again = await worker.fetch(postJoin({ code: group.code, displayName: 'Dave' }));
      expect(again.status).toBe(200);
    });
  });
});

describe('a room’s address', () => {
  it('is made of the letters in its name', () => {
    expect(slugOf('The Thursday Lot')).toBe('the-thursday-lot');
    expect(slugOf("Marc's Dads (Thursdays)")).toBe('marc-s-dads-thursdays');
    // Accents are carried across rather than eaten: "Les Pères" is findable.
    expect(slugOf('Les Pères')).toBe('les-peres');
    // A name with nothing a URL can carry still gets an address.
    expect(slugOf('🎴🃏')).toMatch(/^room-/);
    expect(slugOf('   ')).toMatch(/^room-/);
  });
});
