import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { fetchTodo, type Session, type Todo } from './api';
import { Attachment } from './Attachment';
import { Board } from './Board';
import { CallBar, JoinCall } from './CallBar';
import { Here } from './Here';
import { Invite } from './Invite';
import { Night } from './Night';
import {
  ArrowDown,
  CalendarCheck,
  CalendarClock,
  ChevronLeft,
  Menu as MenuIcon,
  MessageCircleQuestion,
  Mic,
  Plus,
  SendHorizontal,
  Send,
  Square,
  Settings as SettingsIcon,
  Spade,
  X,
} from 'lucide-react';
import { plural, useT } from './i18n';
import { Button } from './ui/Button';
import { cn } from './ui/cn';
import { parts, shortLink } from '../shared/linkify';
import { describeSaid } from '../shared/said';
import { nightItem, nightSoon } from './NightEditor';
import { isImage, prepare, readableSize, upload, type Prepared } from './media';
import { canRecord, clockOf, useRecorder } from './recorder';
import { lastSeen, markSeen } from './seen';
import { Face } from './Face';
import { Home } from './Home';
import { Marks, marksOf } from './Marks';
import { Viewer } from './Viewer';
import { LineMenu } from './ui/LineMenu';
import { useFreshBuild } from './useFreshBuild';
import { useVisualViewport } from './useVisualViewport';
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
/** Hidden for longer than this and coming back counts as coming back. */
const AWAY_MS = 30 * 60_000;

