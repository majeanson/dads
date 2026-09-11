/**
 * Which build a page is.
 *
 * Nothing here is cached — the service worker keeps no shell and every asset
 * revalidates — so a fresh LOAD is always the newest build. The problem is
 * that an app added to an iPhone's home screen is not loaded fresh: it is put
 * to sleep and woken, for days, and what wakes is whatever was deployed the
 * last time he opened it cold. He would go on running a build from last week
 * while the room he is talking to runs this one.
 *
 * The served page names its bundle (`/assets/index-<hash>.js`) and so does the
 * page that is running; when they differ, a reload is the whole fix. These two
 * are the pure half of that and are React-free so the unit suite can import
 * them; the hook is `useFreshBuild`.
 */

/** The bundle an HTML page names, or null if it names none (the dev server). */
export function bundleOf(html: string): string | null {
  const match = /<script[^>]+src="(\/assets\/index-[^"]+\.js)"/.exec(html);
  return match?.[1] ?? null;
}

/** Whether the page at `served` is a different build from the one `running`. */
export function isNewer(running: string | null, served: string | null): boolean {
  return running !== null && served !== null && running !== served;
}
