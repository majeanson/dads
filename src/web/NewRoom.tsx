import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { createRoom, type CreateError, type Session } from './api';
import { useT, type Key } from './i18n';
import { Button } from './ui/Button';
import { FIELD } from './ui/field';
import { useFreshBuild } from './useFreshBuild';

const MESSAGES: Record<CreateError, Key> = {
  missing_room_name: 'new.missing_room_name',
  room_name_too_long: 'new.room_name_too_long',
  code_too_short: 'new.code_too_short',
  code_too_long: 'new.code_too_long',
  code_taken: 'new.code_taken',
  missing_name: 'join.missing_name',
  name_too_long: 'join.name_too_long',
  too_many_rooms: 'new.too_many_rooms',
  unknown: 'new.unknown',
};

/**
 * The other half of the door: opening a room instead of walking into one.
 *
 * Three fields, because three is what it takes — what to call it, the word,
 * and who you are — and it lets him in on the same submit. Asking him to name
 * a room and then type its word at the door would be asking a man to prove he
 * is himself thirty seconds after inventing the proof.
 *
 * Deliberately NOT the first thing on the door. Almost everybody who ever
 * loads this page was sent a word by a friend, and the screen should ask them
 * the one question they came to answer. This is a line underneath it.
 */
export function NewRoom({
  onMade,
  onBack,
}: {
  onMade: (session: Session) => void;
  onBack: () => void;
}) {
  const { t } = useT();
  const [name, setName] = useState('');
  const [word, setWord] = useState('');
  const [yourName, setYourName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useFreshBuild(() => name !== '' || word !== '' || yourName !== '');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await createRoom(name, word, yourName);
      if (result.ok) onMade(result.session);
      else setError(t(MESSAGES[result.error] ?? 'new.unknown'));
    } catch {
      setError(t('new.unknown'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="display m-0 text-4xl">{t('new.title')}</h1>
      <p className="mt-2 mb-8 text-[1.0625rem] text-muted">{t('new.lede')}</p>

      <form onSubmit={submit} className="grid grid-cols-1 gap-4">
        <div className="grid gap-1.5">
          <label htmlFor="room-name" className="text-base text-muted">
            {t('new.room_name')}
          </label>
          <input
            id="room-name"
            name="room-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoCapitalize="words"
            enterKeyHint="next"
            maxLength={40}
            className={FIELD}
            autoFocus
          />
        </div>

        <div className="grid gap-1.5">
          <label htmlFor="room-word" className="text-base text-muted">
            {t('new.word')}
          </label>
          <input
            id="room-word"
            name="room-word"
            value={word}
            onChange={(e) => setWord(e.target.value)}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="next"
            className={FIELD}
          />
          {/* What the word DOES, said before he picks one rather than after
              he has sent it to four people. */}
          <p className="m-0 text-sm text-muted">{t('new.word_hint')}</p>
        </div>

        <div className="grid gap-1.5">
          <label htmlFor="room-you" className="text-base text-muted">
            {t('new.your_name')}
          </label>
          <input
            id="room-you"
            name="room-you"
            value={yourName}
            onChange={(e) => setYourName(e.target.value)}
            autoComplete="given-name"
            autoCapitalize="words"
            enterKeyHint="go"
            maxLength={32}
            className={FIELD}
          />
        </div>

        <Button
          type="submit"
          look="primary"
          size="lg"
          disabled={busy}
          className="mt-1 justify-center"
          data-testid="open-room"
        >
          {busy ? t('new.opening') : t('new.open')}
          <ArrowRight size={18} aria-hidden="true" />
        </Button>
      </form>

      {error ? (
        <p className="mt-4 text-[1.0625rem] text-danger" role="alert">
          {error}
        </p>
      ) : null}

      <Button look="quiet" size="lg" onClick={onBack} className="mt-4 justify-center">
        <ArrowLeft size={18} aria-hidden="true" />
        {t('new.back')}
      </Button>
    </>
  );
}
