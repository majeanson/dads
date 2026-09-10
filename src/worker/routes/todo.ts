import { buildBoard } from '../board';
import type { Env } from '../env';
import { todaysPrompt } from '../prompts';
import { currentSession } from './auth';

/**
 * GET /api/todo — what is waiting for this dad.
 *
 * Drives the marks on the tabs, so a dad can tell from the room whether there
 * is anything to go and do. Deliberately about HIM, not about the group: a
 * question somebody else answered is not a thing you need to do.
 */
export async function getTodo(
  request: Request,
  env: Env,
  isProduction: boolean,
): Promise<Response> {
  const session = await currentSession(request, env, isProduction);
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const [today, board] = await Promise.all([
    todaysPrompt(env, session.group.id),
    buildBoard(env, session.group.id, session.member.id),
  ]);

  let prompt = false;
  if (today !== null) {
    const mine = await env.DB.prepare(
      'SELECT id FROM messages WHERE group_id = ? AND prompt_id = ? AND member_id = ? LIMIT 1',
    )
      .bind(session.group.id, today.prompt.id, session.member.id)
      .first<{ id: string }>();
    prompt = mine === null;
  }

  const mine = board.weeks[0]?.rows.find((r) => r.memberId === session.member.id) ?? null;
  // Two different asks, one mark: last week is still open, or this week is
  // still blank.
  const board_ = board.pending !== null || mine === null || mine.checkIn === null;

  return Response.json({ prompt, board: board_ });
}
