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

  // Only what was sent changes; a client that knows about two switches must
  // not silently turn a third one on.
  const next: RoomsOpen = {
    questions: body.questions ?? session.group.rooms.questions,
    week: body.week ?? session.group.rooms.week,
    table: body.table ?? session.group.rooms.table,
  };

  await env.DB.prepare(
    'UPDATE groups SET questions_on = ?, week_on = ?, table_on = ? WHERE id = ?',
  )
    .bind(Number(next.questions), Number(next.week), Number(next.table), session.group.id)
    .run();

  // Every open room finds out without a reload, the same way the night does.
  const stub = env.ROOM.get(env.ROOM.idFromName(session.group.id));
  await stub.fetch('https://room/rooms', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [IDENTITY_HEADERS.groupId]: session.group.id,
    },
    body: JSON.stringify(next),
  });

  return Response.json({ rooms: next });
}
