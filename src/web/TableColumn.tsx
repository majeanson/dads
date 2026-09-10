import { useCallback, useEffect, useRef, useState } from 'react';
import { JAFFRE_ORIGIN, parseTableEvent, type TableEvent } from '../shared/jaffre';
import { fetchTable, type TableInfo } from './api';

/**
 * How long to wait for the table to say anything before offering a way out.
 * Jaffre sends 'ready' as soon as it has a roster, which is a websocket
 * connect away, so several seconds is generous.
 */
const SILENCE_MS = 12_000;

/**
 * The Jaffre table, beside the talking.
 *
 * The frame is never unmounted once it exists — closing the table, or opening
 * anything over it, must not restart a game in progress — so the parent hides
 * it with CSS instead. Anything the table says arrives by postMessage and is
 * relayed into the room by `onEvent`.
 */
export function TableColumn({
  onEvent,
  onClose,
}: {
  onEvent: (event: TableEvent) => void;
  onClose: () => void;
}) {
  const [table, setTable] = useState<TableInfo | null | 'loading'>('loading');
  const [blocked, setBlocked] = useState(false);
  /**
   * The frame loaded but never spoke.
   *
   * Safari partitions — and can outright block — storage in a third-party
   * frame, and jaffre's identity is localStorage-only, so it can fail there in
   * a way that looks like a blank panel rather than an error. Nothing can
   * detect that from out here across origins, so this waits, and if the table
   * has said nothing at all, says so and hands over a link that will work.
   */
  const [silent, setSilent] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const heard = useRef(false);

  useEffect(() => {
    let cancelled = false;
    fetchTable()
      .then((t) => !cancelled && setTable(t))
      .catch(() => !cancelled && setTable(null));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function receive(event: MessageEvent) {
      // The origin check is the whole security boundary here: any page can
      // postMessage at us, and a table event turns into a line in the room.
      if (event.origin !== JAFFRE_ORIGIN) return;
      if (frame.current && event.source !== frame.current.contentWindow) return;

      const parsed = parseTableEvent(event.data);
      if (!parsed) return;
      heard.current = true;
      setSilent(false);
      onEvent(parsed);
    }
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [onEvent]);

  // Starts only once there is a frame to wait on.
  useEffect(() => {
    if (table === 'loading' || table === null) return;
    const timer = setTimeout(() => {
      if (!heard.current) setSilent(true);
    }, SILENCE_MS);
    return () => clearTimeout(timer);
  }, [table]);

  const retry = useCallback(() => {
    setSilent(false);
    heard.current = false;
    const el = frame.current;
    // Setting src to the value it already holds is still a navigation, so the
    // frame really does reload. Read it out first: assigning the property to
    // itself is a no-op to a linter and a reload to the browser, and the
    // linter is the one that would win.
    if (el !== null) {
      const src = el.src;
      el.src = src;
    }
  }, []);

  if (table === 'loading') {
    return (
      <section className="table-frame">
        <div className="table-head">
          <h2>The table</h2>
          <button type="button" className="link" onClick={onClose}>
            Close the table
          </button>
        </div>
        <p className="table-fallback quiet">Setting the table…</p>
      </section>
    );
  }

  if (!table) {
    return (
      <section className="table-frame" data-testid="table">
        <div className="table-head">
          <h2>The table</h2>
          <button type="button" className="link" onClick={onClose}>
            Close the table
          </button>
        </div>
        <div className="table-fallback">
          <p className="quiet">Couldn’t reach the table.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="table-frame" data-testid="table">
      <div className="table-head">
        <h2>The table</h2>
        <span className="table-head-actions">
          <a href={table.shareUrl} target="_blank" rel="noopener noreferrer">
            Open in its own tab ↗
          </a>
          <button type="button" className="link" onClick={onClose}>
            Close the table
          </button>
        </span>
      </div>

      {blocked ? (
        // If the frame will not load — an extension, a locked-down browser —
        // the column stops pretending and hands over a link that will.
        <div className="table-fallback" data-testid="table-fallback">
          <p className="quiet">The table won’t open in here.</p>
          <a href={table.shareUrl} target="_blank" rel="noopener noreferrer">
            Play Jaffre
          </a>
        </div>
      ) : (
        <>
          {silent ? (
            <p className="table-silent" data-testid="table-silent">
              The table isn’t answering in here.{' '}
              <a href={table.shareUrl} target="_blank" rel="noopener noreferrer">
                Open it in its own tab
              </a>{' '}
              or{' '}
              <button type="button" className="link" onClick={retry}>
                try again
              </button>
              .
            </p>
          ) : null}
          <iframe
            ref={frame}
            title="Jaffre"
            src={table.embedUrl}
            onError={() => setBlocked(true)}
            allow="microphone; screen-wake-lock"
            // strict-origin is what jaffre reads to decide we are allowed to
            // hear it; without a referrer it stays silent on purpose.
            referrerPolicy="strict-origin"
          />
        </>
      )}
    </section>
  );
}
