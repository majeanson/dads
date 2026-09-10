import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { fetchTodo, type Session, type Todo } from './api';
import { Attachment } from './Attachment';
import { Board } from './Board';
import { CallBar, JoinCall } from './CallBar';
import { Here } from './Here';
import {
  ArrowDown,
  CalendarCheck,
  LogOut,
  Menu as MenuIcon,
  MessageCircleQuestion,
  Plus,
  SendHorizontal,
  Settings as SettingsIcon,
  Spade,
  X,
} from 'lucide-react';
import { plural, useT } from './i18n';
import { Button } from './ui/Button';
import { cn } from './ui/cn';
import { parts } from '../shared/linkify';
import { describeSaid } from '../shared/said';
import { nightSoon } from './NightEditor';
import { prepare, readableSize, upload, type Prepared } from './media';
import { toRows } from './messageGroups';
import { PromptCard } from './PromptCard';
import { PromptList } from './PromptList';
import { Settings } from './Settings';
import { Sheet } from './ui/Sheet';
import { TableColumn } from './TableColumn';
import { useCall } from './useCall';
import { useRoom } from './useRoom';

function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** Coarse enough to be free, fine enough that a countdown stays honest. */
const TICK_MS = 15_000;

/** Close enough to the newest line to count as reading it. */
const NEAR_BOTTOM_PX = 80;

