import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Session } from './api';
import { DadNightBar } from './DadNightBar';
import { useRoom } from './useRoom';

function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/**
 * The talk column. Roster on top, the evening's lines in the middle, the
 * composer at the bottom. The table column (M6) sits beside it.
 */
export function Room({ session, onSignOut }: { session: Session; onSignOut: () => void }) {
  const room = useRoom(true, session.group.dadNight);
  const [draft, setDraft] = useState('');
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [room.messages.length]);

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
    <main className="room">
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

      <ul className="roster" aria-label="Who's here">
        {room.roster.map((m) => (
          <li key={m.memberId} data-testid="roster-entry">
            {m.name}
            {m.memberId === session.member.id ? ' (you)' : ''}
          </li>
        ))}
      </ul>

      <ol className="lines" aria-label="Messages">
        {room.messages.map((m) => (
          <li key={m.seq} className={`line line-${m.kind}`} data-testid="line">
            {m.kind === 'chat' ? (
              <>
                <span className="who">{m.name}</span>
                <span className="body">{m.body}</span>
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
        {typingNames.length > 0 ? `${typingNames.join(', ')} typing…` : ' '}
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
    </main>
  );
}
