import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Session } from './api';
import { Board } from './Board';
import { DadNightBar } from './DadNightBar';
import { PromptCard } from './PromptCard';
import { PromptList } from './PromptList';
import { TableColumn } from './TableColumn';
import { useRoom } from './useRoom';

function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

type View = 'room' | 'prompts' | 'board' | 'table';

const VIEWS: { id: View; label: string }[] = [
  { id: 'room', label: 'Room' },
  { id: 'table', label: 'Table' },
  { id: 'prompts', label: 'Prompts' },
  { id: 'board', label: 'Board' },
];

/**
 * A card night: the talking on the left, the table on the right, on any screen
 * wide enough to hold both. Narrower than that, the nav picks one at a time.
 *
 * The table stays mounted and is hidden with CSS — unmounting it would restart
 * the game every time someone glanced at the board. The prompts and the board
 * are the opposite: they read once on mount, so keeping them alive would show
 * data that was true when the page loaded and has been wrong ever since.
 */
export function Room({ session, onSignOut }: { session: Session; onSignOut: () => void }) {
  const room = useRoom(true, session.group.dadNight);
  const [view, setView] = useState<View>('room');
  const [draft, setDraft] = useState('');
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (view === 'room') bottom.current?.scrollIntoView({ block: 'end' });
  }, [room.messages.length, view]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body) return;
    if (room.send(body)) setDraft('');
  }

  const typingNames = [...room.typing.entries()]
    .filter(([id]) => id !== session.member.id)
    .map(([, name]) => name);

  return (
    <main className="room" data-view={view}>
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

      <nav className="views" aria-label="Views">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            className={view === v.id ? 'is-current' : ''}
            aria-current={view === v.id}
            onClick={() => setView(v.id)}
          >
            {v.label}
          </button>
        ))}
      </nav>

      <div className="stage">
        <div className="col-talk">
          <ul className="roster" aria-label="Who's here">
            {room.roster.map((m) => (
              <li key={m.memberId} data-testid="roster-entry">
                {m.name}
                {m.memberId === session.member.id ? ' (you)' : ''}
              </li>
            ))}
          </ul>

          <PromptCard
            messages={room.messages}
            onAnswer={room.answerPrompt}
            canAnswer={room.connection === 'open'}
          />

          <ol className="lines" aria-label="Messages">
            {room.messages.map((m) => (
              <li key={m.seq} className={`line line-${m.kind}`} data-testid="line">
                {m.kind === 'chat' ? (
                  <>
                    <span className="who">{m.name}</span>
                    <span className="body">{m.body}</span>
                    <time className="when">{clock(m.createdAt)}</time>
                  </>
                ) : m.kind === 'prompt' ? (
                  <>
                    <span className="who">{m.name}</span>
                    <span className="body">
                      <span className="answer-tag">answered</span> {m.body}
                    </span>
                    <time className="when">{clock(m.createdAt)}</time>
                  </>
                ) : (
                  <span className="body">{m.body}</span>
                )}
              </li>
            ))}
            <div ref={bottom} />
          </ol>

          <p className="typing" aria-live="polite">
            {typingNames.length > 0 ? `${typingNames.join(', ')} typing…` : ' '}
          </p>

          <form className="composer" onSubmit={submit}>
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
              placeholder="Say something"
              autoComplete="off"
              disabled={room.connection !== 'open'}
            />
            <button type="submit" disabled={room.connection !== 'open' || !draft.trim()}>
              Send
            </button>
          </form>
        </div>

        <div className="col-table">
          <TableColumn onEvent={room.relayTableEvent} />
        </div>

        {/* Mounted on demand, unlike the table above: both read their data
            once when they mount, so keeping them alive would show a board that
            was current when the page loaded and has been wrong ever since. The
            table is the only panel that must survive a tab switch. */}
        <div className="panel panel-prompts">{view === 'prompts' ? <PromptList /> : null}</div>

        <div className="panel panel-board">{view === 'board' ? <Board /> : null}</div>
      </div>
    </main>
  );
}
