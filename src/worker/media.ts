import type { Env } from './env';

/**
 * Shared photos, clips, voice notes and files.
 *
 * A room keeps the ten most recent pictures. The eleventh silently pushes the
 * oldest out — blob and record together — because the point of this is showing
 * somebody a picture, not keeping one. Nothing here is ever public: objects are
 * served through the Worker behind the same session check as the rest of the
 * app, because these are pictures of people's children.
 *
 * Voice notes are counted SEPARATELY, and this is not a detail. They arrived
 * after the cap did and went straight onto the same shelf, which meant a
 * chatty week quietly deleted the photographs — the one thing in here nobody
 * would ever expect to be thrown away. They are also two orders of magnitude
 * smaller: thirty of them is a couple of megabytes, where ten photographs is
 * three. A shelf each, and neither can push the other off.
 */

/** How many pictures a room holds. The cap is the feature, not a limitation. */
export const MEDIA_PER_GROUP = 10;

/** And how many voice notes. Higher because they are small, and because what
 * they are worth is being able to scroll back through the evening. */
export const VOICE_PER_GROUP = 30;

/**
 * And how many a room may take off the shelves altogether.
 *
 * The cap is the feature, and a photograph of somebody's child falling off it
 * is the one thing in here nobody would ever expect to be thrown away. Keeping
 * one is the answer to that, and this is the answer to keeping everything:
 * twice the picture shelf, counted across both kinds, so a group cannot keep
 * its way to an unbounded bucket. Past it, keeping another says so rather than
 * quietly doing nothing.
 */
export const KEPT_PER_GROUP = 20;

/** Anything larger is refused outright. Images are shrunk in the browser long
 * before they get here; this is the backstop for everything else. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export interface Media {
  id: string;
  name: string;
  contentType: string;
  size: number;
  width: number | null;
  height: number | null;
  memberId: string | null;
  createdAt: number;
  /** Off the shelf: the pruner will not take it. */
  kept: boolean;
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
  kept: number;
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
    kept: row.kept === 1,
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
 *
 * Video is on the list because a dad filming his kid on a swing is the same
 * act as photographing him, and a twelve-second clip that downloads instead of
 * playing is a clip nobody watches. It carries no script and no origin of its
 * own: a container the browser either decodes or does not.
 *
 * HEIC is deliberately NOT here. Safari renders it and nothing else does, so
 * inlining it would show the picture to the dads on iPhones and a broken box
 * to everyone else — worse than the download it gets instead. The browser
 * shrinks a HEIC to JPEG on the way out anyway wherever it can decode one.
 */
const INLINE_IMAGES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif']);

/** quicktime is what an iPhone calls the .mov it hands you. */
const INLINE_VIDEO = new Set(['video/mp4', 'video/webm', 'video/quicktime']);

/**
 * What a browser hands back from MediaRecorder, which is not the same on any
 * two of them: Chrome and Firefox give webm (opus), Safari gives mp4 (aac).
 * Same reasoning as video — a container, no script, no origin — and a voice
 * note that downloads instead of playing is a voice note nobody hears.
 */
const INLINE_AUDIO = new Set(['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac']);

export function isInlineSafe(contentType: string): boolean {
  const type = contentType.toLowerCase();
  return INLINE_IMAGES.has(type) || INLINE_VIDEO.has(type) || INLINE_AUDIO.has(type);
}

export function isImage(contentType: string): boolean {
  return INLINE_IMAGES.has(contentType.toLowerCase());
}

export function isVideo(contentType: string): boolean {
  return INLINE_VIDEO.has(contentType.toLowerCase());
}

