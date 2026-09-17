import { hashDeviceToken, hashInviteCode, inviteCodeLookup, randomToken } from '../crypto';
import type { Env } from '../env';
import { sessionSecret } from '../env';
import { identityCookie, newId, signIdentity } from '../identity';
import { checkRoomLimit, recordRoomMade } from '../throttle';
import { MAX_NAME_LENGTH, type Session } from './auth';

/**
 * POST /api/rooms/new — open a room of your own.
 *
 * Until 2026-09-17 a group came into being one way: somebody with the repo and
 * a shell ran `scripts/create-group.ts`. That was the right shape for one
 * group of five friends and it is still how the real one was made. This is the
 * public door beside it, and it changes what this app IS: anybody who finds
 * the address can now make a room and send the word to four people.
 *
 * What that costs, and what is done about it:
 *
 *   - A room is a row, a slug, and a name that lives for ever. Three per
 *     address per day, counted in the same table wrong codes are counted in.
 *   - The word has to be unique across every room, because the door takes a
 *     word and nothing else. Two rooms with one word is a dad typing the
 *     right thing and landing among strangers, so the second room is refused
 *     rather than made.
 *   - A short word is a guessable word, and the room behind it is somebody's
 *     private conversation. Four characters is the floor.
 *
 * The man who opens it is its first member and its creator, and the creator
 * owns the three switches — see `putRooms`.
 */

/** Long enough that ten guesses per ten minutes is hopeless. Shared with the
 * route that changes a room's word: the floor is about the word, not about
 * which door it was typed at. */
export const MIN_CODE_LENGTH = 4;
export const MAX_CODE_LENGTH = 64;
const MAX_ROOM_NAME = 40;

/**
 * A slug is a room's address, and it is derived from its name rather than
 * asked for: one fewer thing to fill in on a form that a man is filling in to
 * get to the thing he actually wants. Anything that is not a letter or a
 * number becomes a hyphen, so "Marc's Dads (Thursdays)" is `marcs-dads-thursdays`.
 */
export function slugOf(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  // A name with nothing a URL can carry — an emoji, or Japanese — still needs
  // an address, and a random one is better than refusing him his room.
  return base === '' ? `room-${randomToken(4).toLowerCase()}` : base;
}

export async function postRoom(
  request: Request,
  env: Env,
  isProduction: boolean,
): Promise<Response> {
  let body: { name?: unknown; code?: unknown; displayName?: unknown; deviceToken?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';

  if (!name) return Response.json({ error: 'missing_room_name' }, { status: 400 });
  if ([...name].length > MAX_ROOM_NAME) {
    return Response.json({ error: 'room_name_too_long' }, { status: 400 });
  }
  if ([...code].length < MIN_CODE_LENGTH) {
    return Response.json({ error: 'code_too_short' }, { status: 400 });
  }
  if ([...code].length > MAX_CODE_LENGTH) {
    return Response.json({ error: 'code_too_long' }, { status: 400 });
  }
  if (!displayName) return Response.json({ error: 'missing_name' }, { status: 400 });
  if ([...displayName].length > MAX_NAME_LENGTH) {
    return Response.json({ error: 'name_too_long' }, { status: 400 });
  }

  const limit = await checkRoomLimit(env, request, isProduction);
  if (!limit.allowed) {
    return Response.json(
      { error: 'too_many_rooms', retryAfterSeconds: limit.retryAfterSeconds },
      { status: 429 },
    );
  }

  const secret = sessionSecret(env, isProduction);
  const lookup = await inviteCodeLookup(secret, code);

  // Asked before it is tried, so the common case is a clear answer rather
  // than a constraint violation read backwards. The UNIQUE index is still
  // what actually guarantees it — two rooms opened in the same second with
  // the same word both pass this check, and only one of them is made.
  const taken = await env.DB.prepare('SELECT id FROM groups WHERE invite_code_lookup = ?')
    .bind(lookup)
    .first<{ id: string }>();
  if (taken) return Response.json({ error: 'code_taken' }, { status: 409 });

  const salt = randomToken(16);
  const hash = await hashInviteCode(code, salt);
  const groupId = newId('grp');
  const now = Date.now();

  // The slug only has to be unique; the name does not. Two groups of friends
  // may both call themselves The Dads and neither is wrong.
  let slug = slugOf(name);
  for (let attempt = 0; attempt < 5; attempt++) {
    const clash = await env.DB.prepare('SELECT id FROM groups WHERE slug = ?')
      .bind(slug)
      .first<{ id: string }>();
    if (!clash) break;
    slug = `${slugOf(name)}-${randomToken(3).toLowerCase()}`;
  }

  try {
    await env.DB.prepare(
      `INSERT INTO groups
         (id, slug, name, invite_code_hash, invite_code_salt, invite_code_lookup,
          dad_night_tz, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(groupId, slug, name, hash, salt, lookup, 'America/Montreal', now)
      .run();
  } catch {
    // The UNIQUE index caught what the SELECT above could not: somebody took
    // the word in between. Same answer either way.
    return Response.json({ error: 'code_taken' }, { status: 409 });
  }

  const supplied = typeof body.deviceToken === 'string' ? body.deviceToken : '';
  const deviceToken = /^[A-Za-z0-9_-]{32,}$/.test(supplied) ? supplied : randomToken();
  const memberId = newId('mem');
  await env.DB.prepare(
    `INSERT INTO members (id, group_id, display_name, device_token_hash, joined_at, last_seen)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(memberId, groupId, displayName, await hashDeviceToken(secret, deviceToken), now, now)
    .run();

  // Second, not in the INSERT above: members references groups, so the group
  // has to exist before its creator does, and the creator has to exist before
  // the group can name him.
  await env.DB.prepare('UPDATE groups SET created_by = ? WHERE id = ?')
    .bind(memberId, groupId)
    .run();

  await recordRoomMade(env, request, isProduction);

  const cookie = await signIdentity(env, { groupId, memberId }, isProduction);
  const session: Session = {
    group: {
      id: groupId,
      slug,
      name,
      dadNight: null,
      // A new room has everything open. The creator can shut what he does not
      // want; starting him with three things switched off would mean finding
      // out what he is missing before he can ask for it.
      rooms: { questions: true, week: true, table: true },
      createdBy: memberId,
    },
    member: { id: memberId, displayName, avatarAt: null },
  };

  return Response.json(
    { ...session, deviceToken },
    { headers: { 'Set-Cookie': identityCookie(cookie, isProduction) } },
  );
}
