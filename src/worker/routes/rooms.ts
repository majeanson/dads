import { IDENTITY_HEADERS } from '../RoomDO';
import type { Env } from '../env';
import type { RoomsOpen } from '../../shared/protocol';
import { currentSession } from './auth';

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
