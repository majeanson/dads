import type { Env } from '../env';
import { newId } from '../identity';
import { answersFor, MAX_PROMPT_LENGTH, promptHistory, promptPool, todaysPrompt } from '../prompts';
import { currentSession, type Session } from './auth';

async function requireSession(
  request: Request,
  env: Env,
  isProduction: boolean,
): Promise<Session | Response> {
  const session = await currentSession(request, env, isProduction);
  return session ?? Response.json({ error: 'unauthorized' }, { status: 401 });
}

/**
 * GET /api/prompt — today's question, and whether you have answered it.
 *
 * Cheap and called on every room load, so it stays separate from the full
 * list; nobody should pay for a hundred prompts to render one card.
 */
export async function getTodaysPrompt(
  request: Request,
  env: Env,
  isProduction: boolean,
): Promise<Response> {
  const session = await requireSession(request, env, isProduction);
  if (session instanceof Response) return session;

  const today = await todaysPrompt(env, session.group.id);
  if (!today) return Response.json({ prompt: null });

  const mine = await env.DB.prepare(
    'SELECT id FROM messages WHERE group_id = ? AND prompt_id = ? AND member_id = ? LIMIT 1',
  )
    .bind(session.group.id, today.prompt.id, session.member.id)
    .first<{ id: string }>();

  return Response.json({ ...today, answered: Boolean(mine) });
}

/** GET /api/prompts — the whole library, what has been asked, and when. */
export async function listPrompts(
  request: Request,
  env: Env,
  isProduction: boolean,
): Promise<Response> {
  const session = await requireSession(request, env, isProduction);
  if (session instanceof Response) return session;

  const [today, pool, history] = await Promise.all([
    todaysPrompt(env, session.group.id),
    promptPool(env, session.group.id),
    promptHistory(env, session.group.id),
  ]);

  return Response.json({ today, pool, history });
}

/** GET /api/prompt-answers?promptId=… — what the group said to one question. */
export async function getPromptAnswers(
  request: Request,
  env: Env,
  url: URL,
  isProduction: boolean,
): Promise<Response> {
  const session = await requireSession(request, env, isProduction);
  if (session instanceof Response) return session;

  const promptId = url.searchParams.get('promptId');
  if (!promptId) return Response.json({ error: 'missing_prompt' }, { status: 400 });

  return Response.json({ answers: await answersFor(env, session.group.id, promptId) });
}

/**
 * POST /api/prompts — { body }
 *
 * Adds a question to this group's own pool. It joins the rotation from the
 * next pick onward; today's question is already pinned and does not move.
 */
export async function addPrompt(
  request: Request,
  env: Env,
  isProduction: boolean,
): Promise<Response> {
  const session = await requireSession(request, env, isProduction);
  if (session instanceof Response) return session;

  let payload: { body?: unknown };
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }

  const body = typeof payload.body === 'string' ? payload.body.trim() : '';
  if (!body) return Response.json({ error: 'empty' }, { status: 400 });
  if ([...body].length > MAX_PROMPT_LENGTH) {
    return Response.json({ error: 'too_long' }, { status: 400 });
  }

  const duplicate = await env.DB.prepare(
    `SELECT id FROM prompts
      WHERE active = 1 AND (group_id IS NULL OR group_id = ?)
        AND lower(body) = lower(?) LIMIT 1`,
  )
    .bind(session.group.id, body)
    .first<{ id: string }>();
  if (duplicate) return Response.json({ error: 'already_asked' }, { status: 409 });

  const id = newId('prm');
  await env.DB.prepare(
    `INSERT INTO prompts (id, group_id, body, author_member_id, active, created_at)
     VALUES (?, ?, ?, ?, 1, ?)`,
  )
    .bind(id, session.group.id, body, session.member.id, Date.now())
    .run();

  return Response.json({
    prompt: {
      id,
      body,
      groupId: session.group.id,
      authorName: session.member.displayName,
      timesAsked: 0,
      lastAsked: null,
      answers: 0,
    },
  });
}
