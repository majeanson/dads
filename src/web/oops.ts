import { bundleOf } from './fresh';

/**
 * Telling the server what went wrong on this phone (`POST /api/oops`).
 *
 * Nobody in a room of three is going to say "the photo didn't send"; they
 * shrug and send it by text. So the phone says it. What goes is a code for
 * where, a message and a stack — never what a dad typed: no line, no name,
 * no word at the door.
 *
 * Fire and forget, and quiet about it: a report that fails is dropped, the
 * same thing twice on one page is said once, and a page that has said twenty
 * things has said enough.
 */

const MAX_PER_PAGE = 20;
const said = new Set<string>();

let build: string | null | undefined;
function running(): string | null {
  build ??= bundleOf(document.documentElement.outerHTML);
  return build;
}

export function report(what: string, err?: unknown, detail?: string): void {
  const message =
    err instanceof Error ? `${err.name}: ${err.message}` : err === undefined ? what : String(err);
  const key = `${what}\n${message}`;
  if (said.has(key) || said.size >= MAX_PER_PAGE) return;
  said.add(key);
  try {
    void fetch('/api/oops', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Survives the page going away: a crash right before a reload is
      // exactly the one worth hearing about.
      keepalive: true,
      body: JSON.stringify({
        what,
        message: message.slice(0, 500),
        detail: (detail ?? (err instanceof Error ? err.stack : undefined))?.slice(0, 2000),
        build: running(),
      }),
    }).catch(() => {});
  } catch {
    // Nothing to be done from here.
  }
}

/**
 * What nothing caught. A cross-origin script's error arrives as "Script
 * error." with nothing in it — an extension, the framed table — and is not
 * ours to report.
 */
export function listen(): void {
  window.addEventListener('error', (event) => {
    if (!event.error && /^Script error\.?$/.test(event.message)) return;
    if (/ResizeObserver loop/.test(event.message)) return;
    report('web.uncaught', event.error ?? event.message);
  });
  window.addEventListener('unhandledrejection', (event) => {
    report('web.rejected', event.reason);
  });
}
