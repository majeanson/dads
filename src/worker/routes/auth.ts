import type { DadNight } from '../../shared/dadNight';
import type { RoomsOpen } from '../../shared/protocol';
import { hashDeviceToken, randomToken, verifyInviteCode } from '../crypto';
import type { Env } from '../env';
import { doorIsOpen, sessionSecret } from '../env';
import {
  clearedIdentityCookie,
  COOKIE_NAME,
  identityCookie,
  newId,
  readCookie,
  signIdentity,
  verifyIdentity,
} from '../identity';
import { checkJoinThrottle, clearJoinFailures, recordJoinFailure } from '../throttle';
import { groupIdForInvite } from './invite';

export const MAX_NAME_LENGTH = 32;

/** How many groups a single wrong code will be tested against. v1 has one; the
 * cap exists so that a hundredth group cannot turn a join into a hundred
 * PBKDF2 derivations. */
const GROUP_SCAN_LIMIT = 50;

interface GroupRow {
  id: string;
  slug: string;
  name: string;
  invite_code_salt: string;
  invite_code_hash: string;
  dad_night_weekday: number | null;
  dad_night_time: string | null;
  dad_night_tz: string;
  questions_on: number;
  week_on: number;
  table_on: number;
}

export interface Session {
  group: {
    id: string;
    slug: string;
    name: string;
    dadNight: DadNight | null;
    rooms: RoomsOpen;
  };
  member: { id: string; displayName: string };
}

/** Columns to the shared shape. Absent means on: a group made before these
 * columns existed has all three, which is what it had. */
export function roomsFrom(row: {
  questions_on?: number | null;
  week_on?: number | null;
  table_on?: number | null;
}): RoomsOpen {
  return {
    questions: row.questions_on !== 0,
    week: row.week_on !== 0,
    table: row.table_on !== 0,
  };
}

/** Columns → the shared shape. A group with no night set yet is null, not a
 * half-filled object. */
export function nightFrom(row: {
  dad_night_weekday: number | null;
  dad_night_time: string | null;
  dad_night_tz: string;
}): DadNight | null {
  if (row.dad_night_weekday === null || row.dad_night_time === null) return null;
  return { weekday: row.dad_night_weekday, time: row.dad_night_time, tz: row.dad_night_tz };
}

/**
 * POST /api/join — { code | invite, displayName, deviceToken? }
 *
 * The code alone decides which group you land in: dads.marcportal.com has no
 * group picker, because "the dads" is the only thing the people using it know
 * about. That means a wrong code cannot be told apart from a wrong group, and
 * the error says so.
 *
 * An invite token says the same thing with a link instead of a passphrase. It
 * is checked first because a dad who followed one never typed a code, and it
 * fails into exactly the same message: the door tells a stranger nothing about
 * how close he got.
 */
