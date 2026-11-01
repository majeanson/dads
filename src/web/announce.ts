import type { RoomMessage } from '../shared/protocol';
import type { T } from '../shared/dictionary';

/** Long enough for a sentence or two; a screen reader reading a whole
 * paragraph over the conversation he is in is a lecture, not a line. */
export const ANNOUNCE_LENGTH = 200;

/**
 * A line that arrived, as a screen reader should say it: "Sam: the words".
 *
 * Pure, so the worker pool can test it. What a dad sent with no words is said
 * in words of the reader's language (a photo, a voice note, a file); what he
 * typed is never translated. A reply is said as the line alone: who he was
 * answering is a line up, and reading the quote first buries the news.
 */
export function announce(message: Pick<RoomMessage, 'name' | 'body' | 'media'>, t: T): string {
  const words = message.body.trim();
  const cut =
    words.length > ANNOUNCE_LENGTH ? `${words.slice(0, ANNOUNCE_LENGTH).trimEnd()}…` : words;
  const what = message.media ? attached(message.media.contentType, t) : '';
  const said = [cut, what].filter((part) => part !== '').join(', ');
  return said === '' ? message.name : `${message.name}: ${said}`;
}

/** By the broad kind only: whether it plays inline is the line's business. */
function attached(contentType: string, t: T): string {
  const type = contentType.toLowerCase();
  if (type.startsWith('image/')) return t('log.photo');
  if (type.startsWith('video/')) return t('log.video');
  if (type.startsWith('audio/')) return t('log.voice');
  return t('log.file');
}
