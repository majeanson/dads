import type { Attachment as MessageAttachment } from '../shared/protocol';
import { isImage, isVideo, mediaUrl } from './media';

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
        className="attachment"
        src={href}
        controls
        playsInline
        preload="metadata"
        width={media.width ?? undefined}
        height={media.height ?? undefined}
      />
    );
  }

  if (!isImage(media.contentType)) {
    return (
      <a className="attachment-file" href={href} target="_blank" rel="noopener noreferrer">
        {media.name}
      </a>
    );
  }

  return (
    <a className="attachment" href={href} target="_blank" rel="noopener noreferrer">
      <img
        src={href}
        alt={media.name}
        width={media.width ?? undefined}
        height={media.height ?? undefined}
        loading="lazy"
        decoding="async"
      />
    </a>
  );
}
