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
export function Attachment({ media }: { media: MessageAttachment }) {
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

  return (
    <a
      className="mt-1.5 block w-fit max-w-full overflow-hidden rounded-lg border border-line"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
    >
      <img
        src={href}
        alt={media.name}
        width={media.width ?? undefined}
        height={media.height ?? undefined}
        loading="lazy"
        decoding="async"
        className="block h-auto max-w-80"
      />
    </a>
  );
}
