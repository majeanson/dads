import { useCallback, useEffect, useRef, useState } from 'react';
import {
  addPick,
  fetchMyRooms,
  fetchTodo,
  keepMedia,
  leavingRoom,
  type Session,
  type Todo,
} from './api';
import type { PickCategory } from '../shared/pickCategories';
import type { RoomMessage } from '../shared/protocol';
import { ArrowDown } from 'lucide-react';
import { CallBar } from './CallBar';
import { Composer, type ComposerHandle } from './Composer';
import { Home } from './Home';
import { Lines } from './Lines';
import { RoomHeader } from './RoomHeader';
import { preloadSheets, Sheets, type SheetName } from './Sheets';
import { TableColumn } from './TableColumn';
import { Viewer } from './Viewer';
import { announce } from './announce';
import { plural, useT } from './i18n';
import { Button } from './ui/Button';
import { buzz } from './buzz';
import { Glasses } from './Logo';
import { MembersProvider } from './members';
import { Splash, wantsStill } from './Splash';
import { nightShort } from './NightEditor';
import { isImage } from './media';
import { jumpLook } from './jump';
import { toRows } from './messageGroups';
import { useBackCloses } from './useBackCloses';
import { useCall } from './useCall';
import { useFreshBuild } from './useFreshBuild';
import { useRoom } from './useRoom';
import { useSeen } from './useSeen';
import { lastView, rememberView } from './viewMemory';

/** Coarse enough to be free, fine enough that a countdown stays honest. */
const TICK_MS = 15_000;

/** Long enough to read twice, short enough that it is gone by the next line. */
const NOTE_MS = 6000;

/** How many arrivals the live log holds. A screen reader reads each once, as
 * it is added; the rest are there for a man who goes back to look. */
