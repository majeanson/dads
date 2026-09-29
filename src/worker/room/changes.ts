import type { LineState } from '../../shared/protocol';
import { reactionsById } from './hydrate';
import type { Room } from './room';
import { chunks } from './storage';

/**
 * How far back the room remembers what happened to lines it had already said.
 *
 * A socket that resumes rather than reloads asks for everything after the
 * last change it saw (`?rev=`), and a home-screen app can sleep for DAYS
 * before it does: a one-day window let a photograph taken back on Monday
 * stay on a phone that woke on Thursday. Past these bounds the room does not
 * guess — it hands the phone a fresh backfill to replace what it holds.
 */
const CHANGE_MEMORY_MS = 30 * 24 * 60 * 60 * 1000;
const CHANGE_MEMORY_ROWS = 5000;

/** What changed: a line's words or marks, a line taken back, or a picture. */
export type ChangeKind = 'line' | 'gone' | 'media';

/**
 * Write down that something happened to a line (or its picture), and
 * return its `rev` for the frame that says so.
 *
 * Swept here, the only place that adds a row: past CHANGE_MEMORY_MS or
 * CHANGE_MEMORY_ROWS the oldest go — but never the newest, which is what
 * `currentRev` reads, so the count never goes backwards.
 */
export function noteChange(room: Room, kind: ChangeKind, ref: string): number {
  const now = Date.now();
  const rev = room.sql
    .exec<{ rev: number }>(
      'INSERT INTO changes (kind, ref, at) VALUES (?, ?, ?) RETURNING rev',
      kind,
      ref,
      now,
    )
    .one().rev;
  room.sql.exec(
    'DELETE FROM changes WHERE rev < ? AND (at < ? OR rev <= ?)',
    rev,
    now - CHANGE_MEMORY_MS,
    rev - CHANGE_MEMORY_ROWS,
  );
  return rev;
}

/** The newest change, or 0 in a room where nothing has changed yet. */
export function currentRev(room: Room): number {
  return (
    room.sql.exec<{ rev: number | null }>('SELECT MAX(rev) AS rev FROM changes').one().rev ?? 0
  );
}

/**
 * Whether every change after `since` is still written down. Not if the
 * oldest one kept is past the one after it (swept), and not if `since` is
 * ahead of anything this room has ever numbered (a room that lost its
 * storage, or a number from somewhere else).
 */
export function remembersSince(room: Room, since: number): boolean {
  const { oldest, newest } = room.sql
    .exec<{ oldest: number | null; newest: number | null }>(
      'SELECT MIN(rev) AS oldest, MAX(rev) AS newest FROM changes',
    )
    .one();
  if (since > (newest ?? 0)) return false;
  return oldest === null || since >= oldest - 1;
}

/**
 * Everything that happened after `since`, as what it is NOW rather than
 * as the steps that got there: a line marked, unmarked and edited is one
 * entry with its current words and marks. Words from the tail, which
 * holds the newest; from the archive for a line older than the tail.
 */
export async function replaySince(
  room: Room,
  since: number,
): Promise<{
  gone: string[];
  changed: LineState[];
  media: { mediaId: string; kept: boolean | null }[];
}> {
  const rows = room.sql
    .exec<{ kind: ChangeKind; ref: string }>(
      'SELECT kind, ref FROM changes WHERE rev > ? ORDER BY rev',
      since,
    )
    .toArray();
  const gone = new Set(rows.filter((r) => r.kind === 'gone').map((r) => r.ref));
  const lineIds = [
    ...new Set(rows.filter((r) => r.kind === 'line' && !gone.has(r.ref)).map((r) => r.ref)),
  ];
  const mediaIds = [...new Set(rows.filter((r) => r.kind === 'media').map((r) => r.ref))];

  const words = new Map<string, { body: string; editedAt: number | null }>();
  for (const id of lineIds) {
    const row = room.sql
      .exec<{ body: string; edited_at: number | null }>(
        'SELECT body, edited_at FROM tail WHERE id = ?',
        id,
      )
      .toArray()[0];
    if (row !== undefined) words.set(id, { body: row.body, editedAt: row.edited_at });
  }
  const groupId = room.groupId();
  const older = lineIds.filter((id) => !words.has(id));
  // Chunked, like every other `IN (...)` a resume can build: the log keeps
  // thirty days of changes, D1 takes about a hundred bound parameters, and a
  // phone that slept a fortnight while the shelf turned over would otherwise
  // throw here, get no hello, and reconnect with the same `rev` for ever.
  if (older.length > 0 && groupId !== undefined) {
    for (const slice of chunks(older)) {
      const { results } = await room.env.DB.prepare(
        `SELECT id, body, edited_at FROM messages
          WHERE group_id = ? AND id IN (${slice.map(() => '?').join(', ')})`,
      )
        .bind(groupId, ...slice)
        .all<{ id: string; body: string; edited_at: number | null }>();
      for (const r of results) words.set(r.id, { body: r.body, editedAt: r.edited_at });
    }
  }
  const marks = await reactionsById(room, lineIds);
  const changed = lineIds.flatMap((id) => {
    const w = words.get(id);
    return w === undefined ? [] : [{ id, ...w, reactions: marks.get(id) ?? [] }];
  });

  const kept = new Map<string, boolean>();
  if (mediaIds.length > 0 && groupId !== undefined) {
    for (const slice of chunks(mediaIds)) {
      const { results } = await room.env.DB.prepare(
        `SELECT id, kept FROM media
          WHERE group_id = ? AND id IN (${slice.map(() => '?').join(', ')})`,
      )
        .bind(groupId, ...slice)
        .all<{ id: string; kept: number }>();
      for (const r of results) kept.set(r.id, r.kept === 1);
    }
  }
  const media = mediaIds.map((mediaId) => ({ mediaId, kept: kept.get(mediaId) ?? null }));

  return { gone: [...gone], changed, media };
}
