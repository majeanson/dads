import { tableLink } from '../../shared/jaffre';
import type { Env } from '../env';
import { tableCodeFor } from '../table';
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
