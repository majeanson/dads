import { ArrowRight } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { join, type JoinFailure, type Session } from './api';
import { plural, useT, type Key, type T } from './i18n';
import { Logo } from './Logo';
import { NewRoom } from './NewRoom';
import { LangToggle } from './Toggles';
import { Button } from './ui/Button';
import { useFreshBuild } from './useFreshBuild';
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
  /** The door has two sides now: walking in, and opening one. A dad who was
   * sent a link is never shown the second — he has already been let in by
   * whoever sent it, and a form for making his own would be an odd answer. */
  const [making, setMaking] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  // The door too, held back while he is typing into it.
  useFreshBuild(() => code !== '' || name !== '');
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
    <main className="relative mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-5 py-10">
      {/* The one thing a stranger at the door can change, in the corner where
          a language switch lives on every site he has ever used. The theme
          follows his phone and needs no asking; the language does. */}
      <div className="absolute top-[max(1rem,env(safe-area-inset-top))] right-5">
        <LangToggle compact />
      </div>

      {/* The app's own face, at the door, putting its glasses on as he
          arrives. A stranger who has been handed a code should recognise where
          he has landed — and the first thing the app does should be a small
          welcome rather than a form. */}
      {making ? (
        <>
          <DoorMark />
          <NewRoom onMade={onJoined} onBack={() => setMaking(false)} />
        </>
      ) : (
        <>
          <div className="mb-2 flex items-center gap-4">
            <DoorMark />
            <h1 className="display m-0 text-5xl">dads</h1>
          </div>
          <p className="mt-2 mb-8 text-[1.0625rem] text-muted">
            {invite ? t('join.invited') : t('join.lede')}
          </p>

          <form onSubmit={submit} className="grid grid-cols-1 gap-4">
            {/* A dad who followed a link has already been let in by whoever sent
            it. Asking him for the passphrase as well would be asking him to
            prove it twice. */}
            {invite ? null : (
              <div className="grid gap-1.5">
                <label htmlFor="code" className="text-base text-muted">
                  {t('join.code')}
                </label>
                <input
                  id="code"
                  name="code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="next"
                  className={FIELD}
                  // The only thing anyone comes here to do.
                  autoFocus
                />
              </div>
            )}

            <div className="grid gap-1.5">
              <label htmlFor="name" className="text-base text-muted">
                {t('join.name')}
              </label>
              <input
                id="name"
                name="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="given-name"
                autoCapitalize="words"
                enterKeyHint="go"
                maxLength={32}
                className={FIELD}
                autoFocus={invite !== ''}
              />
            </div>

            <Button
              type="submit"
              look="primary"
              size="lg"
              disabled={busy}
              className="mt-1 justify-center"
            >
              {busy ? t('join.opening') : t('join.come_in')}
              <ArrowRight size={18} aria-hidden="true" />
            </Button>
          </form>

          {error ? (
            <p className="mt-4 text-[1.0625rem] text-danger" role="alert">
              {error}
            </p>
          ) : null}

          {/* Under the one question this screen exists to ask, never beside it:
          nearly everybody who lands here was sent a word by a friend. A man
          who followed an invite link is not offered it at all — he is already
          being let into somebody's room. */}
          {invite ? null : (
            <Button
              look="quiet"
              size="lg"
              onClick={() => setMaking(true)}
              className="mt-4 justify-center"
              data-testid="start-room"
            >
              {t('new.start')}
            </Button>
          )}
        </>
      )}
    </main>
  );
}

/** The mark on its square, as on the home screen icon, drawn live. */
function DoorMark() {
  return (
    <span className="motion-pop mb-3 inline-grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-accent text-on-accent">
      <Logo size={48} hole="var(--accent)" motion="on" />
    </span>
  );
}
