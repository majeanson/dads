import type { Env } from '../env';
import { chunks } from '../../shared/chunks';
import {
  PICK_CATEGORIES,
  PICK_FRAGMENTS,
  firstLink,
  onlyCategory,
  pickOf,
  type PickCategory,
  type PickItem,
} from '../../shared/picks';
import { IDENTITY_HEADERS } from '../RoomDO';
import { currentSession, type Session } from './auth';

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
  hand: PickCategory | null;
  added_by: string | null;
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
  // ?1 group, ?2 limit, then the category when one is asked for, then the
  // fragments. The filter is in the SQL so "Read" is the newest books and not
  // the books among the newest two hundred lines of anything.
  const first = only === null ? 3 : 4;
  const matches = binds.map((_, i) => `m.body LIKE ?${i + first} ESCAPE '\\'`).join(' OR ');
  // A hand category wins over the classifier: a line on the list by hand is
  // only ever shown under its own, and an unlisted one is a LIKE candidate.
  const narrowed =
    only === null
      ? `(p.message_id IS NOT NULL OR (${matches}))`
      : `(p.category = ?3 OR (p.message_id IS NULL AND (${matches})))`;

  const { results } = await env.DB.prepare(
    `SELECT m.id, m.member_id, m.body, m.created_at,
            d.display_name AS name, d.gone_at IS NOT NULL AS gone,
            p.category AS hand, p.member_id AS added_by
       FROM messages m
       LEFT JOIN line_picks p ON p.message_id = m.id AND p.group_id = m.group_id
       LEFT JOIN members d ON d.id = m.member_id
      WHERE m.group_id = ?1
        AND m.kind IN ('chat', 'prompt')
        AND ${narrowed}
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT ?2`,
  )
    .bind(session.group.id, PICKS_LIMIT, ...(only === null ? [] : [only]), ...binds)
    .all<Row>();

  const items: PickItem[] = [];
  for (const r of results ?? []) {
    const found = pickOf(r.body);
    const category = r.hand ?? found?.category ?? null;
    if (category === null || (only !== null && category !== only)) continue;
    items.push({
      id: r.id,
      memberId: r.member_id,
      name: r.name ?? '',
      gone: r.gone === 1,
      createdAt: r.created_at,
      url: found?.url ?? firstLink(r.body),
      category,
      body: r.hand === null ? '' : r.body,
      addedBy: r.hand === null ? null : r.added_by,
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

/** Tell the open phones to look again. A nudge, never a line in the room. */
async function stir(env: Env, session: Session): Promise<void> {
  const stub = env.ROOM.get(env.ROOM.idFromName(session.group.id));
  await stub.fetch('https://room/stir', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [IDENTITY_HEADERS.groupId]: session.group.id,
    },
    body: JSON.stringify({ what: 'picks' }),
  });
}

/**
 * PUT /api/picks — { id, category }: put a line on the list by hand.
 *
 * Any dad, any typed line of HIS room (404 otherwise, so another room's id
 * says nothing). A line the classifier already recognises needs no row and
 * gets none; one already on the list stays as it is, so the first dad to add
 * it keeps it. Nothing is said in the conversation.
 */
export async function putPick(
  request: Request,
  env: Env,
  isProduction: boolean,
): Promise<Response> {
  const session = await currentSession(request, env, isProduction);
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const raw = (await request.json().catch(() => null)) as {
    id?: unknown;
    category?: unknown;
  } | null;
  const category = raw?.category;
  if (
    typeof raw?.id !== 'string' ||
    typeof category !== 'string' ||
    !(PICK_CATEGORIES as readonly string[]).includes(category)
  ) {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }

  const line = await env.DB.prepare(
    `SELECT body FROM messages WHERE id = ? AND group_id = ? AND kind IN ('chat', 'prompt')`,
  )
    .bind(raw.id, session.group.id)
    .first<{ body: string }>();
  if (line === null) return Response.json({ error: 'not_found' }, { status: 404 });
  if (pickOf(line.body) !== null) return Response.json({ ok: true });

  const written = await env.DB.prepare(
    `INSERT OR IGNORE INTO line_picks (message_id, group_id, member_id, category, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(raw.id, session.group.id, session.member.id, category, Date.now())
    .run();
  if (written.meta.changes > 0) await stir(env, session);
  return Response.json({ ok: true });
}

/**
 * DELETE /api/picks?id= — take your own off the list. The line stays in the
 * conversation. Anyone else's, or one that is not there, is a quiet no-op.
 */
export async function deletePick(
  request: Request,
  env: Env,
  url: URL,
  isProduction: boolean,
): Promise<Response> {
  const session = await currentSession(request, env, isProduction);
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const removed = await env.DB.prepare(
    'DELETE FROM line_picks WHERE message_id = ? AND group_id = ? AND member_id = ?',
  )
    .bind(url.searchParams.get('id') ?? '', session.group.id, session.member.id)
    .run();
  if (removed.meta.changes > 0) await stir(env, session);
  return Response.json({ ok: true });
}
