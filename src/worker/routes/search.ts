import type { Env } from '../env';
import { MIN_SEARCH, type Found, type MessageKind } from '../../shared/protocol';
import { currentSession } from './auth';

/**
 * Enough to find the thing, few enough that nobody scrolls a result list.
 *
 * A dad searching is looking for ONE line he half remembers. If it is not in
 * the first forty, the answer is a better word, not a longer list.
 */
const LIMIT = 40;

/** A query is 2000 characters at most, like the lines it is looking for. */
const MAX_QUERY = 2000;

interface Row {
  id: string;
  member_id: string | null;
  name: string | null;
  kind: MessageKind;
  body: string;
  created_at: number;
  media_id: string | null;
  media_name: string | null;
  content_type: string | null;
  width: number | null;
  height: number | null;
}

/**
 * What a dad typed, made safe to put inside a LIKE pattern.
 *
 * `%` and `_` are wildcards in LIKE, so a man searching for "50_50" would
 * otherwise match anything with a character in the middle — and a bare `%`
 * would match the whole archive. Escaped against a backslash, which the
 * query then names with ESCAPE.
 */
function pattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * GET /api/search?q= — find a line again.
 *
 * The archive in D1 is uncapped and the room's backfill is five hundred
 * lines, so everything said before that is on the disk and nowhere a dad can
 * reach it. For five men talking for a year that is most of what they said.
 * This is the only way back to it.
 *
 * Only what somebody TYPED — chat and prompt answers. The room's own lines
 * are furniture ("the table's open", "Marc is in."), and a search that
 * returns fifty of them is a search that buries the one line he wanted.
 *
 * LIKE rather than FTS5: a substring is what a man means when he half
 * remembers a word, it needs no second table to keep in step with retraction,
 * and at the size of a group of five it is a scan of nothing. It is
 * case-insensitive for ASCII, which is what SQLite gives for free; an
 * accented letter has to be typed as it was written.
 */
export async function search(
  request: Request,
  env: Env,
  url: URL,
  isProduction: boolean,
): Promise<Response> {
  const session = await currentSession(request, env, isProduction);
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const q = (url.searchParams.get('q') ?? '').trim().slice(0, MAX_QUERY);
  if (q.length < MIN_SEARCH) return Response.json({ results: [] });

  const rows = await env.DB.prepare(
    `SELECT m.id, m.member_id, m.kind, m.body, m.created_at,
            d.display_name AS name,
            a.id AS media_id, a.name AS media_name, a.content_type, a.width, a.height
       FROM messages m
       LEFT JOIN members d ON d.id = m.member_id
       LEFT JOIN media a ON a.id = m.media_id
      WHERE m.group_id = ?1
        AND m.kind IN ('chat', 'prompt')
        AND m.body LIKE ?2 ESCAPE '\\'
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT ?3`,
  )
    .bind(session.group.id, pattern(q), LIMIT)
    .all<Row>();

  const results: Found[] = (rows.results ?? []).map((r) => ({
    id: r.id,
    memberId: r.member_id,
    // A member whose row is gone still said it. The line is the group's
    // history and does not stop existing because he did.
    name: r.name ?? '',
    kind: r.kind,
    body: r.body,
    at: r.created_at,
    media:
      r.media_id === null
        ? null
        : {
            id: r.media_id,
            name: r.media_name ?? '',
            contentType: r.content_type ?? 'application/octet-stream',
            width: r.width,
            height: r.height,
          },
  }));

  return Response.json({ results });
}