/** What is open over the room, if anything. */
type Sheets = 'menu' | 'here' | 'prompts' | 'board' | 'settings';

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
  const room = useRoom(true, session.group.dadNight, session.group.rooms);
  const [sheet, setSheet] = useState<Sheets | null>(null);
  const [tableOpen, setTableOpen] = useState(false);
  const [draft, setDraft] = useState('');
  /** Picked but not sent: the dad still gets a caption, or a change of mind. */
  const [pending, setPending] = useState<Prepared | null>(null);
  /** A thumbnail of it, while it is still his to take back. */
  const [preview, setPreview] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [todo, setTodo] = useState<Todo>({ prompt: false, board: false });
  const [now, setNow] = useState(() => Date.now());
  /** Reading the newest line, rather than back through the week. */
  const [pinned, setPinned] = useState(true);
  const [unseen, setUnseen] = useState(0);
  const picker = useRef<HTMLInputElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const lines = useRef<HTMLOListElement>(null);

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

  /**
   * New lines follow you down only if you were already at the bottom.
   *
   * Scrolling to the newest message on every arrival is right until a dad is
   * reading back through last Thursday, at which point it snatches the page
   * out of his hands every time somebody types. If he is up there, the line
   * waits and the room says how many.
   */
  const counted = useRef(0);
  useEffect(() => {
    const count = room.messages.length;
    // Only a new line does anything here. `pinned` is in the dependencies
    // because the effect reads it, but a dad scrolling must never itself
    // cause a scroll or count as an arrival.
    if (count === counted.current) return;
    const arrived = Math.max(0, count - counted.current);
    counted.current = count;
    if (tableOpen) return;

    if (pinned) bottom.current?.scrollIntoView({ block: 'end' });
    if (pinned && !document.hidden) setUnseen(0);
    else setUnseen((n) => n + arrived);
  }, [room.messages.length, tableOpen, pinned]);

  /** A dad who has scrolled up, or looked away, has not seen it. */
  const atBottom = useCallback(() => {
    const el = lines.current;
    if (el === null) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
  }, []);

  const toBottom = useCallback(() => {
    bottom.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
    setPinned(true);
    setUnseen(0);
  }, []);

  // Coming back to the tab is seeing it.
  useEffect(() => {
    function seen() {
      if (!document.hidden && atBottom()) setUnseen(0);
    }
    document.addEventListener('visibilitychange', seen);
    return () => document.removeEventListener('visibilitychange', seen);
  }, [atBottom]);

  /**
   * The tab's own title carries the count while you are looking elsewhere.
   *
   * No permission, no prompt, no service worker: the one signal a browser will
   * give you for free, and the only one that suits a room five men use.
   */
  useEffect(() => {
    document.title = unseen > 0 ? `(${unseen}) ${session.group.name}` : session.group.name;
  }, [session.group.name, unseen]);

  async function pick(file: File | undefined) {
    setUploadError(null);
    if (file === undefined) return;
    setPending(await prepare(file));
  }

  /**
   * The thumbnail, made and unmade with what it shows.
   *
   * An object URL is a handle the browser holds until it is revoked, so every
   * one has to be given back — a dad who changes his mind four times should
   * not be leaking four photographs' worth of memory into his phone.
   */
  useEffect(() => {
    if (pending === null || !pending.blob.type.startsWith('image/')) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(pending.blob);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [pending]);

  /**
   * A photo the dad already has in his hand: pasted from a screenshot, or
   * dragged onto the room. The picker still exists for a phone; this is for
   * the laptop, where hunting through a file dialog for something already on
   * the clipboard is the long way round.
   */
  function dropped(event: React.DragEvent) {
    event.preventDefault();
    void pick(event.dataTransfer.files[0]);
  }

  function pasted(event: React.ClipboardEvent) {
    const file = event.clipboardData.files[0];
    if (file === undefined) return;
    event.preventDefault();
    void pick(file);
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

  const waiting = (todo.prompt && room.rooms.questions) || (todo.board && room.rooms.week);
  const soon = nightSoon(t, lang, room.night, now);
  const days = {
    today: t('day.today'),
    yesterday: t('day.yesterday'),
    locale: lang === 'fr' ? 'fr-CA' : 'en-CA',
  };

  return (
    <main
      className="room"
      data-table={tableOpen ? 'open' : 'closed'}
      onDragOver={(e) => e.preventDefault()}
      onDrop={dropped}
    >
      <header className="room-head border-b border-line pb-2.5">
        <div>
          <h1>{session.group.name}</h1>
          {/* The count is also the door to the roster and to who has been
              about. A button, because it does something — but not a blue
              underlined link, which is three times louder than a group of five
              men needs its own head-count to be. */}
          <p className="quiet" onClick={() => setSheet('here')}>
            <button type="button" className="count-in" data-testid="connection">
              {room.connection === 'open'
                ? t('room.here', { n: room.roster.length })
                : room.connection === 'connecting'
                  ? t('room.opening')
                  : t('room.reconnecting')}
            </button>
            {soon === null ? null : ` · ${soon}`}
          </p>
        </div>
        <span className="head-actions">
          <JoinCall state={call.state} onJoin={() => void call.join()} />
          <Button size="sm" onClick={() => setSheet('menu')} className="relative">
            <MenuIcon size={16} aria-hidden="true" />
            {t('room.menu')}
            {waiting ? (
              <span
                className="absolute top-1 right-1 h-2 w-2 rounded-full bg-accent"
                data-testid="mark-menu"
                aria-hidden="true"
              />
            ) : null}
            {waiting ? <span className="sr-only">{t('room.waiting')}</span> : null}
          </Button>
        </span>
      </header>

      <div className="stage">
        <div className="col-talk">
          <CallBar
            state={call.state}
            peers={call.peers}
            muted={call.muted}
            camera={call.camera}
            speakingYou={call.speakingYou}
            localStream={call.localStream.current}
            onLeave={call.leave}
            onToggleMute={call.toggleMute}
            onToggleCamera={() => void call.toggleCamera()}
          />

          <ol
            className="lines"
            aria-label={t('room.messages')}
            ref={lines}
            onScroll={() => setPinned(atBottom())}
          >
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
                        {parts(row.message.body).map((part, i) =>
                          part.link ? (
                            <a
                              key={i}
                              href={part.href}
                              target="_blank"
                              rel="noopener noreferrer nofollow"
                            >
                              {part.text}
                            </a>
                          ) : (
                            <span key={i}>{part.text}</span>
                          ),
                        )}
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

          {!pinned && unseen > 0 ? (
            <Button
              look="primary"
              size="sm"
              className="mx-auto rounded-full"
              onClick={toBottom}
              data-testid="to-bottom"
            >
              <ArrowDown size={14} aria-hidden="true" />
              {t(`room.unseen_${plural(lang, unseen)}`, { n: unseen })}
            </Button>
          ) : null}

          <p className="min-h-[1.2em] text-xs text-muted" aria-live="polite">
            {typingNames.length > 0 ? t('room.typing', { names: typingNames.join(', ') }) : ' '}
          </p>

          <form
            className="composer rounded-xl border border-line bg-panel p-1.5 shadow-sm"
            onSubmit={submit}
            onPaste={pasted}
          >
            {pending !== null ? (
              <p className="pending" data-testid="pending-media">
                {preview === null ? null : <img src={preview} alt="" />}
                <span className="pending-what">
                  {pending.name} <span className="quiet">{readableSize(pending.blob.size)}</span>
                </span>
                <Button
                  look="danger"
                  size="iconSm"
                  className="rounded-full"
                  aria-label={t('composer.remove')}
                  onClick={() => {
                    setPending(null);
                    if (picker.current !== null) picker.current.value = '';
                  }}
                >
                  <X size={14} aria-hidden="true" />
                  <span className="sr-only">{t('composer.remove')}</span>
                </Button>
              </p>
            ) : null}

            {uploadError !== null ? (
              <p className="error" role="alert">
                {uploadError}
              </p>
            ) : null}

            <label
              htmlFor="attach"
              className={cn(
                'grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-app',
                'border border-edge text-muted transition-colors duration-75',
                'hover:border-accent hover:text-accent',
                'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent',
              )}
            >
              <Plus size={18} aria-hidden="true" />
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
              className="min-w-0 rounded-lg border-0 bg-transparent px-2 text-[0.9375rem] text-ink placeholder:text-muted/70 focus:outline-none"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                room.sendTyping();
              }}
              placeholder={pending === null ? t('composer.say') : t('composer.caption')}
              autoComplete="off"
              disabled={room.connection !== 'open'}
            />
            <Button
              type="submit"
              look="primary"
              size="icon"
              aria-label={t('composer.send')}
              disabled={
                room.connection !== 'open' || sending || (!draft.trim() && pending === null)
              }
            >
              <SendHorizontal size={18} aria-hidden="true" />
              <span className="sr-only">
                {sending ? t('composer.sending') : t('composer.send')}
              </span>
            </Button>
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
            {room.rooms.questions ? (
              <Button block onClick={() => setSheet('prompts')}>
                <MessageCircleQuestion size={17} aria-hidden="true" className="text-muted" />
                {t('menu.questions')}
                {todo.prompt ? (
                  <span
                    className="ml-auto h-2 w-2 rounded-full bg-accent"
                    data-testid="mark-prompts"
                    aria-hidden="true"
                  />
                ) : null}
                {todo.prompt ? <span className="sr-only">{t('room.waiting')}</span> : null}
              </Button>
            ) : null}

            {room.rooms.week ? (
              <Button block onClick={() => setSheet('board')}>
                <CalendarCheck size={17} aria-hidden="true" className="text-muted" />
                {t('menu.week')}
                {todo.board ? (
                  <span
                    className="ml-auto h-2 w-2 rounded-full bg-accent"
                    data-testid="mark-board"
                    aria-hidden="true"
                  />
                ) : null}
                {todo.board ? <span className="sr-only">{t('room.waiting')}</span> : null}
              </Button>
            ) : null}

            {room.rooms.table ? (
              <Button
                block
                onClick={() => {
                  setTableOpen((v) => !v);
                  setSheet(null);
                }}
              >
                <Spade size={17} aria-hidden="true" className="text-muted" />
                {tableOpen ? t('menu.close_table') : t('menu.open_table')}
              </Button>
            ) : null}

            <Button block data-testid="dad-night" onClick={() => setSheet('settings')}>
              <SettingsIcon size={17} aria-hidden="true" className="text-muted" />
              {t('menu.settings')}
            </Button>

            <Button block look="quiet" onClick={onSignOut} className="justify-start px-3.5">
              <LogOut size={17} aria-hidden="true" />
              {t('menu.sign_out')}
            </Button>
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

      {sheet === 'settings' ? (
        <Sheet title={t('set.title')} onClose={() => setSheet(null)}>
          <Settings night={room.night} rooms={room.rooms} />
        </Sheet>
      ) : null}
    </main>
  );
}
