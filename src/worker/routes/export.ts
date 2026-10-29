import type { Env } from '../env';
import { currentSession } from './auth';

/**
 * GET /api/export — everything this dad has put in this room, as a file.
 *
 * Only his own: the lines he typed (and the answers he gave to a question,
 * with the question beside them), his week's check-ins and the things he said
 * he would try. Not the room's, not anybody else's, and not what the app
 * worked out about him. It is the answer to "what do you keep of me" before
 * anyone has to ask it.
 *
 * A download and not a screen: `attachment`, `no-store`. A line he took back
 * is gone from the archive and so is gone from here; a picture is named but
 * not included, because the file is for reading and the album has the rest.
 */
export async function getExport(
  request: Request,
  env: Env,
  isProduction: boolean,
): Promise<Response> {
  const session = await currentSession(request, env, isProduction);
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const groupId = session.group.id;
  const memberId = session.member.id;
  const iso = (ms: number) => new Date(ms).toISOString();

  const lines = await env.DB.prepare(
    `SELECT m.kind, m.body, m.created_at, m.edited_at, p.body AS question, a.name AS picture
       FROM messages m
       LEFT JOIN prompts p ON p.id = m.prompt_id
       LEFT JOIN media a ON a.id = m.media_id
      WHERE m.group_id = ?1 AND m.member_id = ?2 AND m.kind IN ('chat', 'prompt')
      ORDER BY m.created_at, m.id`,
  )
    .bind(groupId, memberId)
    .all<{
      kind: string;
      body: string;
      created_at: number;
      edited_at: number | null;
      question: string | null;
      picture: string | null;
    }>();

  const checkIns = await env.DB.prepare(
    `SELECT week, rating, note, created_at FROM check_ins
      WHERE group_id = ?1 AND member_id = ?2 ORDER BY week`,
  )
    .bind(groupId, memberId)
    .all<{ week: string; rating: number; note: string; created_at: number }>();

  const commitments = await env.DB.prepare(
    `SELECT week, body, outcome, reflection, created_at FROM commitments
      WHERE group_id = ?1 AND member_id = ?2 ORDER BY week`,
  )
    .bind(groupId, memberId)
    .all<{ week: string; body: string; outcome: string; reflection: string; created_at: number }>();

  const file = {
    room: session.group.name,
    name: session.member.displayName,
    exportedAt: iso(Date.now()),
    lines: lines.results.map((r) => ({
      at: iso(r.created_at),
      kind: r.kind,
      text: r.body,
      ...(r.question === null ? {} : { question: r.question }),
      ...(r.picture === null ? {} : { picture: r.picture }),
      ...(r.edited_at === null ? {} : { editedAt: iso(r.edited_at) }),
    })),
    checkIns: checkIns.results.map((r) => ({
      week: r.week,
      rating: r.rating,
      note: r.note,
      at: iso(r.created_at),
    })),
    commitments: commitments.results.map((r) => ({
      week: r.week,
      text: r.body,
      outcome: r.outcome,
      reflection: r.reflection,
      at: iso(r.created_at),
    })),
  };

  // The name is a dad's, so it is cut down to something a filename can carry.
  const slug = (s: string) =>
    s
      .normalize('NFKD')
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
      .slice(0, 40) || 'room';
  return new Response(JSON.stringify(file, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="dads-${slug(session.group.name)}-${slug(session.member.displayName)}.json"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
