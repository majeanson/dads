import { IDENTITY_HEADERS } from '../RoomDO';
import type { Env } from '../env';
import { sessionSecret } from '../env';
import type { RoomsOpen } from '../../shared/protocol';
import type { Said } from '../../shared/said';
import { hashInviteCode, inviteCodeLookup, randomToken } from '../crypto';
import { currentSession, type Session } from './auth';
import { MAX_CODE_LENGTH, MIN_CODE_LENGTH } from './create';

/**
 * PUT /api/rooms — what this group has open.
 *
 * The creator's, and nobody else's (2026-09-17). These three decide what the
 * room IS — whether it asks a question every day, whether it keeps a week,
 * whether there is a table in it — and a man who opened a room for a purpose
 * should not have that purpose changed by whoever wandered in. It reverses
 * the rule that stood here before, which was that any dad may change them.
 *
 * It is still the GROUP's setting and not each man's: two dads seeing
 * different menus is how a group stops sharing a room. What changed is who
 * holds the switch, not how many switches there are.
 *
 * A room with no creator — every room made before rooms had one — keeps the
 * old rule exactly: no owner, so everybody. That is not a gap to be closed
 * later; it is what those rooms agreed to.
 *
 * The night, the board, the poll and keeping a photograph are NOT this. They
 * are what the group decides together, and they stay everybody's.
 *
 * Nothing is announced in the conversation. A switch is not news, and the
 * change reaches every open room over the socket anyway.
 */
export async function putRooms(
  request: Request,
  env: Env,
  isProduction: boolean,
): Promise<Response> {
  const session = await currentSession(request, env, isProduction);
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });

  // 403 and not 404: he is in the room and can see the switches, so pretending
  // they are not there would be a lie he can disprove by looking. The client
  // does not offer him the control at all; this is what stops a frame that
  // went around it.
  if (session.group.createdBy !== null && session.group.createdBy !== session.member.id) {
    return Response.json({ error: 'not_yours' }, { status: 403 });
  }

  let body: Partial<RoomsOpen>;
  try {
    body = (await request.json()) as Partial<RoomsOpen>;
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }

  // A switch is a boolean or it is absent. Anything else used to reach
  // Number(), and NaN bound to D1 is a NULL rather than a nought — so a body
  // with a string in it did not turn a room off, it broke the NOT NULL
  // constraint and came back a 500 with a stack in the logs.
  const flag = (v: unknown, was: boolean): boolean | null =>
    v === undefined || v === null ? was : typeof v === 'boolean' ? v : null;

  // Only what was sent changes; a client that knows about two switches must
  // not silently turn a third one on.
  const next = {
    questions: flag(body.questions, session.group.rooms.questions),
    week: flag(body.week, session.group.rooms.week),
    table: flag(body.table, session.group.rooms.table),
  };
  if (next.questions === null || next.week === null || next.table === null) {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }
  const rooms: RoomsOpen = { questions: next.questions, week: next.week, table: next.table };

  await env.DB.prepare('UPDATE groups SET questions_on = ?, week_on = ?, table_on = ? WHERE id = ?')
    .bind(Number(rooms.questions), Number(rooms.week), Number(rooms.table), session.group.id)
    .run();

  // Every open room finds out without a reload, the same way the night does.
  const stub = env.ROOM.get(env.ROOM.idFromName(session.group.id));
  await stub.fetch('https://room/rooms', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [IDENTITY_HEADERS.groupId]: session.group.id,
    },
    body: JSON.stringify(rooms),
  });

  return Response.json({ rooms });
}

/**
 * The creator's room, and the two things owning one has to mean.
 *
 * Owning the switches without these was half a feature. If the word got out,
 * nobody in the room could change it — the only rotation was a script on a
 * laptop with the repo on it, which for four friends and a leaked passphrase
 * is no answer at all. And if the man who opened the room drifted away, his
 * switches were frozen for everybody else for ever, with no way to hand them
 * on.
 */
function notYours(session: Session): boolean {
  return session.group.createdBy !== null && session.group.createdBy !== session.member.id;
}

