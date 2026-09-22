import { tableLink } from '../../shared/jaffre';
import type { Env } from '../env';
import { IDENTITY_HEADERS } from '../RoomDO';
import { newTableFor, tableCodeFor } from '../table';
import { currentSession } from './auth';

/**
 * GET /api/table — where this group's table is, and the links into it.
 *
 * Built server-side rather than in the client so the code is minted and
 * stored exactly once, by whoever opens the table first.
 */
export async function getTable(
  request: Request,
  env: Env,
  isProduction: boolean,
): Promise<Response> {
  const session = await currentSession(request, env, isProduction);
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const code = await tableCodeFor(env, session.group);
  return Response.json({ code, ...tableLink(code, session.member.displayName) });
}

/**
 * POST /api/table/new — a clean table for the group.
 *
 * Any dad, like a rematch or the night: whether to start again is something
 * the men at the table decide between them, and the one who owns the room's
 * switches may not be the one sitting there. The client arms it first, because
 * a game in progress ends for everybody.
 *
 * Every open screen is stirred rather than handed the code: the link carries
 * each dad's OWN name, so each one fetches his own.
 */
export async function postNewTable(
  request: Request,
  env: Env,
  isProduction: boolean,
): Promise<Response> {
  const session = await currentSession(request, env, isProduction);
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });
  // A room with the table switched off has no table to replace.
  if (!session.group.rooms.table) return Response.json({ error: 'no_table' }, { status: 404 });

  const code = await newTableFor(env, session.group);

  const stub = env.ROOM.get(env.ROOM.idFromName(session.group.id));
  await stub.fetch('https://room/stir', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [IDENTITY_HEADERS.groupId]: session.group.id,
    },
    body: JSON.stringify({ what: 'table' }),
  });

  return Response.json({ code, ...tableLink(code, session.member.displayName) });
}
