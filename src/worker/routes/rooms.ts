import { IDENTITY_HEADERS } from '../RoomDO';
import type { Env } from '../env';
import type { RoomsOpen } from '../../shared/protocol';
import { currentSession } from './auth';

/**
 * PUT /api/rooms — what this group has open.
 *
 * Any dad may change it, exactly like dad night: there is no admin in a room
 * of five friends, and inventing one for three switches would be inventing
 * one. It is the group's setting and not each man's, because two dads seeing
 * different menus is how a group stops sharing a room.
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
