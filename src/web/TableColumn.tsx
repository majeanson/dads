import { ExternalLink, RotateCcw, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { JAFFRE_ORIGIN, parseTableEvent, type TableEvent } from '../shared/jaffre';
import { fetchTable, newTable, type TableInfo } from './api';
import { useT } from './i18n';
import { noteAfter, noteText, type Note } from '../shared/tableNote';
import { Button } from './ui/Button';

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
 *
 * `pulse` moves when somebody started a new table: the group's code changed,
 * and the frame is pointed at the new one. That is a navigation inside the
 * frame, not a remount — the game it leaves is the one being cleared.
 */
export function TableColumn({
  onEvent,
  onClose,
  pulse,
}: {
  onEvent: (event: TableEvent) => void;
  onClose: () => void;
  pulse: number;
}) {
  const { t } = useT();
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
  const [note, setNote] = useState<Note | null>(null);
  const [now, setNow] = useState(() => Date.now());
  /** "New table" asks once, then does it: a game in progress ends for all. */
  const [arming, setArming] = useState(false);
  const [failed, setFailed] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const heard = useRef(false);

  /** A different table is a fresh wait: nothing it said yet, nothing noted. */
  const pointed = useRef<string | null>(null);
  const pointAt = useCallback((next: TableInfo) => {
    if (pointed.current === next.embedUrl) return;
    pointed.current = next.embedUrl;
    heard.current = false;
    setSilent(false);
    setNote(null);
    setTable(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchTable()
      .then((t) => !cancelled && pointAt(t))
      .catch(() => !cancelled && setTable((was) => (was === 'loading' ? null : was)));
    return () => {
      cancelled = true;
    };
  }, [pulse, pointAt]);

  // An armed button that nobody confirms goes back to sleep.
  useEffect(() => {
    if (!arming) return;
    const timer = setTimeout(() => setArming(false), 4000);
    return () => clearTimeout(timer);
  }, [arming]);

  const startAgain = useCallback(() => {
    if (!arming) {
      setFailed(false);
      setArming(true);
      return;
    }
    setArming(false);
    newTable()
      .then(pointAt)
      .catch(() => setFailed(true));
  }, [arming, pointAt]);

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
      setNote((n) => noteAfter(n, parsed, Date.now()));
      onEvent(parsed);
    }
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [onEvent]);

  // A countdown ticks once a second and clears itself when it reaches the
  // end; the other notes need no clock.
  useEffect(() => {
    if (note === null || !('until' in note)) return;
    const timer = setInterval(() => {
      const at = Date.now();
      setNow(at);
      if (at >= note.until) setNote((n) => (n === note ? null : n));
    }, 1000);
    return () => clearInterval(timer);
  }, [note]);

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
          <h2>{t('t.title')}</h2>
          <Button look="quiet" size="sm" onClick={onClose}>
            <X size={14} aria-hidden="true" />
            {t('t.close')}
          </Button>
        </div>
        <p className="table-fallback quiet">{t('t.setting')}</p>
      </section>
    );
  }

  if (!table) {
    return (
      <section className="table-frame" data-testid="table">
        <div className="table-head">
          <h2>{t('t.title')}</h2>
          <Button look="quiet" size="sm" onClick={onClose}>
            <X size={14} aria-hidden="true" />
            {t('t.close')}
          </Button>
        </div>
        <div className="table-fallback">
          <p className="error">{t('t.unreachable')}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="table-frame" data-testid="table">
      <div className="table-head">
        {/* On a phone the panel IS the table, and a label saying so costs a
            row of a game that wants every pixel. Kept for anything reading
            the page aloud, where the section still needs its name. */}
        <h2 className="max-[30rem]:sr-only">{t('t.title')}</h2>
        {failed ? (
          <span className="table-note error" role="status">
            {t('t.new_failed')}
          </span>
        ) : note === null ? null : (
          <span className="table-note" role="status" data-testid="table-note">
            {noteText(t, note, now)}
          </span>
        )}
        <span className="table-head-actions">
          <Button
            look={arming ? 'danger' : 'quiet'}
            size="sm"
            onClick={startAgain}
            data-testid="table-new"
            title={t('t.new')}
            className={arming ? undefined : 'max-[30rem]:w-8 max-[30rem]:px-0'}
          >
            <RotateCcw size={14} aria-hidden="true" />
            <span className={arming ? undefined : 'max-[30rem]:sr-only'}>
              {arming ? t('t.new_sure') : t('t.new')}
            </span>
          </Button>
          <a
            href={table.shareUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-8 items-center gap-1.5 rounded-app border border-edge px-2.5 text-sm text-ink no-underline transition-colors duration-75 hover:border-accent hover:text-accent max-[30rem]:w-8 max-[30rem]:justify-center max-[30rem]:px-0"
            title={t('t.own_tab')}
          >
            <ExternalLink size={14} aria-hidden="true" />
            <span className="max-[30rem]:sr-only">{t('t.own_tab')}</span>
          </a>
          <Button look="quiet" size="iconSm" onClick={onClose} aria-label={t('t.close')}>
            <X size={15} aria-hidden="true" />
            <span className="sr-only">{t('t.close')}</span>
          </Button>
        </span>
      </div>

      {blocked ? (
        // If the frame will not load — an extension, a locked-down browser —
        // the column stops pretending and hands over a link that will.
        <div className="table-fallback" data-testid="table-fallback">
          <p className="quiet">{t('t.blocked')}</p>
          <a href={table.shareUrl} target="_blank" rel="noopener noreferrer">
            {t('t.play')}
          </a>
        </div>
      ) : (
        <>
          {silent ? (
            <p className="table-silent" data-testid="table-silent">
              {t('t.silent')}{' '}
              <a href={table.shareUrl} target="_blank" rel="noopener noreferrer">
                {t('t.silent_link')}
              </a>{' '}
              {t('t.silent_or')}{' '}
              <button type="button" className="link" onClick={retry}>
                {t('t.try_again')}
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