/** What is open over the room, if anything. */
type Sheets = 'menu' | 'here' | 'prompts' | 'board' | 'night' | 'invite' | 'settings';

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
  /**
   * Home or the conversation.
   *
   * The app opens on home: when the night is, who is about and what is
   * waiting are the questions a dad has before he has read a word, and they
   * used to be a countdown that appeared inside 24 hours plus three items
   * behind a menu. Going in is one tap and the tap says how many lines are
   * waiting, so the man who only came to talk loses a second.
   *
   * A VIEW and not a route: the socket, the call and the table all live above
   * it, so switching costs nothing and a game in progress is untouched.
   */
  const [view, setView] = useState<'home' | 'talk'>('home');
  /** The photo he is looking at full-screen, by media id. */
  const [viewing, setViewing] = useState<string | null>(null);
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
  /**
   * The newest line he has actually looked at, on this device.
   *
   * Null until the first backfill lands, which is a dad who has never opened
   * this room here. Everything about "how many are new" is derived from this
   * rather than tallied as lines arrive — see the effects below for why.
   */
  const [seenSeq, setSeenSeq] = useState<number | null>(() => lastSeen(session.group.id));
  /** The last line he saw before this sitting, or null on a first visit. */
  const [since, setSince] = useState<number | null>(() => lastSeen(session.group.id));
  const recorder = useRecorder();
  const picker = useRef<HTMLInputElement>(null);
  const say = useRef<HTMLInputElement>(null);
  const bottom = useRef<HTMLLIElement>(null);
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

  /**
   * How many lines he has not looked at — DERIVED, never accumulated.
   *
   * Counted against the mark rather than tallied as frames arrive, so a
   * reload, a reconnect and a backfill all agree with each other. The
   * accumulator this replaced began every load at nought, which is why
   * opening the app announced the whole evening again.
   */
  const unseen =
    seenSeq === null ? 0 : room.messages.reduce((n, m) => (m.seq > seenSeq ? n + 1 : n), 0);

  /**
   * The newest line that could change who is coming, or what is up for the
   * night. Home re-reads the night when this moves, and not when anything
   * else does: an evening of talk is not a reason to fetch it thirty times.
   */
  const nightPulse = room.messages.reduce(
    (seq, m) => (m.said?.k === 'rsvp' || m.said?.k === 'item_added' ? m.seq : seq),
    0,
  );

  /**
   * The newest line that could change what is waiting for him.
   *
   * Same reasoning as the pulse above, and the same reason: this was keyed on
   * the newest line of ANY kind, so five dads talking through an evening each
   * spent a round trip per line asking a question whose answer only moves
   * when somebody files an answer, a check-in, a promise or its outcome.
   */
  const todoPulse = room.messages.reduce(
    (seq, m) =>
      m.kind === 'prompt' ||
      m.said?.k === 'check_in' ||
      m.said?.k === 'commitment' ||
      m.said?.k === 'outcome'
        ? m.seq
        : seq,
    0,
  );

  /** The conversation is genuinely on the screen — not home, not the table. */
  const watching = view === 'talk' && !tableOpen;
  const pinnedNow = useRef(pinned);
  pinnedNow.current = pinned;
  useEffect(refreshTodo, [refreshTodo, todoPulse]);

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
    counted.current = count;
    if (watching && pinned) bottom.current?.scrollIntoView({ block: 'end' });
  }, [room.messages.length, watching, pinned]);

  /**
   * Going in is reading it, and so is scrolling to the newest line.
   *
   * Advancing the mark rather than zeroing a tally, because the tally was the
   * bug: it began each load at nought and every backfilled line incremented
   * it, so a dad who opened the app on a conversation he had already read was
   * told there were forty-one new ones. What he has seen is a property of him
   * and this device, it survives the tab, and the count is derived from it.
   */
  useEffect(() => {
    if (!watching || !pinned || document.hidden) return;
    if (lastSeq <= 0 || (seenSeq !== null && lastSeq <= seenSeq)) return;
    setSeenSeq(lastSeq);
    markSeen(session.group.id, lastSeq);
  }, [watching, pinned, lastSeq, seenSeq, session.group.id]);

  // A dad who has never opened this room on this device has nothing to catch
  // up on: the archive is not a backlog. The mark starts at the newest line
  // he was handed rather than at nothing.
  useEffect(() => {
    if (seenSeq === null && lastSeq > 0) {
      setSeenSeq(lastSeq);
      markSeen(session.group.id, lastSeq);
    }
  }, [seenSeq, lastSeq, session.group.id]);

  /** Straight to the bottom, and everything down to there is read. */
  useEffect(() => {
    if (view !== 'talk' || !pinnedNow.current) return;
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [view]);

  /** A dad who has scrolled up, or looked away, has not seen it. */
  const atBottom = useCallback(() => {
    const el = lines.current;
    if (el === null) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
  }, []);

  // Reaching the newest line is reading everything down to it — but that is
  // the mark-advancing effect's job, which fires as soon as `pinned` flips.
  const toBottom = useCallback(() => {
    bottom.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
    setPinned(true);
  }, []);

  // The keyboard coming up takes a third of the list. If he was reading the
  // newest line, he still is.
  const keepBottom = useCallback(() => {
    if (pinned) bottom.current?.scrollIntoView({ block: 'end' });
  }, [pinned]);
  useVisualViewport(keepBottom);

  // Coming back to the tab is seeing it. Coming back after long enough is
  // coming back: the last line he saw becomes the boundary, and the divider
  // below points at everything since.
  const hiddenAt = useRef<number | null>(null);
  useEffect(() => {
    function seen() {
      if (document.hidden) {
        hiddenAt.current = Date.now();
        return;
      }
      const away = hiddenAt.current !== null && Date.now() - hiddenAt.current > AWAY_MS;
      hiddenAt.current = null;
      // Coming back is reading it; the mark-advancing effect picks it up on
      // the next render, because the tab is no longer hidden.
      if (away) setSince(lastSeen(session.group.id));
      else if (atBottom()) setPinned(true);
    }
    document.addEventListener('visibilitychange', seen);
    return () => document.removeEventListener('visibilitychange', seen);
  }, [atBottom, session.group.id]);

  // Looking at the newest line, with the tab showing, is having seen it.
  useEffect(() => {
    if (pinned && unseen === 0 && !document.hidden && lastSeq > 0) {
      markSeen(session.group.id, lastSeq);
    }
  }, [pinned, unseen, lastSeq, session.group.id]);

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
      room.send(body);
      setDraft('');
      // The keyboard stays up: he said one thing, he is probably saying
      // another. Blurring here would drop it after every line on a phone.
      say.current?.focus();
      return;
    }

    setSending(true);
    setUploadError(null);
    // try/finally, because `upload` does not always return: fetch REJECTS on
    // a network failure rather than answering, which is the wifi-to-LTE hop
    // this whole app is built around. Without it `sending` stayed true, and
    // `sending` disables the Send button, the microphone and the file picker
    // alike — a dad left with a composer he could not use and nothing on the
    // screen saying why, until he reloaded.
    let result: Awaited<ReturnType<typeof upload>>;
    try {
      result = await upload(pending);
    } catch {
      result = { ok: false, error: 'unknown' };
    } finally {
      setSending(false);
    }

    if (!result.ok) {
      setUploadError(
        result.error === 'too_large' ? t('composer.too_large') : t('composer.upload_failed'),
      );
      return;
    }
    room.send(body, result.media.id);
    setDraft('');
    setPending(null);
    if (picker.current !== null) picker.current.value = '';
    say.current?.focus();
  }

  /**
   * The thing he just said, straight into the room.
   *
   * No caption and no preview: a voice note that has to be confirmed is one
   * more step between a man with a child on his hip and the thing he wanted
   * to say, which is the entire reason this exists.
   */
  async function sendVoice() {
    const spoken = await recorder.stop();
    if (spoken === null) return;
    setSending(true);
    setUploadError(null);
    let result: Awaited<ReturnType<typeof upload>>;
    try {
      result = await upload(spoken);
    } catch {
      result = { ok: false, error: 'unknown' };
    } finally {
      setSending(false);
    }
    if (!result.ok) {
      setUploadError(
        result.error === 'too_large' ? t('composer.too_large') : t('composer.upload_failed'),
      );
      return;
    }
    room.send('', result.media.id);
  }

  const recording = recorder.state.kind === 'recording' || recorder.state.kind === 'asking';

  // A new build waits for his hands to be free: a line half typed, a voice
  // note going, a photo chosen, a call in progress — none of these survive a
  // reload, and none of them is worth losing for one.
  useFreshBuild(
    draft.trim() !== '' ||
      pending !== null ||
      sending ||
      recording ||
      call.state === 'joining' ||
      call.state === 'in',
  );

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
  /** A member id as a name, for the marks. The roster is five people long. */
  const nameOf = useCallback(
    (memberId: string) =>
      room.roster.find((m) => m.memberId === memberId)?.name ?? t('line.someone'),
    [room.roster, t],
  );

  /**
   * The version of a dad's face, for the conversation.
   *
   * From `members` rather than the roster: a line said on Tuesday by a man
   * who is not here tonight still has his face beside it. Undefined for a dad
   * with no face, and `Face` falls back to his initials.
   */
  const faceOf = useCallback(
    (memberId: string | null) =>
      memberId === null ? undefined : room.members.find((m) => m.memberId === memberId)?.face,
    [room.members],
  );

  /**
   * Every photograph in the conversation, oldest first.
   *
   * From what is already on the screen rather than from a fetch: these are
   * the ones he is looking at, and moving between them should not depend on
   * the network. Images only — a clip has the browser's own player and its
   * own full screen, and a voice note is not something to look at.
   */
  const shots = room.messages
    .filter((m) => m.media != null && isImage(m.media.contentType))
    .map((m) => ({ media: m.media!, name: m.name, at: m.createdAt }));
  const viewingAt = shots.findIndex((s) => s.media.id === viewing);

  const rows = toRows(
    room.messages,
    Date.now(),
    days,
    since === null ? null : { seq: since, label: t('room.since') },
  );
  const hasNew = rows.some((r) => r.kind === 'new');

  /**
   * Land him on the divider, not the bottom.
   *
   * Once per boundary: the first time the list holds the divider after a
   * cold open or a return from away, the list scrolls to it and the count
   * says how many are below. From there he reads down like anyone else, and
   * the arrival effect above goes back to following him.
   */
  const newMark = useRef<HTMLLIElement>(null);
  const landedOn = useRef<number | null>(null);
  useEffect(() => {
    // Not while he is on home: the stage is display:none there, so the scroll
    // goes nowhere — but the guard below would still be spent and `pinned`
    // still turned off, and he would then walk into the conversation at the
    // OLDEST line of the backfill with nothing left to correct it.
    if (view !== 'talk') return;
    if (since === null || !hasNew || landedOn.current === since) return;
    landedOn.current = since;
    newMark.current?.scrollIntoView({ block: 'start' });
    // Not pinned: he is reading from the boundary, not from the bottom, so
    // what is below it stays counted until he gets there.
    setPinned(false);
  }, [view, since, hasNew]);

  return (
    <main
      className="room"
      data-view={view}
      data-table={tableOpen ? 'open' : 'closed'}
      onDragOver={(e) => e.preventDefault()}
      onDrop={dropped}
    >
      <header className="room-head border-b border-line pb-2.5">
        {/* A real back button, first in the bar, the way every app on a phone
            does it. It was the group's name with a chevron, which is the
            convention on a desktop and something nobody finds on a phone. */}
        {view === 'talk' ? (
          <Button
            size="icon"
            look="quiet"
            className="-ml-1 shrink-0"
            onClick={() => setView('home')}
            aria-label={t('home.title')}
            data-testid="go-home"
          >
            <ChevronLeft size={20} aria-hidden="true" />
            <span className="sr-only">{t('home.title')}</span>
          </Button>
        ) : null}

        <div className="min-w-0">
          <h1 className="display truncate text-base text-muted">{session.group.name}</h1>
          {/* The count is also the door to the roster and to who has been
              about. A button, because it does something — but not a blue
              underlined link, which is three times louder than a group of five
              men needs its own head-count to be. */}
          <p className="text-[0.9375rem] text-ink">
            <button
              type="button"
              className="count-in"
              data-testid="connection"
              onClick={() => setSheet('here')}
            >
              {room.connection === 'open'
                ? t('room.here', { n: room.roster.length })
                : room.connection === 'connecting'
                  ? t('room.opening')
                  : t('room.reconnecting')}
            </button>
            {/* Not on home, where the night is the first thing on the screen
                and four times the size. A header that repeats what is an inch
                below it is the app saying something twice. */}
            {soon === null || view === 'home' ? null : (
              <span className="max-[30rem]:block max-[30rem]:pt-0.5">
                <span className="max-[30rem]:hidden"> · </span>
                <button
                  type="button"
                  className="count-in max-[30rem]:block max-[30rem]:text-left"
                  data-testid="night-soon"
                  onClick={() => setSheet('night')}
                >
                  {soon}
                </button>
              </span>
            )}
          </p>
        </div>
        <span className="head-actions">
          <JoinCall state={call.state} onJoin={() => void call.join()} />
          <Button
            size="sm"
            onClick={() => setSheet('menu')}
            aria-label={t('room.menu')}
            // A thumb's square on a phone: this and the call are the two
            // things pressed most, and they sit under the notch.
            className="relative max-[48rem]:h-10 max-[48rem]:w-10 max-[48rem]:px-0"
          >
            <MenuIcon size={16} aria-hidden="true" />
            <span className="max-[48rem]:sr-only">{t('room.menu')}</span>
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

      {/* Home sits BESIDE the stage rather than in place of it, and the stage
          is hidden with CSS: taking it out of the tree would unmount the
          table's iframe and restart a game in progress, which is the same
          reason the table has never been unmounted either. */}
      <Home
        night={room.night}
        answered={nightPulse}
        you={session.member.id}
        roster={room.roster}
        members={room.members}
        unseen={unseen}
        todo={todo}
        rooms={room.rooms}
        onGo={() => setView('talk')}
        onWho={() => setSheet('here')}
        onNight={() => setSheet('night')}
        onPrompts={() => setSheet('prompts')}
        onBoard={() => setSheet('board')}
      />

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
            onWho={() => setSheet('here')}
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
            {rows.map((row) =>
              row.kind === 'day' ? (
                <li key={`day-${row.key}`} className="day" data-testid="day">
                  <span>{row.label}</span>
                </li>
              ) : row.kind === 'new' ? (
                <li key="new" ref={newMark} className="day day-new" data-testid="since">
                  <span>{row.label}</span>
                </li>
              ) : row.message.kind === 'chat' || row.message.kind === 'prompt' ? (
                // Only what a dad typed gets a menu: the room's own lines are
                // facts about the evening, not quotes, and nobody's to take
                // back. Yours also carries the way to take it back.
                <LineMenu
                  key={row.key}
                  body={row.message.body}
                  mine={marksOf(row.message, session.member.id)}
                  onReact={(emoji, on) => room.react(row.message.id, emoji, on, session.member.id)}
                  onRetract={
                    row.message.memberId === session.member.id
                      ? () => room.retract(row.message.id)
                      : undefined
                  }
                >
                  <li
                    className={`line line-${row.message.kind}${
                      row.showName ? '' : ' is-continued'
                    }`}
                    data-testid="line"
                  >
                    {/* Only at the top of a run. A face on every line of one
                        turn is the app repeating who is talking between every
                        sentence, which is what dropping the name fixed. */}
                    {row.showName && row.message.memberId !== null ? (
                      <Face
                        className="face"
                        memberId={row.message.memberId}
                        name={row.message.name}
                        version={faceOf(row.message.memberId)}
                        size={32}
                      />
                    ) : null}
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
                            title={part.href}
                            target="_blank"
                            rel="noopener noreferrer nofollow"
                          >
                            {shortLink(part.text)}
                          </a>
                        ) : (
                          <span key={i}>{part.text}</span>
                        ),
                      )}
                      {row.message.media ? (
                        <Attachment
                          media={row.message.media}
                          onOpen={() => setViewing(row.message.media!.id)}
                        />
                      ) : null}
                      <Marks
                        reactions={row.message.reactions}
                        me={session.member.id}
                        nameOf={nameOf}
                        onToggle={(emoji, on) =>
                          room.react(row.message.id, emoji, on, session.member.id)
                        }
                      />
                    </span>
                    <time className="when">{clock(row.message.createdAt)}</time>
                  </li>
                </LineMenu>
              ) : (
                // The room talking. It carries what happened, not a sentence,
                // so it can be read in either language — and falls back to
                // the English body for a line written before that was true.
                <li
                  key={row.key}
                  className={`line line-${row.message.kind}${row.joined ? ' is-joined' : ''}`}
                  data-testid="line"
                >
                  <span className="body">
                    {row.message.said
                      ? describeSaid(t, lang, row.message.said, row.joined)
                      : row.message.body}
                  </span>
                </li>
              ),
            )}
            {/* The scroll target, and nothing else: an item so the list is
                still a list to a screen reader, hidden so it is not counted. */}
            <li ref={bottom} aria-hidden="true" className="m-0 h-0 p-0" />
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
            {room.waiting > 0
              ? t(`room.waiting_${plural(lang, room.waiting)}`, { n: room.waiting })
              : typingNames.length > 0
                ? t('room.typing', { names: typingNames.join(', ') })
                : ' '}
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

            {uploadError !== null || recorder.state.kind === 'denied' ? (
              <p className="error" role="alert">
                {uploadError ?? t('composer.mic_denied')}
              </p>
            ) : null}

            {/* Recording takes the whole row: a red dot, how long he has been
                talking, and the two things he can do about it. Nothing else on
                the row can be pressed by accident while he is speaking. */}
            {recording ? (
              <>
                <span
                  className="flex min-w-0 flex-1 items-center gap-2 px-1 text-[0.9375rem]"
                  aria-live="polite"
                  data-testid="recording"
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full bg-danger"
                    aria-hidden="true"
                  />
                  <span className="tabular-nums">
                    {recorder.state.kind === 'recording' ? clockOf(recorder.state.ms) : '0:00'}
                  </span>
                  <span className="truncate text-muted">{t('composer.recording')}</span>
                </span>
                <Button
                  look="danger"
                  size="icon"
                  className="h-11 w-11"
                  aria-label={t('composer.cancel')}
                  onClick={recorder.cancel}
                >
                  <X size={18} aria-hidden="true" />
                  <span className="sr-only">{t('composer.cancel')}</span>
                </Button>
                <Button
                  look="primary"
                  size="icon"
                  className="h-11 w-11"
                  aria-label={t('composer.send')}
                  disabled={sending}
                  onClick={() => void sendVoice()}
                >
                  <Square size={16} aria-hidden="true" />
                  <span className="sr-only">{t('composer.send')}</span>
                </Button>
              </>
            ) : (
              <>
                <label
                  htmlFor="attach"
                  className={cn(
                    'grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-app',
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
                  ref={say}
                  id="say"
                  // 16px: anything smaller and iOS zooms the page in when he
                  // taps the field, and does not zoom it back out.
                  className="h-11 min-w-0 rounded-lg border-0 bg-transparent px-2 text-base text-ink placeholder:text-muted/70 focus:outline-none"
                  value={draft}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    room.sendTyping();
                  }}
                  placeholder={pending === null ? t('composer.say') : t('composer.caption')}
                  autoComplete="off"
                  autoCapitalize="sentences"
                  // The keyboard's own return key says what it does here.
                  enterKeyHint="send"
                />
                {/* One or the other, never both: with nothing typed the room is
                asking him to speak, and the moment he types a letter it is
                asking him to send. Four controls on a phone row is three. */}
                {draft.trim() === '' && pending === null && canRecord() ? (
                  <Button
                    look="plain"
                    size="icon"
                    className="h-11 w-11"
                    aria-label={t('composer.record')}
                    disabled={sending}
                    onClick={() => void recorder.start()}
                    data-testid="record"
                  >
                    <Mic size={18} aria-hidden="true" />
                    <span className="sr-only">{t('composer.record')}</span>
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    look="primary"
                    size="icon"
                    className="h-11 w-11"
                    aria-label={t('composer.send')}
                    disabled={sending || (!draft.trim() && pending === null)}
                    // Pressing Send must not take focus off the field: on a
                    // phone that is the keyboard folding away after every
                    // line, and on iOS it is the composer jumping too.
                    onMouseDown={(e) => e.preventDefault()}
                  >
                    <SendHorizontal size={18} aria-hidden="true" />
                    <span className="sr-only">
                      {sending ? t('composer.sending') : t('composer.send')}
                    </span>
                  </Button>
                )}
              </>
            )}
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
                {/* The reason, in words, where a dot used to be: a mark says
                    "something", and something is what makes a man ignore it. */}
                {todo.prompt ? (
                  <span
                    className="ml-auto text-sm font-normal text-accent"
                    data-testid="mark-prompts"
                  >
                    {t('menu.prompt_waiting')}
                  </span>
                ) : null}
              </Button>
            ) : null}

            {room.rooms.week ? (
              <Button block onClick={() => setSheet('board')}>
                <CalendarCheck size={17} aria-hidden="true" className="text-muted" />
                {t('menu.week')}
                {todo.board ? (
                  <span
                    className="ml-auto text-sm font-normal text-accent"
                    data-testid="mark-board"
                  >
                    {t('menu.board_waiting')}
                  </span>
                ) : null}
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

            <Button block data-testid="dad-night" onClick={() => setSheet('night')}>
              <CalendarClock size={17} aria-hidden="true" className="text-muted" />
              {nightItem(t, lang, room.night, now)}
            </Button>

            {/* Second from the bottom, not first: the room is for the dads
                who are already in it. But it is in the menu at all because
                everything else in this app is worth nothing until the other
                four are here. */}
            <Button block onClick={() => setSheet('invite')}>
              <Send size={17} aria-hidden="true" className="text-muted" />
              {t('menu.invite')}
            </Button>

            <Button block onClick={() => setSheet('settings')}>
              <SettingsIcon size={17} aria-hidden="true" className="text-muted" />
              {t('menu.settings')}
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
              face: m.face,
              you: m.memberId === session.member.id,
            }))}
            call={room.call}
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
          <Night night={room.night} you={session.member.id} />
        </Sheet>
      ) : null}

      {sheet === 'invite' ? (
        <Sheet title={t('inv.title')} onClose={() => setSheet(null)}>
          <Invite />
        </Sheet>
      ) : null}

      {sheet === 'settings' ? (
        <Sheet title={t('set.title')} onClose={() => setSheet(null)}>
          <Settings
            rooms={room.rooms}
            // From the roster rather than the session: the session was
            // written at the door and does not know about a face set since.
            you={{
              memberId: session.member.id,
              name: room.you?.name ?? session.member.displayName,
              face: room.roster.find((m) => m.memberId === session.member.id)?.face,
            }}
            onSignOut={onSignOut}
          />
        </Sheet>
      ) : null}

      <Viewer
        shots={shots}
        at={viewingAt}
        onMove={(next) => setViewing(shots[next]?.media.id ?? null)}
        onClose={() => setViewing(null)}
      />
    </main>
  );
}
