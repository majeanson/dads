import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Session } from './api';
import { Board } from './Board';
import { DadNightBar } from './DadNightBar';
import { Attachment } from './Attachment';
import { toRows } from './messageGroups';
import { prepare, readableSize, upload, type Prepared } from './media';
import { PromptCard } from './PromptCard';
import { PromptList } from './PromptList';
import { Sheet } from './Sheet';
import { TableColumn } from './TableColumn';
import { useRoom } from './useRoom';

function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** The two things you go and look at, then come back from. */
type Open = 'prompts' | 'board' | null;

/**
 * The room is the app. You are always in it.
 *
 * The prompt library and the weekly board are things a dad goes and checks, so
 * they open over the room and close again rather than replacing it — the
 * conversation should never be somewhere you have to navigate back to.
 *
 * The table is the exception and stays mounted beside the talk: unmounting the
 * iframe would restart a game in progress. On a screen too narrow to hold
 * both, it takes the room's place until it is closed again.
 */
export function Room({ session, onSignOut }: { session: Session; onSignOut: () => void }) {
  const room = useRoom(true, session.group.dadNight);
  const [open, setOpen] = useState<Open>(null);
  const [showTable, setShowTable] = useState(false);
  /** The talk gets most of the screen; the table can take half when a game is
   * the point of the evening. */
  const [wideTable, setWideTable] = useState(false);
  const [draft, setDraft] = useState('');
  /** Picked but not sent yet: the dad still gets to write a caption, or change
   * his mind, before anyone sees it. */
  const [pending, setPending] = useState<Prepared | null>(null);
  const [sending, setSending] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [room.messages.length]);

  // The browser tab says which group you are in, not just "dads".
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

  return (
    <main
      className="room"
      data-table={showTable ? 'on' : 'off'}
      data-split={wideTable ? 'half' : 'talk'}
    >
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

      <div className="toolbar" role="toolbar" aria-label="Room actions">
        <button type="button" onClick={() => setOpen('prompts')}>
          Prompts
        </button>
        <button type="button" onClick={() => setOpen('board')}>
          Board
        </button>
        {/* Only offered where the table cannot already be seen: above 64rem it
            sits beside the room and there is nothing to toggle. */}
        <button
          type="button"
          className="only-narrow"
          aria-pressed={showTable}
          onClick={() => setShowTable((v) => !v)}
        >
          {showTable ? 'Back to the room' : 'Table'}
        </button>
        <ul className="roster" aria-label="Who's here">
          {room.roster.map((m) => (
            <li key={m.memberId} data-testid="roster-entry">
              {m.name}
              {m.memberId === session.member.id ? ' (you)' : ''}
            </li>
          ))}
        </ul>
      </div>

      <div className="stage">
        <div className="col-talk">
          <PromptCard
            messages={room.messages}
            onAnswer={room.answerPrompt}
            canAnswer={room.connection === 'open'}
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

        <div className="col-table">
          <TableColumn
            onEvent={room.relayTableEvent}
            wide={wideTable}
            onToggleWide={() => setWideTable((v) => !v)}
          />
        </div>
      </div>

      {/* Mounted only while open, so each reads its data fresh every time
          rather than showing what was true when the page loaded. */}
      {open === 'prompts' ? (
        <Sheet title="Prompts" onClose={() => setOpen(null)}>
          <PromptList />
        </Sheet>
      ) : null}

      {open === 'board' ? (
        <Sheet title="The board" onClose={() => setOpen(null)}>
          <Board />
        </Sheet>
      ) : null}
    </main>
  );
}
