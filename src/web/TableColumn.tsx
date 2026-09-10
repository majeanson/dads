import { useEffect, useRef, useState } from 'react';
import { JAFFRE_ORIGIN, parseTableEvent, type TableEvent } from '../shared/jaffre';
import { fetchTable, type TableInfo } from './api';

/**
 * The Jaffre table, beside the talking.
 *
 * The frame is never unmounted once it exists — switching to the board and
 * back must not restart a game in progress — so the parent hides it with CSS
 * instead. Anything the table says arrives by postMessage and is relayed into
 * the room by `onEvent`.
 */
export function TableColumn({ onEvent }: { onEvent: (event: TableEvent) => void }) {
  const [table, setTable] = useState<TableInfo | null | 'loading'>('loading');
  const [blocked, setBlocked] = useState(false);
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
      onEvent(parsed);
    }
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [onEvent]);

  if (table === 'loading') {
    return (
      <section className="table-frame">
        <div className="table-head">
          <h2>The table</h2>
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
        <a href={table.shareUrl} target="_blank" rel="noopener noreferrer">
          Open in its own tab ↗
        </a>
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
        <iframe
          ref={frame}
          title="Jaffre"
          src={table.embedUrl}
          onError={() => setBlocked(true)}
          allow="microphone; screen-wake-lock"
          referrerPolicy="strict-origin"
        />
      )}
    </section>
  );
}