const HEARD = 5;

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
export function Room({
  session,
  onSignOut,
  onRemoved,
}: {
  session: Session;
  onSignOut: () => void;
  /** The room closed his socket for good: he is not in it any more. */
  onRemoved: () => void;
}) {
  const { t, lang } = useT();
  const room = useRoom(true, session.group.dadNight, session.group.rooms, session.group.createdBy);
  // Taken out of the room, or walked out of it on another of his phones: the
  // door, saying so. Walking out on THIS one is already going somewhere.
  useEffect(() => {
    if (room.removed && !leavingRoom()) onRemoved();
  }, [room.removed, onRemoved]);
  // Once home has painted, fetch every sheet's code in the background, so
  // opening one is instant and a deploy mid-evening cannot leave this page
  // asking for files that are gone.
  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((f: () => void) => window.setTimeout(f, 1500));
    idle(() => preloadSheets());
  }, []);
  const [sheet, setSheet] = useState<SheetName | null>(null);
  /** The dad whose profile "who is in it" opens on, when a name on a line
   * opened it. Null from the header: the roster. */
  const [profileOf, setProfileOf] = useState<string | null>(null);
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
   *
   * Closed in the conversation and reopened soon after, it opens there again
   * (`viewMemory`): home is the first thing a man hasn't seen, not a toll.
   */
  const [view, setView] = useState<'home' | 'talk'>(() => lastView(session.group.id));
  useEffect(() => {
    const groupId = session.group.id;
    rememberView(groupId, view);
    if (view !== 'talk') return;
    // The mark carries WHEN, so it has to be fresh at the moment he leaves,
    // not only at the moment he went in.
    const stamp = () => rememberView(groupId, 'talk');
    window.addEventListener('pagehide', stamp);
    document.addEventListener('visibilitychange', stamp);
    return () => {
      window.removeEventListener('pagehide', stamp);
      document.removeEventListener('visibilitychange', stamp);
    };
  }, [view, session.group.id]);
  /** The app opening through the glasses: once per load, never for a phone
   * that asked for less motion. */
  const [splash, setSplash] = useState(() => !wantsStill());
  const endSplash = useCallback(() => setSplash(false), []);
  /**
   * "Go and talk" plays the splash, quicker and through the other lens, with
   * the conversation inside. A COUNT of presses rather than a flag, and the
   * splash is keyed on it: every press is its own film, and its own switch.
   * As a flag, a second press inside the first film's ~850ms — in, back out,
   * in again — set `true` over `true`, which React ignores: no splash, no
   * switch, a dead button on home. The French e2e found it, faster on CI.
   */
  const [entering, setEntering] = useState(0);
  const endEntering = useCallback(() => setEntering(0), []);
  const toTalk = useCallback(() => setView('talk'), []);
  const goTalk = useCallback(() => {
    // The conversation takes home's place under the blue (onCovered), so it
    // is only ever seen through the lenses.
    if (wantsStill()) setView('talk');
    else setEntering((n) => n + 1);
  }, []);
  // Going back is just going back: the way in is the moment, the way out is
  // a man leaving a room, and an animation there was one he had to sit through.
  const goHome = useCallback(() => setView('home'), []);
  // The conversation is the first layer over home: the phone's back button
  // goes home from it (Marc, 2026-11-01), and a sheet or picture open over
  // it is taken first. Home is the base, and back from there leaves.
  useBackCloses(view === 'talk', goHome);
  /** The photo he is looking at full-screen, by media id. */
  const [viewing, setViewing] = useState<string | null>(null);
  /** The line he is answering, or the one he is changing — never both. */
  const [replyTo, setReplyTo] = useState<RoomMessage | null>(null);
  const [editing, setEditing] = useState<RoomMessage | null>(null);
  const [tableOpen, setTableOpen] = useState(false);
  /**
   * Whether the table has ever been opened on this load.
   *
   * The frame is mounted the first time it is asked for and never after taken
   * down — unmounting restarts a game. It used to be mounted for every dad the
   * moment he walked in, which kept a socket open to jaffre from every phone
   * in the room all evening: nobody's game, and the reason jaffre's reaper
   * never saw the room empty enough to collect.
   */
  const [tableEver, setTableEver] = useState(false);
  if (tableOpen && !tableEver) setTableEver(true);
  const [todo, setTodo] = useState<Todo>({ prompt: false, board: false });
  /**
   * How many rooms this phone is in.
   *
   * Asked once, at the door's other side: it changes when he joins or opens
   * another, and both of those reload the app anyway. One is the normal
   * answer, and one means the menu says nothing about rooms at all.
   */
  const [mine, setMine] = useState(1);
  const [now, setNow] = useState(() => Date.now());
  /**
   * The room's one line of status, above the composer.
   *
   * The same idea as the table's `table-note`: somewhere for the rare thing
   * that has to be said and is not worth a dialog. It clears itself, because
   * a notice a dad has to dismiss is a notice that outstays what it was about.
   */
  const [note, setNote] = useState<string | null>(null);
  /**
   * The newest lines that arrived, as a screen reader should hear them.
   *
   * A polite log, one child per arrival, so each is read once and none
   * interrupts him (2026-11-01, the pass Marc asked for on reading the room
   * without a thumb). Never the backfill and never his own (`Lines` decides
   * that); only while the conversation is on the screen.
   */
  const [heard, setHeard] = useState<{ n: number; text: string }[]>([]);
  const heardCount = useRef(0);
  const onArrived = useCallback(
    (message: RoomMessage) => {
      heardCount.current += 1;
      const n = heardCount.current;
      setHeard((was) => [...was, { n, text: announce(message, t) }].slice(-HEARD));
    },
    [t],
  );
  const composer = useRef<ComposerHandle>(null);
  /** Whether the composer is holding something. Written by it during render. */
  const composing = useRef(false);
  const bottom = useRef<HTMLLIElement>(null);
  const lines = useRef<HTMLOListElement>(null);
  const newMark = useRef<HTMLLIElement>(null);

  const call = useCall({
    you: room.you?.memberId ?? null,
    roomName: session.group.name,
    members: room.call,
    connection: room.connection,
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
    ready: room.connection === 'open',
    remote: room.seen,
    share: room.sendSeen,
    bottom,
    lines,
  });
  const jump = jumpLook(seen);

  useEffect(() => {
    fetchMyRooms()
      .then((rooms) => setMine(Math.max(1, rooms.length)))
      .catch(() => {
        // One is the safe answer: no row, and nothing lost.
      });
  }, []);

  const refreshTodo = useCallback(() => {
    fetchTodo()
      .then(setTodo)
      .catch(() => {
        // No mark is better than a wrong one.
      });
  }, []);

  /**
   * When to look again at who is coming, and at what is waiting for him.
   *
   * These used to be derived from the room's own lines — the newest one
   * saying somebody had RSVP'd, or filled in his week. Those lines were doing
   * two jobs at once, and only one of them was news: the conversation is what
   * the dads typed now, and the looking-again is a `stir` frame that carries
   * nothing but "this kind of thing changed".
   */
  const nightPulse = room.nightPulse;

  /**
   * The newest line that could change what is waiting for him.
   *
   * Same reasoning as the pulse above, and the same reason: this was keyed on
   * the newest line of ANY kind, so five dads talking through an evening each
   * spent a round trip per line asking a question whose answer only moves
   * when somebody files an answer, a check-in, a promise or its outcome.
   */
  const todoPulse = room.todoPulse;

  useEffect(refreshTodo, [refreshTodo, todoPulse]);

  // An answer to the question files itself as a line, not as a write the
  // server stirs the room about, so "a question for you" used to stay on
  // after he had answered it. His own answers coming or going (taking one
  // back brings the question back) is the thing to look again at — keyed on
  // how many he has in the room, not on every line anybody says.
  const myAnswers = room.messages.filter(
    (m) => m.kind === 'prompt' && m.memberId === session.member.id,
  ).length;
  useEffect(refreshTodo, [refreshTodo, myAnswers]);

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

  /** Not optimistic: the note says it is on the list when the room took it. */
  const pick = useCallback(
    (id: string, category: PickCategory) => {
      void addPick(id, category).then((ok) => setNote(t(ok ? 'line.picked' : 'line.pick_failed')));
    },
    [t],
  );

  const typingNames = [...room.typing.entries()]
    .filter(([id]) => id !== session.member.id)
    .map(([, name]) => name);

  // The Menu button wears its dot when ANY row inside it has something for him,
  // and for no other reason: each row says which in words, and a switched-off
  // room cannot be waiting. A dot with nothing behind it is the one thing a
  // mark must never be.
  const waiting = (todo.prompt && room.rooms.questions) || (todo.board && room.rooms.week);
  const soon = nightShort(t, lang, room.night, now);

  /** A member id as a name, for the marks. Everyone in the group, not who
   * is connected: a mark from a dad who is not here tonight was "someone". */
  const nameOf = useCallback(
    (memberId: string) =>
      room.members.find((m) => m.memberId === memberId)?.name ?? t('line.someone'),
    [room.members, t],
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
    seen.since === null ? null : { seq: seen.since, label: t('room.since'), me: session.member.id },
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
    <MembersProvider members={room.members} champions={room.champions}>
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
          roster={room.roster}
          typing={[...room.typing.keys()].filter((id) => id !== session.member.id)}
          soon={soon}
          callState={call.state}
          callers={room.call.length}
          tableEver={tableEver}
          tableOpen={tableOpen}
          onTable={() => setTableOpen((v) => !v)}
          onCall={() => {
            if (view === 'home') goTalk();
            else if (call.state === 'in') setSheet('here');
            else void call.join();
          }}
          // On the conversation's Menu button, which is where the questions
          // live now that home holds only the night and the way in.
          waiting={waiting}
          onHome={goHome}
          onWho={() => {
            setProfileOf(null);
            setSheet('here');
          }}
          onNight={() => setSheet('night')}
          onMenu={() => setSheet('menu')}
          onSettings={() => setSheet('settings')}
          onAbout={() => setSheet('about')}
          onJoinCall={() => void call.join()}
          onLeaveCall={call.leave}
        />

        {/* Home sits BESIDE the stage rather than in place of it, and the stage
          is hidden with CSS: taking it out of the tree would unmount the
          table's iframe and restart a game in progress, which is the same
          reason the table has never been unmounted either. */}
        <Home
          night={room.night}
          answered={nightPulse}
          pollPulse={room.pollPulse}
          eventsPulse={room.eventsPulse}
          you={session.member.id}
          unseen={seen.unseen}
          // Counted off the roster of members, which has not arrived yet while
          // it is empty: "alone" is a fact the room has to have told us.
          alone={room.members.filter((m) => !m.gone).length === 1}
          said={room.messages.some(
            (m) => m.memberId === session.member.id && (m.kind === 'chat' || m.kind === 'prompt'),
          )}
          onGo={goTalk}
          onNight={() => setSheet('night')}
          onInvite={() => setSheet('invite')}
          onEvents={() => setSheet('events')}
        />

        <div className="stage">
          <div className="col-talk">
            <CallBar
              state={call.state}
              dropped={call.dropped}
              peers={call.peers}
              muted={call.muted}
              camera={call.camera}
              facing={call.facing}
              cameras={call.cameras}
              swaps={call.swaps}
              speakingYou={call.speakingYou}
              localStream={call.localStream.current}
              onLeave={call.leave}
              onRejoin={call.rejoin}
              onToggleMute={call.toggleMute}
              onToggleCamera={() => void call.toggleCamera()}
              onSwitchCamera={() => void call.switchCamera()}
              onWho={() => setSheet('here')}
            />

            <Lines
              rows={rows}
              empty={room.messages.length === 0}
              you={session.member.id}
              lines={lines}
              bottom={bottom}
              newMark={newMark}
              nameOf={nameOf}
              onReact={(id, emoji, on) => {
                buzz();
                room.react(id, emoji, on, session.member.id);
              }}
              onRetract={room.retract}
              onReply={(message) => {
                setEditing(null);
                setReplyTo(message);
              }}
              onEdit={(message) => {
                setReplyTo(null);
                setEditing(message);
              }}
              // Once the menu has closed, in place of it handing focus back to
              // the line (`away` in LineMenu).
              onAway={() => composer.current?.focus()}
              onKeep={(media) => keep(media.id, !media.kept)}
              onPick={pick}
              onOpenPhoto={setViewing}
              onOpenProfile={(memberId) => {
                setProfileOf(memberId);
                setSheet('here');
              }}
              // The field's own blur rather than a handle on the composer:
              // the keyboard goes down and the draft stays where it was.
              onTapAway={() => {
                const field = document.activeElement;
                if (field instanceof HTMLElement && field.id === 'say') field.blur();
              }}
              onArrived={view === 'talk' ? onArrived : undefined}
              onScroll={seen.onScroll}
            />

            {/* Not shown: a screen reader's way of hearing the room. */}
            <div
              role="log"
              aria-live="polite"
              aria-label={t('room.messages')}
              className="sr-only"
              data-testid="log"
            >
              {heard.map((h) => (
                <p key={h.n}>{h.text}</p>
              ))}
            </div>

            {/* One way down, two looks (Marc asked, 2026-11-02): the count
                when something new is below, the bare arrow from far up when
                nothing is. Within a screen of the bottom, nothing. */}
            {jump === 'count' ? (
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
            ) : jump === 'arrow' ? (
              <Button
                look="plain"
                size="icon"
                className="mx-auto rounded-full text-muted"
                onClick={seen.toBottom}
                aria-label={t('room.newest')}
                data-testid="to-bottom"
              >
                <ArrowDown size={20} aria-hidden="true" />
                <span className="sr-only">{t('room.newest')}</span>
              </Button>
            ) : null}

            <p className="min-h-[1.2em] text-xs text-muted" aria-live="polite">
              {note ??
                (room.waiting > 0 ? (
                  t(`room.waiting_${plural(lang, room.waiting)}`, { n: room.waiting })
                ) : typingNames.length > 0 ? (
                  // A pair of glasses bobbing beside the names: the
                  // symbol doing the work of "is typing…". The sentence is
                  // still there for anything reading it aloud.
                  <>
                    <Glasses width={18} className="typing-glasses mr-1.5" />
                    <span aria-hidden="true">{typingNames.join(', ')}</span>
                    <span className="sr-only">
                      {t('room.typing', { names: typingNames.join(', ') })}
                    </span>
                  </>
                ) : (
                  ' '
                ))}
            </p>

            <Composer
              ref={composer}
              busy={composing}
              groupId={session.group.id}
              me={session.member.id}
              onSend={(body, mediaId) => {
                room.send(body, mediaId, replyTo?.id);
                setReplyTo(null);
                // Sending is going to the bottom, wherever he was reading.
                seen.sent();
              }}
              onTyping={room.sendTyping}
              replyTo={replyTo === null ? null : { name: replyTo.name, body: replyTo.body }}
              onClearReply={() => setReplyTo(null)}
              editing={editing === null ? null : { id: editing.id, body: editing.body }}
              onEdit={room.edit}
              onCancelEdit={() => setEditing(null)}
            />
          </div>

          {/* Mounted once asked for, then kept: unmounting the iframe restarts a
            game in progress. */}
          <div className="col-table">
            {tableEver ? (
              <TableColumn
                onEvent={room.relayTableEvent}
                onClose={() => setTableOpen(false)}
                pulse={room.tablePulse}
              />
            ) : null}
          </div>
        </div>

        <Sheets
          open={sheet}
          onOpen={(next) => {
            // Closed, or gone to another sheet: the next "who is in it",
            // from the header or the call, opens on the roster again.
            if (next !== 'here') setProfileOf(null);
            setSheet(next);
          }}
          profileOf={profileOf}
          you={session.member.id}
          youName={room.you?.name ?? session.member.displayName}
          messages={room.messages}
          roster={room.roster}
          call={room.call}
          night={room.night}
          pollPulse={room.pollPulse}
          nightPulse={nightPulse}
          eventsPulse={room.eventsPulse}
          picksPulse={room.picksPulse}
          onSend={room.send}
          rooms={room.rooms}
          members={room.members}
          createdBy={room.createdBy}
          // From `members` and not the roster: the man who opened the room is
          // very often not the one sitting in it tonight.
          roomName={session.group.name}
          ownerName={room.members.find((m) => m.memberId === session.group.createdBy)?.name ?? ''}
          todo={todo}
          tableOpen={tableOpen}
          mine={mine}
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
        {splash ? <Splash onDone={endSplash} /> : null}
        {entering > 0 ? (
          <Splash key={entering} way="talk" onDone={endEntering} onCovered={toTalk} />
        ) : null}
      </main>
    </MembersProvider>
  );
}