/**
 * PUT /api/rooms/word — change the word that opens this room.
 *
 * The app cannot SHOW the current word and never could: it is kept as a
 * PBKDF2 hash and nothing anywhere knows the plaintext, which is the same
 * reason an invite link carries its own secret instead of the code. So this
 * only ever sets a new one.
 *
 * Everything else about the room survives, exactly as `--rotate` has always
 * promised: the members, the archive, the board, the night. A passphrase
 * changing must never be the reason a group loses its history.
 *
 * Outstanding invite LINKS die with it. They are a separate secret and
 * rotating the word does not technically touch them — but a man rotating the
 * word is closing a door, and leaving a set of keys on the step that still
 * open it would make this feature a lie.
 */
export async function putWord(
  request: Request,
  env: Env,
  isProduction: boolean,
): Promise<Response> {
  const session = await currentSession(request, env, isProduction);
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });
  if (notYours(session)) return Response.json({ error: 'not_yours' }, { status: 403 });

  let body: { code?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }

  const code = typeof body.code === 'string' ? body.code.trim() : '';
  if ([...code].length < MIN_CODE_LENGTH) {
    return Response.json({ error: 'code_too_short' }, { status: 400 });
  }
  if ([...code].length > MAX_CODE_LENGTH) {
    return Response.json({ error: 'code_too_long' }, { status: 400 });
  }

  const secret = sessionSecret(env, isProduction);
  const lookup = await inviteCodeLookup(secret, code);
  const taken = await env.DB.prepare(
    'SELECT id FROM groups WHERE invite_code_lookup = ? AND id != ?',
  )
    .bind(lookup, session.group.id)
    .first<{ id: string }>();
  if (taken) return Response.json({ error: 'code_taken' }, { status: 409 });

  const salt = randomToken(16);
  const hash = await hashInviteCode(code, salt);
  try {
    await env.DB.prepare(
      `UPDATE groups
          SET invite_code_hash = ?, invite_code_salt = ?, invite_code_lookup = ?
        WHERE id = ?`,
    )
      .bind(hash, salt, lookup, session.group.id)
      .run();
  } catch {
    return Response.json({ error: 'code_taken' }, { status: 409 });
  }

  await env.DB.prepare('DELETE FROM invites WHERE group_id = ?').bind(session.group.id).run();

  // Said out loud, without the word in it. The other dads do not need the new
  // one — they are already inside — but a man who was about to send the old
  // one to a friend needs to know it has stopped working.
  await announce(env, session, { k: 'word_changed', by: session.member.displayName });
  return Response.json({ ok: true });
}

/**
 * PUT /api/rooms/owner — hand the room to somebody else.
 *
 * One way and no take-backs: the moment it lands, the switches are his and
 * not yours, and getting them back is him handing them over. That is the
 * honest shape for a thing whose whole point is that exactly one man holds
 * it, and it is why the client arms the button first.
 */
export async function putOwner(
  request: Request,
  env: Env,
  isProduction: boolean,
): Promise<Response> {
  const session = await currentSession(request, env, isProduction);
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });
  if (notYours(session)) return Response.json({ error: 'not_yours' }, { status: 403 });

  let body: { memberId?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }

  const memberId = typeof body.memberId === 'string' ? body.memberId : '';
  // His own group's, or it is not a handover at all: an id from another room
  // would park the switches somewhere nobody in here can reach.
  const to = await env.DB.prepare(
    'SELECT id, display_name FROM members WHERE id = ? AND group_id = ?',
  )
    .bind(memberId, session.group.id)
    .first<{ id: string; display_name: string }>();
  if (!to) return Response.json({ error: 'not_a_member' }, { status: 400 });

  await env.DB.prepare('UPDATE groups SET created_by = ? WHERE id = ?')
    .bind(to.id, session.group.id)
    .run();

  const stub = env.ROOM.get(env.ROOM.idFromName(session.group.id));
  await stub.fetch('https://room/owner', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [IDENTITY_HEADERS.groupId]: session.group.id,
    },
    body: JSON.stringify({ createdBy: to.id }),
  });

  await announce(env, session, {
    k: 'room_handed',
    by: session.member.displayName,
    to: to.display_name,
  });
  return Response.json({ createdBy: to.id });
}

/** One line in the room, by name. Both of these are news in a way a switch is
 * not: they change who can get in, and who decides. */
async function announce(env: Env, session: Session, said: Said): Promise<void> {
  const stub = env.ROOM.get(env.ROOM.idFromName(session.group.id));
  await stub.fetch('https://room/announce', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [IDENTITY_HEADERS.groupId]: session.group.id,
    },
    body: JSON.stringify({ name: session.member.displayName, said }),
  });
}
