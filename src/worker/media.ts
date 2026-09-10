import type { Env } from './env';

/**
 * Shared photos and files.
 *
 * A room keeps the ten most recent. The eleventh silently pushes the oldest
 * out — blob and record together — because the point of this is showing
 * somebody a picture, not keeping one. Nothing here is ever public: objects
 * are served through the Worker behind the same session check as the rest of
 * the app, because these are pictures of people's children.
 */

/** How many a room holds. The cap is the feature, not a limitation of it. */
export const MEDIA_PER_GROUP = 10;

/** Anything larger is refused outright. Images are shrunk in the browser long
 * before they get here; this is the backstop for everything else. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export interface Media {
  id: string;
  name: string;
  contentType: string;
  size: number;
  width: number | null;
  height: number | null;
  memberId: string | null;
  createdAt: number;
}

interface MediaRow {
  id: string;
  name: string;
  content_type: string;
  size: number;
  width: number | null;
  height: number | null;
  member_id: string | null;
  created_at: number;
}

function toMedia(row: MediaRow): Media {
  return {
    id: row.id,
    name: row.name,
    contentType: row.content_type,
    size: row.size,
    width: row.width,
    height: row.height,
    memberId: row.member_id,
    createdAt: row.created_at,
  };
}

/**
 * The only types the browser is ever allowed to render inline from our own
 * origin.
 *
 * An allowlist, not a prefix test, and `image/svg+xml` is deliberately absent:
 * an SVG is a document that can carry script, so serving one inline from
 * dads.marcportal.com would be running an uploader's code on the app's origin,
 * with the session that goes with it. Everything else is sent as a download.
 */
const INLINE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif']);

export function isInlineSafe(contentType: string): boolean {
  return INLINE_TYPES.has(contentType.toLowerCase());
}

export function isImage(contentType: string): boolean {
  return isInlineSafe(contentType);
}

/**
 * What we are willing to write down as a file's type.
 *
 * Anything not on the inline list becomes application/octet-stream: the byte
 * stream is preserved exactly, but nothing downstream can be talked into
 * treating it as a document.
 */
export function safeContentType(declared: string): string {
  const type = declared.split(';')[0]!.trim().toLowerCase();
  return isInlineSafe(type) ? type : 'application/octet-stream';
}

/**
 * Drops everything past the newest `MEDIA_PER_GROUP`.
 *
 * The R2 objects go first: a record with no blob renders as a missing
 * attachment, which is recoverable, while a blob with no record is invisible
 * and pays rent forever.
 */
export async function pruneMedia(env: Env, groupId: string): Promise<number> {
  const { results } = await env.DB.prepare(
    `SELECT id, r2_key FROM media
      WHERE group_id = ?1
      ORDER BY created_at DESC, id DESC
      LIMIT -1 OFFSET ?2`,
  )
    .bind(groupId, MEDIA_PER_GROUP)
    .all<{ id: string; r2_key: string }>();

  if (results.length === 0) return 0;

  await Promise.all(
    results.map((row) =>
      env.MEDIA.delete(row.r2_key).catch((err: unknown) => {
        // A blob that refuses to die is a bill, not a broken room; the record
        // still goes so the cap is honoured.
        console.error('media: could not delete blob', { key: row.r2_key }, err);
      }),
    ),
  );

  const placeholders = results.map(() => '?').join(', ');
  await env.DB.prepare(`DELETE FROM media WHERE id IN (${placeholders})`)
    .bind(...results.map((r) => r.id))
    .run();

  return results.length;
}

export async function mediaFor(env: Env, groupId: string, id: string): Promise<Media | null> {
  const row = await env.DB.prepare(
    `SELECT id, name, content_type, size, width, height, member_id, created_at
       FROM media WHERE id = ? AND group_id = ?`,
  )
    .bind(id, groupId)
    .first<MediaRow>();
  return row ? toMedia(row) : null;
}

/** The R2 key for a piece of media, or null if this group has no such thing. */
export async function keyFor(env: Env, groupId: string, id: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT r2_key FROM media WHERE id = ? AND group_id = ?')
    .bind(id, groupId)
    .first<{ r2_key: string }>();
  return row?.r2_key ?? null;
}

/** Everything the room still holds, newest first. */
export async function recentMedia(env: Env, groupId: string): Promise<Media[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, name, content_type, size, width, height, member_id, created_at
       FROM media WHERE group_id = ?
      ORDER BY created_at DESC, id DESC LIMIT ?`,
  )
    .bind(groupId, MEDIA_PER_GROUP)
    .all<MediaRow>();
  return results.map(toMedia);
}
