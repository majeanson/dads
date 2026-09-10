import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { fetchTodo, type Session, type Todo } from './api';
import { Attachment } from './Attachment';
import { Board } from './Board';
import { CallBar } from './CallBar';
import { DadNightBar } from './DadNightBar';
import { prepare, readableSize, upload, type Prepared } from './media';
import { toRows } from './messageGroups';
import { PromptCard } from './PromptCard';
import { PromptList } from './PromptList';
import { TableColumn } from './TableColumn';
import { useCall } from './useCall';
import { useRoom } from './useRoom';

function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

type Tab = 'today' | 'table' | 'prompts' | 'board';

/**
 * Today's chat is where you are; everything else is a tab you visit.
 *
 * The conversation is the room, so nothing competes with it above the message
 * list. Today's question lives behind the Prompts tab with all the others;
 * the tab's mark is what says one is waiting for you.
 *
 * A tab carries a mark when something is waiting for YOU — a question you have
 * not answered, a week you have not filled in — so the room itself tells you
 * whether there is anywhere to go. A mark for something somebody else did
 * would be noise.
 *
 * The table is the one tab that stays mounted while you are elsewhere:
 * unmounting the iframe restarts a game. On a wide screen it needs no tab at
 * all, because it sits beside the conversation.
 */
export function Room({ session, onSignOut }: { session: Session; onSignOut: () => void }) {
  const room = useRoom(true, session.group.dadNight);
  const [tab, setTab] = useState<Tab>('today');
  const [wideTable, setWideTable] = useState(false);
  const [draft, setDraft] = useState('');
  /** Picked but not sent: the dad still gets a caption, or a change of mind. */
  const [pending, setPending] = useState<Prepared | null>(null);
  const [sending, setSending] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [todo, setTodo] = useState<Todo>({ prompt: false, board: false });
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
    if (tab === 'today') bottom.current?.scrollIntoView({ block: 'end' });
  }, [room.messages.length, tab]);

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
        result.error === 'too_large'
          ? 'That file is too big — 10 MB is the limit.'
          : 'Couldn’t send that. Try again.',
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

  const tabs: { id: Tab; label: string; mark: boolean; narrowOnly?: boolean }[] = [
    { id: 'today', label: 'Today', mark: false },
    { id: 'table', label: 'Table', mark: false, narrowOnly: true },
    { id: 'prompts', label: 'Prompts', mark: todo.prompt },
    { id: 'board', label: 'Board', mark: todo.board },
  ];

  return (
    <main className="room" data-tab={tab} data-split={wideTable ? 'half' : 'talk'}>
      <header className="room-head">
        <div>
          <h1>{session.group.name}</h1>
          <p className="quiet" data-testid="connection">
            {room.connection === 'open'
              ? `${room.roster.length} here`
              : room.connection === 'connecting'
                ? 'Opening the door…'
                : 'Reconnecting…'}
          </p>
        </div>
        <button type="button" className="link" onClick={onSignOut}>
          Sign out
        </button>
      </header>

      <DadNightBar night={room.night} />

      <nav className="tabs" aria-label="Rooms">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`${tab === t.id ? 'is-current' : ''}${t.narrowOnly ? ' only-narrow' : ''}`}
            aria-current={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.mark ? (
              <span className="mark" data-testid={`mark-${t.id}`} aria-hidden="true" />
            ) : null}
            {t.mark ? <span className="sr-only"> — something waiting</span> : null}
          </button>
        ))}
        <ul className="roster" aria-label="Who's here">
          {room.roster.map((m) => (
            <li key={m.memberId} data-testid="roster-entry">
              {m.name}
              {m.memberId === session.member.id ? ' (you)' : ''}
            </li>
          ))}
        </ul>
      </nav>

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

          <ol className="lines" aria-label="Messages">
            {room.messages.length === 0 ? (
              <li className="lines-empty quiet">Nobody has said anything yet.</li>
            ) : null}
            {toRows(room.messages).map((row) =>
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
                          <span className="answer-tag">answered</span>
                        ) : null}
                        {row.message.body}
                        {row.message.media ? <Attachment media={row.message.media} /> : null}
                      </span>
                      <time className="when">{clock(row.message.createdAt)}</time>
                    </>
                  ) : (
                    <span className="body">{row.message.body}</span>
                  )}
                </li>
              ),
            )}
            <div ref={bottom} />
          </ol>

          <p className="typing" aria-live="polite">
            {typingNames.length > 0 ? `${typingNames.join(', ')} typing…` : ' '}
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
                  Remove
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
              <span className="sr-only">Attach a photo or file</span>
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
              Say something
            </label>
            <input
              id="say"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                room.sendTyping();
              }}
              placeholder={pending === null ? 'Say something' : 'Add a caption, or just send it'}
              autoComplete="off"
              disabled={room.connection !== 'open'}
            />
            <button
              type="submit"
              disabled={
                room.connection !== 'open' || sending || (!draft.trim() && pending === null)
              }
            >
              {sending ? 'Sending…' : 'Send'}
            </button>
          </form>
        </div>

        {/* Always mounted: unmounting the iframe restarts a game in progress. */}
        <div className="col-table">
          <TableColumn
            onEvent={room.relayTableEvent}
            wide={wideTable}
            onToggleWide={() => setWideTable((v) => !v)}
          />
        </div>

        {/* Mounted on demand, so each reads its data fresh every visit rather
            than showing what was true when the page loaded. */}
        <div className="panel panel-prompts">
          {tab === 'prompts' ? (
            <>
              <PromptCard
                messages={room.messages}
                onAnswer={room.answerPrompt}
                canAnswer={room.connection === 'open'}
              />
              <PromptList />
            </>
          ) : null}
        </div>
        <div className="panel panel-board">
          {tab === 'board' ? <Board onChanged={refreshTodo} /> : null}
        </div>
      </div>
    </main>
  );
}
