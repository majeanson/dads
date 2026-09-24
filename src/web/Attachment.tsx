import { Paperclip, Pin } from 'lucide-react';
import type { Attachment as MessageAttachment } from '../shared/protocol';
import { useT } from './i18n';
import { isAudio, isImage, isVideo, mediaUrl } from './media';
import { VoiceNote } from './VoiceNote';

/**
 * The mark on something nothing will throw away.
 *
 * Only when it IS kept, the same rule as the marks on a line: a room where
 * every photograph carried a badge saying it was ordinary would be a room with
 * a badge on every photograph.
 *
 * Over a picture or a clip, because a caption under a photograph is a row the
 * photograph was already saying; beside a voice note or a file, where there is
 * no picture to sit on and the words do it better anyway.
 */
function Kept({ over }: { over: boolean }) {
  const { t } = useT();
  return over ? (
    <span
      className="absolute top-1.5 left-1.5 grid h-6 w-6 place-items-center rounded-full bg-paper/85 text-ink"
      data-testid="kept"
    >
      <Pin size={13} aria-hidden="true" />
      <span className="sr-only">{t('line.kept')}</span>
    </span>
  ) : (
    <span className="mt-1 flex items-center gap-1 text-xs text-muted" data-testid="kept">
      <Pin size={11} aria-hidden="true" />
      {t('line.kept')}
    </span>
  );
}

/**
 * A photo or file on a line.
 *
 * An image reserves its real shape before the bytes arrive, so a conversation
 * does not jump around as photos load — which on a phone means the thing you
 * were reading stays where you were reading it.
 */
export function Attachment({
  media,
  onOpen,
}: {
  media: MessageAttachment;
  /** Opens the picture full-screen. Images only; everything else plays or
   * downloads where it sits. */
  onOpen?: () => void;
}) {
  const href = mediaUrl(media.id);

  if (isVideo(media.contentType)) {
    return (
      <span className="relative mt-1.5 block w-fit max-w-full">
        {/* playsInline or an iPhone takes the whole screen for it the moment
            it starts; metadata only, so a room full of clips is not a room
            that downloads itself on open. */}
        <video
          className="block h-auto w-full max-w-80 rounded-lg border border-line bg-panel"
          src={href}
          controls
          playsInline
          preload="metadata"
          width={media.width ?? undefined}
          height={media.height ?? undefined}
        />
        {media.kept ? <Kept over /> : null}
      </span>
    );
  }

  if (isAudio(media.contentType)) {
    // Ours, not the browser's: its player kept every touch to itself, so a
    // long press on a voice note never reached the line's menu.
    return (
      <span className="block">
        <VoiceNote src={href} />
        {media.kept ? <Kept over={false} /> : null}
      </span>
    );
  }

  if (!isImage(media.contentType)) {
    return (
      <span className="block">
        <a
          className="mt-1.5 inline-flex items-center gap-2 rounded-app border border-edge px-2.5 py-1.5 text-sm no-underline hover:border-accent"
          href={href}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Paperclip size={14} aria-hidden="true" className="text-muted" />
          {media.name}
        </a>
        {media.kept ? <Kept over={false} /> : null}
      </span>
    );
  }

  // Nowhere to open it: a picture on a search result, which may be older than
  // every line the viewer holds. A button that does nothing is still a button
  // to a screen reader and to a thumb, so it is not one.
  if (onOpen === undefined) {
    return (
      <span className="relative mt-1.5 block w-fit max-w-full">
        <img
          src={href}
          alt={media.name}
          width={media.width ?? undefined}
          height={media.height ?? undefined}
          loading="lazy"
          decoding="async"
          draggable={false}
          className="block h-auto max-h-64 w-auto max-w-80 rounded-lg border border-line"
        />
        {media.kept ? <Kept over /> : null}
      </span>
    );
  }

  // A button, not a link to the raw file. From the app on a home screen that
  // link threw a dad out into a browser, on the one thing in here nobody
  // would expect to be hard to look at.
  return (
    <span className="relative mt-1.5 block w-fit max-w-full">
      <button
        type="button"
        className="block w-full cursor-pointer overflow-hidden rounded-lg border border-line p-0"
        onClick={onOpen}
        data-testid="photo"
        aria-label={media.name}
      >
        <img
          src={href}
          alt={media.name}
          width={media.width ?? undefined}
          height={media.height ?? undefined}
          loading="lazy"
          decoding="async"
          draggable={false}
          // Capped at a hand's height as well as a width: a tall photo off a
          // phone was a whole screen of one thing, and the line after it
          // was a scroll away. Tap for the real one.
          className="block h-auto max-h-64 w-auto max-w-80"
        />
      </button>
      {media.kept ? <Kept over /> : null}
    </span>
  );
}
