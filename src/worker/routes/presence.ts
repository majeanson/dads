import type { Env } from '../env';
import { currentSession } from './auth';

/** One evening's worth of coming and going, at five dads on phones. */
const LIMIT = 60;

/**
 * GET /api/presence — who has been about.
 *
 * The comings and goings, which used to be lines in the conversation and are
 * not any more: nobody said them, and a room of five on phones that switch
 * networks would archive little else. They live behind the header's "3 here",
 * which is where a dad looks when he actually wants to know.
 *
 * Newest first, and scoped to the caller's own group like everything else.
 */
export async function getPresence(
  request: Request,
  env: Env,
  isProduction: boolean,
): Promise<Response> {
  const session = await currentSession(request, env, isProduction);
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const rows = await env.DB.prepare(
    `SELECT name, kind, created_at FROM presence
     WHERE group_id = ? ORDER BY created_at DESC LIMIT ?`,
  )
    .bind(session.group.id, LIMIT)
    .all<{ name: string; kind: 'in' | 'out'; created_at: number }>();

  return Response.json({
    events: (rows.results ?? []).map((r) => ({ name: r.name, kind: r.kind, at: r.created_at })),
  });
}