export function isAudio(contentType: string): boolean {
  return INLINE_AUDIO.has(contentType.toLowerCase());
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
 * Drops everything past the newest on each shelf.
 *
 * The R2 objects go first: a record with no blob renders as a missing
 * attachment, which is recoverable, while a blob with no record is invisible
 * and pays rent forever.
 */
export async function pruneMedia(env: Env, groupId: string): Promise<string[]> {
  const shelves = await Promise.all([
    pruneShelf(env, groupId, false, MEDIA_PER_GROUP),
    pruneShelf(env, groupId, true, VOICE_PER_GROUP),
  ]);
  return [...shelves[0], ...shelves[1]];
}

/**
 * One shelf: the pictures, or the voice notes.
 *
 * The partition is the stored content type, which is the one the allowlist
 * already decided — a file that is not on it is `application/octet-stream` and
 * belongs with the pictures, where the tighter cap is.
 *
 * Kept media is not on either shelf — it is not deleted and it does not take
 * up a place, so keeping a picture never costs the room the next one. Its own
 * bound is KEPT_PER_GROUP, enforced where a dad asks for it.
 */
async function pruneShelf(
  env: Env,
  groupId: string,
  voice: boolean,
  keep: number,
): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, r2_key FROM media
      WHERE group_id = ?1 AND kept = 0 AND (content_type LIKE 'audio/%') = ?3
      ORDER BY created_at DESC, id DESC
      LIMIT -1 OFFSET ?2`,
  )
    .bind(groupId, keep, voice ? 1 : 0)
    .all<{ id: string; r2_key: string }>();

  if (results.length === 0) return [];

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

  return results.map((r) => r.id);
}

/**
 * One piece of media, gone: the blob and the record together.
 *
 * For a line taken back. A photo that outlived the line it was on is the
 * whole reason anybody wants to take one back, so this is not optional
 * tidying — it is the feature. Scoped to the group like everything else that
 * touches the bucket, so an id from another room reaches nothing.
 */
export async function forgetMedia(env: Env, groupId: string, id: string): Promise<void> {
  const key = await keyFor(env, groupId, id);
  if (key === null) return;
  await env.MEDIA.delete(key).catch((err: unknown) => {
    // Same trade as the pruner: a blob that refuses to die is a bill, not a
    // broken room, and the record still goes.
    console.error('media: could not delete blob', { key }, err);
  });
  await env.DB.prepare('DELETE FROM media WHERE id = ? AND group_id = ?').bind(id, groupId).run();
}

export async function mediaFor(env: Env, groupId: string, id: string): Promise<Media | null> {
  const row = await env.DB.prepare(
    `SELECT id, name, content_type, size, width, height, member_id, created_at, kept
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

/**
 * Everything the room still holds, newest first.
 *
 * Bounded by what a room CAN hold rather than by one shelf: the pictures, the
 * voice notes, and everything kept off both. It was MEDIA_PER_GROUP alone,
 * which was right while there was one shelf and quietly wrong the day there
 * were two — thirty voice notes would have hidden every photograph in the
 * room from anything that asked.
 */
export async function recentMedia(env: Env, groupId: string): Promise<Media[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, name, content_type, size, width, height, member_id, created_at, kept
       FROM media WHERE group_id = ?
      ORDER BY created_at DESC, id DESC LIMIT ?`,
  )
    .bind(groupId, MEDIA_PER_GROUP + VOICE_PER_GROUP + KEPT_PER_GROUP)
    .all<MediaRow>();
  return results.map(toMedia);
}

/**
 * Take a picture off the shelf, or put it back on.
 *
 * Any dad, on anybody's photograph — the same rule as the night and the three
 * switches, and for the same reason: whether a picture of five men at a
 * barbecue survives is not something five friends need a permission model
 * for. Scoped to the group, like everything that touches the bucket.
 *
 * Letting one go does NOT delete it. It goes back onto its shelf where it is
 * the oldest thing there, and the next upload may well be the end of it —
 * which is the shelf working, not a deletion a dad asked for.
 */
export async function keepMedia(
  env: Env,
  groupId: string,
  id: string,
  on: boolean,
): Promise<'ok' | 'missing' | 'full'> {
  const row = await env.DB.prepare('SELECT kept FROM media WHERE id = ? AND group_id = ?')
    .bind(id, groupId)
    .first<{ kept: number }>();
  if (row === null) return 'missing';
  // Already where he is asking for it. Idempotent on purpose: two dads on two
  // phones can both press this, and the second must not be an error.
  if ((row.kept === 1) === on) return 'ok';

  if (on) {
    const count = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM media WHERE group_id = ? AND kept = 1',
    )
      .bind(groupId)
      .first<{ n: number }>();
    if ((count?.n ?? 0) >= KEPT_PER_GROUP) return 'full';
  }

  await env.DB.prepare('UPDATE media SET kept = ? WHERE id = ? AND group_id = ?')
    .bind(on ? 1 : 0, id, groupId)
    .run();
  return 'ok';
}
