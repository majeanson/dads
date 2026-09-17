import { Check, DoorOpen, LogIn, Plus } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { fetchMyRooms, join, switchRoom, type MyRoom } from './api';
import { useT } from './i18n';
import { ITEM } from './Menu';
import { NewRoom } from './NewRoom';
import { FIELD } from './ui/field';
import { Button } from './ui/Button';
import { cn } from './ui/cn';

/**
 * Every room this phone is in, and the way between them.
 *
 * A dad could always belong to more than one: the device token is looked up
 * per group, so joining a second room never cost him the first, and typing
 * the first room's word again brought him back as himself with his whole
 * history. What he could not do was get back without that word written down
 * somewhere, and nothing in the app ever told him which rooms he was in.
 *
 * Switching RELOADS. The socket, the session, the seen-marks, the night and
 * every screen read from them are keyed to the group; the honest way to
 * change all of it at once is to start again, and it takes the time a tap
 * already takes.
 */
export function MyRooms({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  const [rooms, setRooms] = useState<MyRoom[] | null>(null);
  const [going, setGoing] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchMyRooms()
      .then((r) => !cancelled && setRooms(r))
      .catch(() => !cancelled && setRooms([]));
    return () => {
      cancelled = true;
    };
  }, []);

  async function go(room: MyRoom) {
    if (room.current) {
      onClose();
      return;
    }
    setGoing(room.id);
    setFailed(false);
    if (await switchRoom(room.id)) location.reload();
    else {
      setGoing(null);
      setFailed(true);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-3" data-testid="my-rooms">
      <p className="m-0 text-[1.0625rem] text-muted">{t('rooms.lede')}</p>

      <div className="grid grid-cols-1 gap-2">
        {(rooms ?? []).map((room) => (
          <Button
            key={room.id}
            block
            className={cn(ITEM, room.current && 'border-accent')}
            disabled={going !== null}
            onClick={() => void go(room)}
            data-testid="my-room"
            data-current={room.current ? 'yes' : 'no'}
          >
            <DoorOpen size={22} aria-hidden="true" className="shrink-0 text-muted" />
            <span className="min-w-0 truncate">{room.name}</span>
            {/* What he is called in that one. A man can go by different names
                in two different circles, and this is the only place both are
                on the screen at once. */}
            <span className="ml-auto shrink-0 text-sm font-normal text-muted">
              {going === room.id
                ? t('rooms.going')
                : room.current
                  ? t('rooms.here')
                  : t('rooms.as', { name: room.displayName })}
            </span>
            {room.current ? (
              <Check size={18} aria-hidden="true" className="shrink-0 text-accent" />
            ) : null}
          </Button>
        ))}
      </div>

      {failed ? (
        <p className="error m-0 text-sm" role="alert">
          {t('rooms.failed')}
        </p>
      ) : null}

      {/* And the ways to get ANOTHER one, which have to be here: a man who is
          already inside cannot reach the door, and the door is where both of
          them otherwise live. He keeps this room either way. */}
      <div className="mt-1 grid grid-cols-1 gap-2 border-t border-line pt-3">
        <p className="m-0 text-sm text-muted">{t('rooms.another_hint')}</p>
        <Join />
        {starting ? (
          <NewRoom onMade={() => location.reload()} onBack={() => setStarting(false)} />
        ) : (
          <Button
            block
            className={ITEM}
            onClick={() => setStarting(true)}
            data-testid="rooms-start"
          >
            <Plus size={22} aria-hidden="true" className="shrink-0 text-muted" />
            <span className="min-w-0 truncate">{t('rooms.start')}</span>
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Going into a room he already has the word for.
 *
 * The same door, from inside: it hands the word to `join`, and the device
 * token in the request is what makes him himself in there rather than a
 * stranger with the same name. His current room is untouched — it is in the
 * list above, one tap away.
 */
function Join() {
  const { t } = useT();
  const [word, setWord] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await join(word, name.trim() || 'me');
      if (result.ok) location.reload();
      else setError(t('rooms.bad_word'));
    } catch {
      setError(t('rooms.bad_word'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={go} className="grid grid-cols-1 gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="other-word" className="sr-only">
          {t('rooms.word')}
        </label>
        <input
          id="other-word"
          value={word}
          onChange={(e) => setWord(e.target.value)}
          placeholder={t('rooms.word')}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className={cn(FIELD, 'w-auto min-w-0 flex-1')}
          data-testid="other-word"
        />
        <label htmlFor="other-name" className="sr-only">
          {t('rooms.as', { name: '' })}
        </label>
        <input
          id="other-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('new.your_name')}
          autoCapitalize="words"
          maxLength={32}
          className={cn(FIELD, 'w-auto min-w-0 flex-1')}
          data-testid="other-name"
        />
        <Button type="submit" disabled={busy || word.trim() === ''} data-testid="rooms-join">
          <LogIn size={18} aria-hidden="true" />
          {busy ? t('rooms.joining') : t('rooms.join')}
        </Button>
      </div>
      {error ? (
        <p className="error m-0 text-sm" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
