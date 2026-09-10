import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { fetchTodo, type Session, type Todo } from './api';
import { Attachment } from './Attachment';
import { Board } from './Board';
import { CallBar } from './CallBar';
import { Here } from './Here';
import { useT } from './i18n';
import { describeSaid } from '../shared/said';
import { nightItem, nightSoon, NightEditor } from './NightEditor';
import { prepare, readableSize, upload, type Prepared } from './media';
import { toRows } from './messageGroups';
import { PromptCard } from './PromptCard';
import { PromptList } from './PromptList';
import { Sheet } from './Sheet';
import { TableColumn } from './TableColumn';
import { Toggles } from './Toggles';
import { useCall } from './useCall';
import { useRoom } from './useRoom';

function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** Coarse enough to be free, fine enough that a countdown stays honest. */
const TICK_MS = 15_000;

/** What is open over the room, if anything. */
type Sheets = 'menu' | 'here' | 'prompts' | 'board' | 'night';

/**
 * The room is the conversation and the call. That is the whole screen.
 *
 * Everything else the app can do — the day's question, the week's board, the
 * table, the standing night, the way out — is one button away and nothing at
 * all until it is asked for. There is no tab strip, because tabs are a claim
 * that four things matter equally, and here they do not: dads came to talk.
 *
 * The menu carries a mark when something is waiting for YOU — a question you
 * have not answered, a week you have not filled in. A mark for something
 * somebody else did would be noise, and a number would invite you to drive it
 * to zero.
 *
 * The table is the one thing that is not a sheet: it stays mounted for the
 * whole evening, because unmounting the iframe restarts a game in progress.
 * Open, it sits beside the conversation on a wide screen and takes its place
 * on a phone.
 */
