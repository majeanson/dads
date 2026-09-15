import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchTodo, keepMedia, type Session, type Todo } from './api';
import { ArrowDown } from 'lucide-react';
import { CallBar } from './CallBar';
import { Composer, type ComposerHandle } from './Composer';
import { Home } from './Home';
import { Lines } from './Lines';
import { RoomHeader } from './RoomHeader';
import { Sheets, type SheetName } from './Sheets';
import { TableColumn } from './TableColumn';
import { Viewer } from './Viewer';
import { plural, useT } from './i18n';
import { Button } from './ui/Button';
import { nightSoon } from './NightEditor';
import { isImage } from './media';
import { toRows } from './messageGroups';
import { useCall } from './useCall';
import { useFreshBuild } from './useFreshBuild';
import { useRoom } from './useRoom';
import { useSeen } from './useSeen';

/** Coarse enough to be free, fine enough that a countdown stays honest. */
const TICK_MS = 15_000;

/** Long enough to read twice, short enough that it is gone by the next line. */
const NOTE_MS = 6000;

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
 *
 * What is left in this file is the wiring: which view is showing, what is open
 * over it, and the seams between the socket, the call and the table. The
 * header, the list, the composer and the sheets are their own files, and what
 * he has read is `useSeen`.
 */
export function Room({ session, onSignOut }: { session: Session; onSignOut: () => void }) {
  const { t, lang } = useT();
  const room = useRoom(true, session.group.dadNight, session.group.rooms);
  const [sheet, setSheet] = useState<SheetName | null>(null);
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
  const [todo, setTodo] = useState<Todo>({ prompt: false, board: false });
  const [now, setNow] = useState(() => Date.now());
  /**
   * The room's one line of status, above the composer.
   *
   * The same idea as the table's `table-note`: somewhere for the rare thing
   * that has to be said and is not worth a dialog. It clears itself, because
   * a notice a dad has to dismiss is a notice that outstays what it was about.
   */
  const [note, setNote] = useState<string | null>(null);
  const composer = useRef<ComposerHandle>(null);
  /** Whether the composer is holding something. Written by it during render. */
  const composing = useRef(false);
  const bottom = useRef<HTMLLIElement>(null);
  const lines = useRef<HTMLOListElement>(null);
  const newMark = useRef<HTMLLIElement>(null);

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

  /** The conversation is genuinely on the screen — not home, not the table. */
  const watching = view === 'talk' && !tableOpen;
  const seen = useSeen({
    groupId: session.group.id,
    groupName: session.group.name,
    messages: room.messages,
    view,
    watching,
    bottom,
    lines,
  });

  const refreshTodo = useCallback(() => {
    fetchTodo()
      .then(setTodo)
      .catch(() => {
        // No mark is better than a wrong one.
      });
  }, []);

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

  useEffect(refreshTodo, [refreshTodo, todoPulse]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (note === null) return;
    const timer = setTimeout(() => setNote(null), NOTE_MS);
    return () => clearTimeout(timer);
  }, [note]);

  // A new build waits for his hands to be free: a line half typed, a voice
  // note going, a photo chosen, a call in progress — none of these survive a
  // reload, and none of them is worth losing for one.
  useFreshBuild(() => composing.current || call.state === 'joining' || call.state === 'in');

  /**
   * Taking a picture off the shelf, or putting it back on.
   *
   * NOT optimistic, and that is the same rule as taking a line back: a mark
   * that fails costs nothing and the next frame corrects it, but a dad who
   * believes a photograph of his child is safe when the keep never left the
   * phone has been told a lie by the app. The pin appears when the ROOM says
   * it is kept — the `kept` frame — and a refusal says so here.
   */
  const keep = useCallback(
    (mediaId: string, on: boolean) => {
      void keepMedia(mediaId, on).then((outcome) => {
        if (outcome === 'full') setNote(t('line.keep_full'));
        else if (outcome === 'failed') setNote(t('line.keep_failed'));
      });
    },
    [t],
  );

  const typingNames = [...room.typing.entries()]
    .filter(([id]) => id !== session.member.id)
    .map(([, name]) => name);

  const waiting = (todo.prompt && room.rooms.questions) || (todo.board && room.rooms.week);
  const soon = nightSoon(t, lang, room.night, now);

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
    {
      today: t('day.today'),
      yesterday: t('day.yesterday'),
      locale: lang === 'fr' ? 'fr-CA' : 'en-CA',
    },
    seen.since === null ? null : { seq: seen.since, label: t('room.since') },
  );
  const hasNew = rows.some((r) => r.kind === 'new');

  /**
   * Land him on the divider, not the bottom.
   *
   * Once per boundary: the first time the list holds the divider after a cold
   * open or a return from away, the list scrolls to it and the count says how
   * many are below. From there he reads down like anyone else, and the
   * arrival effect in `useSeen` goes back to following him.
   *
   * It lives here rather than in that hook because it is the one thing that
   * depends on what was RENDERED — whether `toRows` actually placed a
   * divider, which it declines to do at the very top of a list.
   */
  const landedOn = useRef<number | null>(null);
  const { since, unpin } = seen;
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
    unpin();
  }, [view, since, hasNew, unpin]);

  return (
    <main
      className="room"
      data-view={view}
      data-table={tableOpen ? 'open' : 'closed'}
      onDragOver={(e) => e.preventDefault()}
      // A photo the dad already has in his hand: dragged onto the room. The
      // picker still exists for a phone; this is for the laptop, where
      // hunting through a file dialog for something already on the screen is
      // the long way round. Pasting is the composer's own, because that is
      // where the caret is.
      onDrop={(e) => {
        e.preventDefault();
        composer.current?.offer(e.dataTransfer.files[0]);
      }}
    >
      <RoomHeader
        groupName={session.group.name}
        view={view}
        connection={room.connection}
        here={room.roster.length}
        soon={soon}
        callState={call.state}
        // On home as well, now that home says two things and nothing else.
        // It was hidden there while home listed the very items it stands for,
        // an inch below it; with those behind the Menu button, hiding the
        // mark on home would leave a dad no sign at all that a question is
        // waiting for him.
        waiting={waiting}
        onHome={() => setView('home')}
        onWho={() => setSheet('here')}
        onNight={() => setSheet('night')}
        onMenu={() => setSheet('menu')}
        onJoinCall={() => void call.join()}
      />

      {/* Home sits BESIDE the stage rather than in place of it, and the stage
          is hidden with CSS: taking it out of the tree would unmount the
          table's iframe and restart a game in progress, which is the same
          reason the table has never been unmounted either. */}
      <Home
        night={room.night}
        answered={nightPulse}
        you={session.member.id}
        unseen={seen.unseen}
        onGo={() => setView('talk')}
        onNight={() => setSheet('night')}
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

          <Lines
            rows={rows}
            empty={room.messages.length === 0}
            you={session.member.id}
            lines={lines}
            bottom={bottom}
            newMark={newMark}
            faceOf={faceOf}
            nameOf={nameOf}
            onReact={(id, emoji, on) => room.react(id, emoji, on, session.member.id)}
            onRetract={room.retract}
            onKeep={(media) => keep(media.id, !media.kept)}
            onOpenPhoto={setViewing}
            onScroll={seen.onScroll}
          />

          {!seen.pinned && seen.unseen > 0 ? (
            <Button
              look="primary"
              size="sm"
              className="mx-auto rounded-full"
              onClick={seen.toBottom}
              data-testid="to-bottom"
            >
              <ArrowDown size={14} aria-hidden="true" />
              {t(`room.unseen_${plural(lang, seen.unseen)}`, { n: seen.unseen })}
            </Button>
          ) : null}

          <p className="min-h-[1.2em] text-xs text-muted" aria-live="polite">
            {note ??
              (room.waiting > 0
                ? t(`room.waiting_${plural(lang, room.waiting)}`, { n: room.waiting })
                : typingNames.length > 0
                  ? t('room.typing', { names: typingNames.join(', ') })
                  : ' ')}
          </p>

          <Composer ref={composer} busy={composing} onSend={room.send} onTyping={room.sendTyping} />
        </div>

        {/* Always mounted: unmounting the iframe restarts a game in progress. */}
        <div className="col-table">
          <TableColumn onEvent={room.relayTableEvent} onClose={() => setTableOpen(false)} />
        </div>
      </div>

      <Sheets
        open={sheet}
        onOpen={setSheet}
        view={view}
        you={session.member.id}
        youName={room.you?.name ?? session.member.displayName}
        messages={room.messages}
        roster={room.roster}
        call={room.call}
        night={room.night}
        rooms={room.rooms}
        todo={todo}
        now={now}
        tableOpen={tableOpen}
        faceOf={faceOf}
        onToggleTable={() => setTableOpen((v) => !v)}
        onAnswerPrompt={room.answerPrompt}
        canAnswer={room.connection === 'open'}
        onTodoChanged={refreshTodo}
        onSignOut={onSignOut}
      />

      <Viewer
        shots={shots}
        at={viewingAt}
        onMove={(next) => setViewing(shots[next]?.media.id ?? null)}
        onClose={() => setViewing(null)}
      />
    </main>
  );
}
