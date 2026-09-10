import { useState, type FormEvent } from 'react';
import { join, type JoinFailure, type Session } from './api';
import { plural, useT, type Key, type T } from './i18n';
import { LangToggle } from './Toggles';

// One message for a wrong code and for a code that belongs to no group: the
// door must not tell a stranger whether he is close.
const MESSAGES: Record<string, Key> = {
  bad_code: 'join.bad_code',
  missing_code: 'join.missing_code',
  missing_name: 'join.missing_name',
  name_too_long: 'join.name_too_long',
  unknown: 'join.unknown',
};

function message(t: T, lang: 'en' | 'fr', failure: JoinFailure): string {
  if (failure.error === 'too_many_attempts') {
    const minutes = Math.max(1, Math.ceil((failure.retryAfterSeconds ?? 60) / 60));
    return t(`join.too_many_${plural(lang, minutes)}`, { n: minutes });
  }
  return t(MESSAGES[failure.error] ?? 'join.unknown');
}

export function JoinScreen({ onJoined }: { onJoined: (session: Session) => void }) {
  const { t, lang } = useT();
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
      else setError(message(t, lang, result.failure));
    } catch {
      setError(t('join.unknown'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="join">
      <h1>dads</h1>
      <p className="lede">{t('join.lede')}</p>

      <form onSubmit={submit}>
        <label htmlFor="code">{t('join.code')}</label>
        <input
          id="code"
          name="code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          // The only thing anyone comes here to do.
          autoFocus
        />

        <label htmlFor="name">{t('join.name')}</label>
        <input
          id="name"
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="given-name"
          maxLength={32}
        />

        <button type="submit" disabled={busy}>
          {busy ? t('join.opening') : t('join.come_in')}
        </button>
      </form>

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      {/* The one thing a stranger at the door can change. The theme follows
          his phone and needs no asking; the language does. */}
      <LangToggle />
    </main>
  );
}