export async function join(request: Request, env: Env, isProduction: boolean): Promise<Response> {
  const throttle = await checkJoinThrottle(env, request, isProduction);
  if (!throttle.allowed) {
    return Response.json(
      { error: 'too_many_attempts', retryAfterSeconds: throttle.retryAfterSeconds },
      { status: 429, headers: { 'Retry-After': String(throttle.retryAfterSeconds) } },
    );
  }

  let body: { code?: unknown; invite?: unknown; displayName?: unknown; deviceToken?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }

  const code = typeof body.code === 'string' ? body.code : '';
  const invite = typeof body.invite === 'string' ? body.invite : '';
  const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';

  // TEMPORARY: with the door open the code box is decoration — see
  // doorIsOpen(). Locked, an empty code is the error it always was.
  const open = doorIsOpen(env);
  if (!code.trim() && !invite && !open) {
    return Response.json({ error: 'missing_code' }, { status: 400 });
  }
  if (!displayName) return Response.json({ error: 'missing_name' }, { status: 400 });
  if ([...displayName].length > MAX_NAME_LENGTH) {
    return Response.json({ error: 'name_too_long' }, { status: 400 });
  }

  const columns = `id, slug, name, invite_code_salt, invite_code_hash,
                    dad_night_weekday, dad_night_time, dad_night_tz,
                    questions_on, week_on, table_on`;

  let group: GroupRow | undefined;
  if (invite) {
    const groupId = await groupIdForInvite(env, invite, isProduction);
    if (groupId !== null) {
      group =
        (await env.DB.prepare(`SELECT ${columns} FROM groups WHERE id = ?`)
          .bind(groupId)
          .first<GroupRow>()) ?? undefined;
    }
  } else {
    const { results } = await env.DB.prepare(`SELECT ${columns} FROM groups LIMIT ?`)
      .bind(GROUP_SCAN_LIMIT)
      .all<GroupRow>();
    // TEMPORARY: the door is unlocked, so whatever he typed opens the only
    // group there is. With more than one group this would be meaningless,
    // which is another reason it is temporary.
    if (open) group = results[0];
    else {
      for (const candidate of results) {
        if (await verifyInviteCode(code, candidate.invite_code_salt, candidate.invite_code_hash)) {
          group = candidate;
          break;
        }
      }
    }
  }

  if (!group) {
    await recordJoinFailure(env, request, isProduction);
    return Response.json({ error: 'bad_code' }, { status: 401 });
  }

  // A token the browser keeps in localStorage as well as in the cookie. If the
  // cookie is lost — a cleared jar, a browser update — the token still
  // identifies the device, so a dad comes back as himself instead of as a
  // second member with the same name.
  // A supplied token has to look like one we issued. Without a floor, two
  // dads who ended up with the same short string — a copied localStorage, a
  // pasted "try this" — would collide on members_by_device, and the second
  // join would silently rename the first dad's row and inherit his history.
  const supplied = typeof body.deviceToken === 'string' ? body.deviceToken : '';
  const deviceToken = /^[A-Za-z0-9_-]{32,}$/.test(supplied) ? supplied : randomToken();
  const deviceHash = await hashDeviceToken(sessionSecret(env, isProduction), deviceToken);
  const now = Date.now();

  const existing = await env.DB.prepare(
    'SELECT id FROM members WHERE group_id = ? AND device_token_hash = ?',
  )
    .bind(group.id, deviceHash)
    .first<{ id: string }>();

  let memberId: string;
  if (existing) {
    memberId = existing.id;
    // Rejoining with a different name is a rename, not a new dad.
    await env.DB.prepare('UPDATE members SET display_name = ?, last_seen = ? WHERE id = ?')
      .bind(displayName, now, memberId)
      .run();
  } else {
    memberId = newId('mem');
    await env.DB.prepare(
      `INSERT INTO members (id, group_id, display_name, device_token_hash, joined_at, last_seen)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(memberId, group.id, displayName, deviceHash, now, now)
      .run();
  }

  await clearJoinFailures(env, request, isProduction);

  const cookie = await signIdentity(env, { groupId: group.id, memberId }, isProduction);
  const session: Session = {
    group: {
      id: group.id,
      slug: group.slug,
      name: group.name,
      dadNight: nightFrom(group),
      rooms: roomsFrom(group),
    },
    member: { id: memberId, displayName },
  };

  return Response.json(
    { ...session, deviceToken },
    { headers: { 'Set-Cookie': identityCookie(cookie, isProduction) } },
  );
}

/**
 * GET /api/me — who the browser is, if anyone. 204 rather than 401: not being
 * signed in is the normal state of a first visit, not a failure.
 */
export async function me(request: Request, env: Env, isProduction: boolean): Promise<Response> {
  const session = await currentSession(request, env, isProduction);
  if (!session) return new Response(null, { status: 204 });
  return Response.json(session);
}

/** POST /api/leave — drop the cookie. The member row stays: his messages,
 * check-ins and commitments are the group's history, not a login session. */
export function leave(isProduction: boolean): Response {
  return new Response(null, {
    status: 204,
    headers: { 'Set-Cookie': clearedIdentityCookie(isProduction) },
  });
}

/**
 * Resolves the signed cookie against the database. A valid signature is not
 * enough: the member must still exist and must still belong to the group the
 * cookie names, so removing a member actually removes him.
 */
export async function currentSession(
  request: Request,
  env: Env,
  isProduction: boolean,
): Promise<Session | null> {
  const identity = await verifyIdentity(env, readCookie(request, COOKIE_NAME), isProduction);
  if (!identity) return null;

  const row = await env.DB.prepare(
    `SELECT m.id AS member_id, m.display_name, g.id AS group_id, g.slug, g.name,
            g.dad_night_weekday, g.dad_night_time, g.dad_night_tz,
            g.questions_on, g.week_on, g.table_on
       FROM members m JOIN groups g ON g.id = m.group_id
      WHERE m.id = ? AND m.group_id = ?`,
  )
    .bind(identity.memberId, identity.groupId)
    .first<{
      member_id: string;
      display_name: string;
      group_id: string;
      slug: string;
      name: string;
      dad_night_weekday: number | null;
      dad_night_time: string | null;
      dad_night_tz: string;
      questions_on: number;
      week_on: number;
      table_on: number;
    }>();

  if (!row) return null;
  return {
    group: {
      id: row.group_id,
      slug: row.slug,
      name: row.name,
      dadNight: nightFrom(row),
      rooms: roomsFrom(row),
    },
    member: { id: row.member_id, displayName: row.display_name },
  };
}