export function Room({ session, onSignOut }: { session: Session; onSignOut: () => void }) {
  const { t, lang } = useT();
  const room = useRoom(true, session.group.dadNight);
  const [sheet, setSheet] = useState<Sheets | null>(null);
  const [tableOpen, setTableOpen] = useState(false);
  const [draft, setDraft] = useState('');
  /** Picked but not sent: the dad still gets a caption, or a change of mind. */
  const [pending, setPending] = useState<Prepared | null>(null);
  const [sending, setSending] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [todo, setTodo] = useState<Todo>({ prompt: false, board: false });
  const [now, setNow] = useState(() => Date.now());
  const picker = useRef<HTMLInputElement>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const call = useCall({
    you: room.you?.memberId ?? null,
    members: room.call,
    send: room.sendSignal,
    onJoinChange: room.setInCall,
  });

  // The room hook has no business knowing what a session description is; the
  // call does. This is the seam between them.
  const { onSignalRef } = room;
  const { onSignal } = call;
  useEffect(() => {
    onSignalRef.current = onSignal;
  }, [onSignal, onSignalRef]);

  const refreshTodo = useCallback(() => {
    fetchTodo()
      .then(setTodo)
      .catch(() => {
        // No mark is better than a wrong one.
      });
  }, []);

  // Anything that could change what is waiting — an answer, a check-in, a
  // commitment — arrives as a line in the room.
  const lastSeq = room.messages.at(-1)?.seq ?? 0;
  useEffect(refreshTodo, [refreshTodo, lastSeq]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!tableOpen) bottom.current?.scrollIntoView({ block: 'end' });
  }, [room.messages.length, tableOpen]);

  useEffect(() => {
    document.title = session.group.name;
  }, [session.group.name]);

  async function pick(file: File | undefined) {
    setUploadError(null);
    if (file === undefined) return;
    setPending(await prepare(file));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    // A photo with no caption is still something said.
    if (!body && pending === null) return;

    if (pending === null) {
      if (room.send(body)) setDraft('');
      return;
    }

    setSending(true);
    setUploadError(null);
    const result = await upload(pending);
    setSending(false);

    if (!result.ok) {
      setUploadError(
        result.error === 'too_large' ? t('composer.too_large') : t('composer.upload_failed'),
      );
      return;
    }
    if (room.send(body, result.media.id)) {
      setDraft('');
      setPending(null);
      if (picker.current !== null) picker.current.value = '';
    }
  }

  const typingNames = [...room.typing.entries()]
    .filter(([id]) => id !== session.member.id)
    .map(([, name]) => name);

  const waiting = todo.prompt || todo.board;
  const soon = nightSoon(t, lang, room.night, now);
  const days = {
    today: t('day.today'),
    yesterday: t('day.yesterday'),
    locale: lang === 'fr' ? 'fr-CA' : 'en-CA',
  };

  return (
    <main className="room" data-table={tableOpen ? 'open' : 'closed'}>
      <header className="room-head">
        <div>
          <h1>{session.group.name}</h1>
          <p className="quiet">
            {/* The count is also the door to the roster and to who has been
                about — the comings and goings are not lines in the
                conversation any more, and this is where you ask for them. */}
            <button
              type="button"
              className="link"
              data-testid="connection"
              onClick={() => setSheet('here')}
            >
              {room.connection === 'open'
                ? t('room.here', { n: room.roster.length })
                : room.connection === 'connecting'
                  ? t('room.opening')
                  : t('room.reconnecting')}
            </button>
            {soon === null ? null : ` · ${soon}`}
          </p>
        </div>
        <button type="button" className="menu-open" onClick={() => setSheet('menu')}>
          {t('room.menu')}
          {waiting ? <span className="mark" data-testid="mark-menu" aria-hidden="true" /> : null}
          {waiting ? <span className="sr-only">{t('room.waiting')}</span> : null}
        </button>
      </header>

      <div className="stage">
        <div className="col-talk">
          <CallBar
            state={call.state}
            peers={call.peers}
            muted={call.muted}
            camera={call.camera}
            localStream={call.localStream.current}
            onJoin={() => void call.join()}
            onLeave={call.leave}
            onToggleMute={call.toggleMute}
            onToggleCamera={() => void call.toggleCamera()}
          />

          <ol className="lines" aria-label={t('room.messages')}>
            {room.messages.length === 0 ? (
              <li className="lines-empty quiet">{t('room.empty')}</li>
            ) : null}
            {toRows(room.messages, Date.now(), days).map((row) =>
              row.kind === 'day' ? (
                <li key={`day-${row.key}`} className="day" data-testid="day">
                  <span>{row.label}</span>
                </li>
              ) : (
                <li
                  key={row.key}
                  className={`line line-${row.message.kind}${row.showName ? '' : ' is-continued'}`}
                  data-testid="line"
                >
                  {row.message.kind === 'chat' || row.message.kind === 'prompt' ? (
                    <>
                      <span className="who">{row.showName ? row.message.name : ''}</span>
                      <span className="body">
                        {row.message.kind === 'prompt' ? (
                          <span className="answer-tag">{t('line.answered')}</span>
                        ) : null}
                        {row.message.body}
                        {row.message.media ? <Attachment media={row.message.media} /> : null}
                      </span>
                      <time className="when">{clock(row.message.createdAt)}</time>
                    </>
                  ) : (
                    // The room talking. It carries what happened, not a
                    // sentence, so it can be read in either language — and
                    // falls back to the English body for a line written
                    // before that was true.
                    <span className="body">
                      {row.message.said
                        ? describeSaid(t, lang, row.message.said)
                        : row.message.body}
                    </span>
                  )}
                </li>
              ),
            )}
            <div ref={bottom} />
          </ol>

          <p className="typing" aria-live="polite">
            {typingNames.length > 0 ? t('room.typing', { names: typingNames.join(', ') }) : ' '}
          </p>

          <form className="composer" onSubmit={submit}>
            {pending !== null ? (
              <p className="pending" data-testid="pending-media">
                <span>
                  {pending.name} <span className="quiet">{readableSize(pending.blob.size)}</span>
                </span>
                <button
                  type="button"
                  className="link"
                  onClick={() => {
                    setPending(null);
                    if (picker.current !== null) picker.current.value = '';
                  }}
                >
                  {t('composer.remove')}
                </button>
              </p>
            ) : null}

            {uploadError !== null ? (
              <p className="error" role="alert">
                {uploadError}
              </p>
            ) : null}

            <label htmlFor="attach" className="attach">
              <span aria-hidden="true">＋</span>
              <span className="sr-only">{t('composer.attach')}</span>
            </label>
            <input
              ref={picker}
              id="attach"
              className="sr-only"
              type="file"
              onChange={(e) => void pick(e.target.files?.[0])}
              disabled={room.connection !== 'open' || sending}
            />

            <label htmlFor="say" className="sr-only">
              {t('composer.say')}
            </label>
            <input
              id="say"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                room.sendTyping();
              }}
              placeholder={pending === null ? t('composer.say') : t('composer.caption')}
              autoComplete="off"
              disabled={room.connection !== 'open'}
            />
            <button
              type="submit"
              disabled={
                room.connection !== 'open' || sending || (!draft.trim() && pending === null)
              }
            >
              {sending ? t('composer.sending') : t('composer.send')}
            </button>
          </form>
        </div>

        {/* Always mounted: unmounting the iframe restarts a game in progress. */}
        <div className="col-table">
          <TableColumn onEvent={room.relayTableEvent} onClose={() => setTableOpen(false)} />
        </div>
      </div>

      {sheet === 'menu' ? (
        <Sheet title={t('menu.title')} onClose={() => setSheet(null)}>
          <nav className="menu" aria-label="Rooms">
            <button type="button" onClick={() => setSheet('prompts')}>
              {t('menu.questions')}
              {todo.prompt ? (
                <span className="mark" data-testid="mark-prompts" aria-hidden="true" />
              ) : null}
              {todo.prompt ? <span className="sr-only">{t('room.waiting')}</span> : null}
            </button>

            <button type="button" onClick={() => setSheet('board')}>
              {t('menu.week')}
              {todo.board ? (
                <span className="mark" data-testid="mark-board" aria-hidden="true" />
              ) : null}
              {todo.board ? <span className="sr-only">{t('room.waiting')}</span> : null}
            </button>

            <button
              type="button"
              onClick={() => {
                setTableOpen((v) => !v);
                setSheet(null);
              }}
            >
              {tableOpen ? t('menu.close_table') : t('menu.open_table')}
            </button>

            <button type="button" data-testid="dad-night" onClick={() => setSheet('night')}>
              {nightItem(t, lang, room.night, now)}
            </button>

            <button type="button" onClick={onSignOut}>
              {t('menu.sign_out')}
            </button>

            <Toggles />
          </nav>
        </Sheet>
      ) : null}

      {sheet === 'here' ? (
        <Sheet title={t('here.title')} onClose={() => setSheet(null)}>
          <Here
            roster={room.roster.map((m) => ({
              memberId: m.memberId,
              name: m.name,
              you: m.memberId === session.member.id,
            }))}
          />
        </Sheet>
      ) : null}

      {/* Each sheet mounts when it opens, so it reads fresh data every time
          rather than showing what was true when the page loaded. */}
      {sheet === 'prompts' ? (
        <Sheet title={t('q.title')} onClose={() => setSheet(null)}>
          <PromptCard
            messages={room.messages}
            onAnswer={room.answerPrompt}
            canAnswer={room.connection === 'open'}
          />
          <PromptList />
        </Sheet>
      ) : null}

      {sheet === 'board' ? (
        <Sheet title={t('b.title')} onClose={() => setSheet(null)}>
          <Board onChanged={refreshTodo} />
        </Sheet>
      ) : null}

      {sheet === 'night' ? (
        <Sheet title={t('n.title')} onClose={() => setSheet(null)}>
          <NightEditor night={room.night} onDone={() => setSheet(null)} />
        </Sheet>
      ) : null}
    </main>
  );
}
