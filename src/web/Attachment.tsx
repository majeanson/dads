import { Paperclip } from 'lucide-react';
import type { Attachment as MessageAttachment } from '../shared/protocol';
import { isAudio, isImage, isVideo, mediaUrl } from './media';

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
      // playsInline or an iPhone takes the whole screen for it the moment it
      // starts; metadata only, so a room full of clips is not a room that
      // downloads itself on open.
      <video
        className="mt-1.5 block h-auto w-full max-w-80 rounded-lg border border-line bg-panel"
        src={href}
        controls
        playsInline
        preload="metadata"
        width={media.width ?? undefined}
        height={media.height ?? undefined}
      />
    );
  }

  if (isAudio(media.contentType)) {
    // The browser's own player: a scrubber, a clock and a play button that
    // work the way every other one on the phone does. Nothing to build, and
    // nothing a dad has to learn.
    return (
      <audio
        className="mt-1.5 block w-full max-w-80"
        src={href}
        controls
        preload="metadata"
        data-testid="voice-note"
      />
    );
  }

  if (!isImage(media.contentType)) {
    return (
      <a
        className="mt-1.5 inline-flex items-center gap-2 rounded-app border border-edge px-2.5 py-1.5 text-sm no-underline hover:border-accent"
        href={href}
        target="_blank"
        rel="noopener noreferrer"
      >
        <Paperclip size={14} aria-hidden="true" className="text-muted" />
        {media.name}
      </a>
    );
  }

  // A button, not a link to the raw file. From the app on a home screen that
  // link threw a dad out into a browser, on the one thing in here nobody
  // would expect to be hard to look at.
  return (
    <button
      type="button"
      className="mt-1.5 block w-fit max-w-full cursor-pointer overflow-hidden rounded-lg border border-line p-0"
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
        // Capped at a hand's height as well as a width: a tall photo off a
        // phone was a whole screen of one thing, and the line after it
        // was a scroll away. Tap for the real one.
        className="block h-auto max-h-64 w-auto max-w-80"
      />
    </button>
  );
}
