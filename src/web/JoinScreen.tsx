import { ArrowRight } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { join, type JoinFailure, type Session } from './api';
import { plural, useT, type Key, type T } from './i18n';
import { LangToggle } from './Toggles';
import { Button } from './ui/Button';
import { FIELD } from './ui/field';

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

/**
 * The token out of /i/<token>, taken once and taken OFF the address bar.
 *
 * It is a credential. Leaving it in the URL puts it in the tab title, in a
 * screenshot of the door, and in whatever this browser syncs — for a link
 * whose whole job was to be used once and forgotten.
 */
function inviteFromUrl(): string {
  const match = /^\/i\/([A-Za-z0-9_-]{32,})$/.exec(location.pathname);
  if (!match) return '';
  history.replaceState(null, '', '/');
  return match[1] ?? '';
}

export function JoinScreen({ onJoined }: { onJoined: (session: Session) => void }) {
  const { t, lang } = useT();
  const [invite] = useState(inviteFromUrl);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await join(code, name, invite || undefined);
      if (result.ok) onJoined(result.session);
      else setError(message(t, lang, result.failure));
    } catch {
      setError(t('join.unknown'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-5 py-10">
      {/* The app's own face, at the door. It is the only decoration in the
          whole product and it is here because a stranger who has been handed
          a code should recognise where he has landed. */}
      <img src="/icon.svg" alt="" width={56} height={56} className="mb-5 rounded-2xl shadow-sm" />
      <h1 className="m-0 text-3xl font-semibold tracking-tight">dads</h1>
      <p className="mt-2 mb-8 text-[0.9375rem] text-muted">
        {invite ? t('join.invited') : t('join.lede')}
      </p>

      <form onSubmit={submit} className="grid gap-4">
        {/* A dad who followed a link has already been let in by whoever sent
            it. Asking him for the passphrase as well would be asking him to
            prove it twice. */}
        {invite ? null : (
          <div className="grid gap-1.5">
            <label htmlFor="code" className="text-sm text-muted">
              {t('join.code')}
            </label>
            <input
              id="code"
              name="code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              className={FIELD}
              // The only thing anyone comes here to do.
              autoFocus
            />
          </div>
        )}

        <div className="grid gap-1.5">
          <label htmlFor="name" className="text-sm text-muted">
            {t('join.name')}
          </label>
          <input
            id="name"
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="given-name"
            maxLength={32}
            className={FIELD}
            autoFocus={invite !== ''}
          />
        </div>

        <Button type="submit" look="primary" disabled={busy} className="mt-1 justify-center">
          {busy ? t('join.opening') : t('join.come_in')}
          <ArrowRight size={16} aria-hidden="true" />
        </Button>
      </form>

      {error ? (
        <p className="mt-4 text-[0.9375rem] text-danger" role="alert">
          {error}
        </p>
      ) : null}

      {/* The one thing a stranger at the door can change. The theme follows
          his phone and needs no asking; the language does. */}
      <div className="mt-10">
        <LangToggle />
      </div>
    </main>
  );
}
