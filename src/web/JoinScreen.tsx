import { useState, type FormEvent } from 'react';
import { join, type JoinFailure, type Session } from './api';

const MESSAGES: Record<string, string> = {
  // One message for a wrong code and for a code that belongs to no group: the
  // door must not tell a stranger whether he is close.
  bad_code: "That code doesn't open anything. Ask whoever sent you.",
  missing_code: 'Enter the code.',
  missing_name: 'Enter your name.',
  name_too_long: "That's a long name — 32 characters or fewer.",
  unknown: 'Something went wrong. Try again.',
};

function message(failure: JoinFailure): string {
  if (failure.error === 'too_many_attempts') {
    const minutes = Math.max(1, Math.ceil((failure.retryAfterSeconds ?? 60) / 60));
    return `Too many tries. Give it ${minutes} minute${minutes === 1 ? '' : 's'}.`;
  }
  return MESSAGES[failure.error] ?? MESSAGES.unknown!;
}

export function JoinScreen({ onJoined }: { onJoined: (session: Session) => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await join(code, name);
      if (result.ok) onJoined(result.session);
      else setError(message(result.failure));
    } catch {
      setError(MESSAGES.unknown!);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="join">
      <h1>dads</h1>
      <p className="lede">Somewhere to talk about it, and a table to sit at while you do.</p>

      <form onSubmit={submit}>
        <label htmlFor="code">Code</label>
        <input
          id="code"
          name="code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
        />

        <label htmlFor="name">Your name</label>
        <input
          id="name"
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="given-name"
          maxLength={32}
        />

        <button type="submit" disabled={busy}>
          {busy ? 'Opening…' : 'Come in'}
        </button>
      </form>

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </main>
  );
}
