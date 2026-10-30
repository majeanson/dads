import { useEffect, useState } from 'react';
import { hostOf } from '../shared/unfurl';

/** What `GET /api/unfurl` answers: the card, with the picture's address being
 * the Worker's own (`/api/unfurl/image?key=…`), never the site's. */
export interface LinkCard {
  url: string;
  title: string;
  description: string | null;
  image: string | null;
  site: string;
}

/**
 * One ask per address per page load, shared by every line that carries it:
 * a link pasted twice is one card, and a backfill of five hundred lines asks
 * for each address once. `null` is "no card" and is remembered too, so a dead
 * link is not asked again every time the list redraws. A network failure is
 * not remembered: the next draw may be online.
 */
const cards = new Map<string, Promise<LinkCard | null>>();

export function cardFor(href: string): Promise<LinkCard | null> {
  const had = cards.get(href);
  if (had !== undefined) return had;
  const asked = fetch(`/api/unfurl?url=${encodeURIComponent(href)}`)
    .then(async (res) => {
      if (res.status === 200) return (await res.json()) as LinkCard;
      if (res.status === 204 || res.status === 404 || res.status === 400) return null;
      throw new Error(`GET /api/unfurl ${res.status}`);
    })
    .catch((err: unknown) => {
      cards.delete(href);
      throw err;
    });
  cards.set(href, asked);
  return asked;
}

/** The card for an address, once it is known; `undefined` while it is not. */
export function useLinkCard(href: string): LinkCard | null | undefined {
  const [card, setCard] = useState<LinkCard | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    setCard(undefined);
    cardFor(href).then(
      (found) => {
        if (live) setCard(found);
      },
      () => {
        if (live) setCard(null);
      },
    );
    return () => {
      live = false;
    };
  }, [href]);
  return card;
}

/**
 * The card under a link: picture, site, title, a line or two of description.
 *
 * It is the link again, so a tap goes where the words above it go; it is
 * drawn only once there is something to draw, so a page with nothing to say
 * leaves the line as it was. Nothing in it is the dad's own words — it is
 * what the page said, and a long press on it is still the line's menu.
 */
export function LinkPreviewCard({ href }: { href: string }) {
  const card = useLinkCard(href);
  if (!card) return null;
  return (
    <a
      className="link-card"
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      data-testid="link-card"
    >
      {card.image ? (
        <img
          className="link-card-image"
          src={card.image}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          referrerPolicy="no-referrer"
          onError={(e) => {
            // A picture that will not come leaves the words to it.
            e.currentTarget.remove();
          }}
        />
      ) : null}
      <span className="link-card-text">
        <span className="link-card-site">{card.site || hostOf(href)}</span>
        <span className="link-card-title">{card.title}</span>
        {card.description ? <span className="link-card-desc">{card.description}</span> : null}
      </span>
    </a>
  );
}
