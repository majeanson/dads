import type { Attachment } from '../shared/protocol';

/**
 * Getting a photo out of a pocket and into the room.
 *
 * A phone camera produces four or five megabytes; nobody wants to send that
 * over mobile data to show the others a picture of a kid in a paddling pool.
 * Images are therefore shrunk in the browser before they are uploaded —
 * long side capped, re-encoded as JPEG — which usually turns 5 MB into about
 * 300 KB and costs nothing on the server. Anything that is not an image goes
 * up exactly as it is.
 */

/** Long side, in pixels. Plenty for a phone screen and for a laptop. */
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.82;
/** A face is stored square at this many pixels: four times what a roster pill
 * shows, which covers a laptop and leaves room to grow. */
const FACE_EDGE = 320;

/**
 * The backstop the server also enforces.
 *
 * Twenty-five rather than ten because of video: ten seconds off a modern phone
 * is fifteen megabytes and there is nothing the browser can do to shrink it,
 * so the old cap meant "no clips". The room keeps ten pictures and thirty
 * voice notes and throws the rest away, so the ceiling on a group is bounded
 * either way.
 */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export interface Prepared {
  blob: Blob;
  name: string;
  width: number | null;
  height: number | null;
}

export function isImage(type: string): boolean {
  return type.startsWith('image/');
}

/** The three containers a browser will play inline. Kept level with the
 * server's own list in src/worker/media.ts, which is what actually decides. */
const INLINE_VIDEO = new Set(['video/mp4', 'video/webm', 'video/quicktime']);

export function isVideo(type: string): boolean {
  return INLINE_VIDEO.has(type.toLowerCase());
}

/** What MediaRecorder hands back, which differs on every browser. Kept level
 * with the server's list, which is what actually decides. */
const INLINE_AUDIO = new Set(['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac']);

export function isAudio(type: string): boolean {
  return INLINE_AUDIO.has(type.toLowerCase());
}

/** "2.4 MB" — what a person would say about a file's size. */
export function readableSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Shrinks an image if it is bigger than it needs to be; passes anything else
 * through untouched.
 *
 * Falls back to the original file whenever the browser cannot do the work —
 * an unsupported format, a canvas that will not encode, a HEIC that decodes
 * nowhere. A large upload beats a failed one.
 */
export async function prepare(file: File): Promise<Prepared> {
  const plain: Prepared = { blob: file, name: file.name, width: null, height: null };
  if (!isImage(file.type)) return plain;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return plain;
  }

  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    // Already small enough and in a format everything reads: leave it alone
    // rather than re-encode it and lose quality for nothing.
    if (scale === 1 && (file.type === 'image/jpeg' || file.type === 'image/png')) {
      return { blob: file, name: file.name, width, height };
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (context === null) return plain;
    context.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
    );
    if (blob === null) return plain;

    return { blob, name: renameToJpeg(file.name), width, height };
  } finally {
    bitmap.close();
  }
}

/**
 * A face, square and small, cut from whatever he picked.
 *
 * Its own function rather than a flag on `prepare`: a face is cropped to the
 * middle and forced to one size, where a photograph posted to the room keeps
 * its shape and only loses pixels it did not need. Nothing is ever uploaded
 * at the size it came off a phone — 320 square is four times what a 40-pixel
 * pill needs, which covers a laptop and leaves room to grow.
 *
 * Returns null when the browser cannot do the work — a HEIC that decodes
 * nowhere, a canvas that will not encode. Unlike a photograph there is no
 * sensible fallback to the original: a twelve-megapixel face is not a face.
 */
export async function prepareFace(file: File): Promise<Blob | null> {
  if (!isImage(file.type)) return null;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }

  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = FACE_EDGE;
    canvas.height = FACE_EDGE;
    const context = canvas.getContext('2d');
    if (context === null) return null;
    // The middle of the picture, which for a photograph of a man is a man.
    context.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      FACE_EDGE,
      FACE_EDGE,
    );
    return await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
    );
  } finally {
    bitmap.close();
  }
}

function renameToJpeg(name: string): string {
  const stem = name.replace(/\.[^.]+$/, '');
  return `${stem || 'photo'}.jpg`;
}

export type UploadResult =
  | { ok: true; media: Attachment; dropped: number }
  | { ok: false; error: 'too_large' | 'empty' | 'unknown' };

export async function upload(prepared: Prepared): Promise<UploadResult> {
  if (prepared.blob.size > MAX_UPLOAD_BYTES) return { ok: false, error: 'too_large' };

  const headers: Record<string, string> = {
    'Content-Type': prepared.blob.type || 'application/octet-stream',
    // A filename can hold anything, including characters no header may carry.
    'X-Dads-Filename': encodeURIComponent(prepared.name).slice(0, 300),
  };
  if (prepared.width !== null) headers['X-Dads-Width'] = String(prepared.width);
  if (prepared.height !== null) headers['X-Dads-Height'] = String(prepared.height);

  const res = await fetch('/api/media', { method: 'POST', headers, body: prepared.blob });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: 'too_large' | 'empty' };
    return { ok: false, error: body.error ?? 'unknown' };
  }
  const body = (await res.json()) as { media: Attachment; dropped: number };
  return { ok: true, media: body.media, dropped: body.dropped };
}

export function mediaUrl(id: string): string {
  return `/api/media?id=${encodeURIComponent(id)}`;
}
