import type { Env } from '../env';
import { chunks } from '../../shared/chunks';
import {
  PICK_CATEGORIES,
  PICK_FRAGMENTS,
  onlyCategory,
  pickOf,
  type PickItem,
} from '../../shared/picks';
import { currentSession } from './auth';

/**
 * The most lines the SQL hands to the classifier. A room of five men posting
 * links for a year is a few hundred; the sheet is for what was lately worth
 * a look, not an archive, and a bound keeps the marks read cheap.
 */
export const PICKS_LIMIT = 200;

/** A host fragment, made safe for LIKE (it is ours, but the habit is cheap). */
const like = (fragment: string): string => `%${fragment.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

interface Row {
  id: string;
  member_id: string | null;
  body: string;
  created_at: number;
  name: string | null;
  gone: number | null;
}

/**
 * GET /api/picks?only= — what the room has recommended.
 *
 * A view of the lines, not a place to post: a recommendation is a line that
 * holds a link from a known site, so a line taken back is gone from here for
 * the same reason (the archive row is deleted), and a dad who has left keeps
 * his line, as he does in the conversation. The SQL narrows by host fragment
 * with an escaped LIKE; `pickOf` is the test that decides, so a fragment in
 * the middle of an address (`?u=youtube.com`) costs a row read and nothing
 * more. Only what a dad TYPED: chat and prompt answers.
 *
 * Marks are read for the lines that made it, from the same rows the
 * conversation hydrates.
 */
export async function getPicks(
  request: Request,
  env: Env,
  url: URL,
  isProduction: boolean,
): Promise<Response> {
  const session = await currentSession(request, env, isProduction);
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const only = onlyCategory(url.searchParams.get('only'));
  const fragments = (only === null ? PICK_CATEGORIES : [only]).flatMap((c) => PICK_FRAGMENTS[c]);
  const binds = fragments.map(like);
  const matches = binds.map((_, i) => `m.body LIKE ?${i + 3} ESCAPE '\\'`).join(' OR ');

  const { results } = await env.DB.prepare(
    `SELECT m.id, m.member_id, m.body, m.created_at,
            d.display_name AS name, d.gone_at IS NOT NULL AS gone
       FROM messages m
       LEFT JOIN members d ON d.id = m.member_id
      WHERE m.group_id = ?1
        AND m.kind IN ('chat', 'prompt')
        AND (${matches})
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT ?2`,
  )
    .bind(session.group.id, PICKS_LIMIT, ...binds)
    .all<Row>();

  const items: PickItem[] = [];
  for (const r of results ?? []) {
    const found = pickOf(r.body);
    if (found === null || (only !== null && found.category !== only)) continue;
    items.push({
      id: r.id,
      memberId: r.member_id,
      name: r.name ?? '',
      gone: r.gone === 1,
      createdAt: r.created_at,
      url: found.url,
      category: found.category,
      marks: [],
    });
  }

  const byId = new Map(items.map((i) => [i.id, i]));
  for (const slice of chunks(items.map((i) => i.id))) {
    const placeholders = slice.map(() => '?').join(', ');
    const rows = await env.DB.prepare(
      `SELECT message_id, member_id, emoji FROM reactions
        WHERE group_id = ? AND message_id IN (${placeholders})
        ORDER BY created_at ASC`,
    )
      .bind(session.group.id, ...slice)
      .all<{ message_id: string; member_id: string; emoji: string }>();
    for (const row of rows.results ?? []) {
      const item = byId.get(row.message_id);
      if (item === undefined) continue;
      const mark = item.marks.find((m) => m.emoji === row.emoji);
      if (mark) mark.by.push(row.member_id);
      else item.marks.push({ emoji: row.emoji, by: [row.member_id] });
    }
  }

  return Response.json({ picks: items }, { headers: { 'Cache-Control': 'no-store' } });
}
