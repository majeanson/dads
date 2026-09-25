import { stillToCome } from '../../shared/dadNight';
import { nightWhen } from '../../shared/dictionary';
import type { Env } from '../env';
import { nightFrom } from './auth';
import { groupIdForInvite } from './invite';

/**
 * GET /i/<token> — the app's own page, with a link preview on it.
 *
 * An invite goes into iMessage or WhatsApp, and the first thing the friend
 * sees is what that app unfurls from it. The page is a single-page app and
 * a preview crawler runs no script, so it was whatever the bare shell said:
 * "dads", no picture, nothing to say who was asking. That is the one moment
 * a man decides whether to tap, and it was a blank.
 *
 * So this path runs the Worker first (`run_worker_first`), fetches the same
 * `index.html` the assets binding would have served, and adds the tags a
 * crawler reads: the room's name, its night if there is one still to come,
 * and the picture. The browser that follows the link gets the same page
 * and the app takes the token off the address bar exactly as before.
 *
 * What it gives away is what the link already gives: whoever holds it can
 * walk in and read the name on the door. No member's name, no line of the
 * conversation. An expired or invented token gets the plain preview, the
 * same as the site's own, so a guess learns nothing about which tokens are
 * real.
 */
export async function invitePage(
  request: Request,
  env: Env,
  url: URL,
  isProduction: boolean,
): Promise<Response> {
  const token = url.pathname.slice('/i/'.length);
  const groupId = await groupIdForInvite(env, token, isProduction).catch(() => null);
  const group =
    groupId === null
      ? null
      : await env.DB.prepare(
          `SELECT name, dad_night_weekday, dad_night_time, dad_night_date, dad_night_tz
             FROM groups WHERE id = ?`,
        )
          .bind(groupId)
          .first<{
            name: string;
            dad_night_weekday: number | null;
            dad_night_time: string | null;
            dad_night_date: string | null;
            dad_night_tz: string;
          }>();

  const shell = await env.ASSETS.fetch(
    new Request(new URL('/', url), { headers: request.headers }),
  );
  const tags = previewTags(url, group);

  // The shell carries the site's own preview, and a crawler reads the FIRST
  // og:title it meets — so those come out before these go in, or every
  // invite unfurled as plain "dads" with the room's name hidden behind it.
  const drop = {
    element(el: Element) {
      el.remove();
    },
  };
  const page = new HTMLRewriter()
    .on('meta[property^="og:"]', drop)
    .on('meta[name="twitter:card"]', drop)
    .on('meta[name="description"]', drop)
    .on('title', {
      element(el) {
        el.setInnerContent(tags.title);
      },
    })
    .on('head', {
      element(el) {
        el.append(tags.html, { html: true });
      },
    })
    .transform(shell);

  const headers = new Headers(page.headers);
  // The token is in this URL. Nothing in between keeps a copy of the page,
  // and nothing it links to is told where it came from.
  headers.set('Cache-Control', 'no-store');
  headers.set('Referrer-Policy', 'no-referrer');
  // What public/_headers gives every other page, which the assets binding
  // does not apply to a response the Worker hands back itself.
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  return new Response(page.body, { status: 200, headers });
}

/** The tags, and the tab's title. Pure, so the escaping can be tested. */
export function previewTags(
  url: URL,
  group: {
    name: string;
    dad_night_weekday: number | null;
    dad_night_time: string | null;
    dad_night_date: string | null;
    dad_night_tz: string;
  } | null,
  now = Date.now(),
): { title: string; html: string } {
  const image = `${url.origin}/og.png`;
  if (group === null) {
    return {
      title: 'dads',
      html: tagsFor({
        title: 'dads',
        description: 'A room for a few dads: somewhere to talk, and a table to sit at.',
        image,
      }),
    };
  }
  const night = nightFrom(group);
  const when =
    night !== null && stillToCome(night, now)
      ? `${nightWhen('en', night)} · ${nightWhen('fr', night)}`
      : null;
  return {
    title: `${group.name} — dads`,
    html: tagsFor({
      title: group.name,
      description: when
        ? `You’re invited. Dad night: ${when}.`
        : 'You’re invited. Come in and say hi. · T’es invité.',
      image,
    }),
  };
}

function tagsFor(t: { title: string; description: string; image: string }): string {
  const title = escape(t.title);
  const description = escape(t.description);
  const image = escape(t.image);
  return [
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="dads" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:image" content="${image}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="description" content="${description}" />`,
  ].join('');
}

/**
 * A room's name is whatever the man who opened it typed, and it goes into an
 * attribute of a page this origin serves. Every character that can end an
 * attribute or open a tag is escaped; nothing else is trusted.
 */
export function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
