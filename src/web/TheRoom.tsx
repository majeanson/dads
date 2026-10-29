import { KeyRound, Trash2, UserCheck, UserMinus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import {
  deleteRoom,
  fetchMyRooms,
  handRoom,
  removeMember,
  setRoomWord,
  switchRoom,
  type WordError,
} from './api';
import { useT, type Key } from './i18n';
import type { RosterEntry } from '../shared/protocol';
import { Button } from './ui/Button';
import { cn } from './ui/cn';
import { FIELD } from './ui/field';

const WORD_ERRORS: Record<WordError, Key> = {
  code_too_short: 'set.word_short',
  code_too_long: 'set.word_long',
  code_taken: 'set.word_taken',
  not_yours: 'set.word_failed',
  too_many_attempts: 'new.too_many_words',
  unknown: 'set.word_failed',
};

/**
 * The two things owning a room has to mean, for the man who owns it.
 *
 * Only he sees any of this, and only because owning the switches without it
 * was half a feature: a word that got out could be changed by nobody in the
 * room, and a creator who drifted away left the switches frozen for the
 * other four for ever.
 */
export function TheRoom({
  members,
  you,
  roomName,
}: {
  members: RosterEntry[];
  you: string;
  roomName: string;
}) {
  const { t } = useT();

  // Everybody else still in the room: a dad who has left is nobody to hand
  // it to, and nobody to take out twice.
  const others = members.filter((m) => m.memberId !== you && m.gone !== true);

  // Mounted only once the creator opens it from the line above the switches
  // (`Settings`): two fields with a paragraph each is what took HIS Settings
  // past the bottom of a 667px phone, for him alone.
  return (
    <div className="grid grid-cols-1 gap-4">
      <Word />
      <HandOver members={others} />
      <Remove members={others} />
      <Delete roomName={roomName} />
      <p className="sr-only">{t('set.rooms')}</p>
    </div>
  );
}

/** Setting a new one. There is never an old one to show. */
function Word() {
  const { t } = useT();
  const [word, setWord] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setDone(false);
    const result = await setRoomWord(word).catch(() => ({ ok: false, error: 'unknown' }) as const);
    setBusy(false);
    if (result.ok) {
      setWord('');
      setDone(true);
    } else setError(t(WORD_ERRORS[result.error] ?? 'set.word_failed'));
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-1.5">
      <label htmlFor="room-word-new" className="text-[1.0625rem] font-semibold text-muted">
        {t('set.word')}
      </label>
      {/* What it does, before he does it: the old word stops working and the
          links he has already sent stop working with it. */}
      <p className="m-0 text-sm text-muted">{t('set.word_hint')}</p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id="room-word-new"
          value={word}
          onChange={(e) => setWord(e.target.value)}
          placeholder={t('set.word_new')}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className={cn(FIELD, 'w-auto min-w-0 flex-1')}
          data-testid="room-word"
        />
        <Button type="submit" look="primary" disabled={busy || word.trim() === ''}>
          <KeyRound size={18} aria-hidden="true" />
          {t('set.word_save')}
        </Button>
      </div>
      {done ? (
        <p className="m-0 text-sm text-muted" role="status" data-testid="room-word-done">
          {t('set.word_done')}
        </p>
      ) : null}
      {error ? (
        <p className="error m-0 text-sm" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}

/**
 * Handing it on.
 *
 * Armed, because it cannot be undone from this side: once it is his, getting
 * it back means asking him. The name is in the confirming label so the second
 * press is about a person rather than about a button.
 */
function HandOver({ members }: { members: RosterEntry[] }) {
  const { t } = useT();
  const [to, setTo] = useState('');
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (members.length === 0) return null;

  const name = members.find((m) => m.memberId === to)?.name ?? '';

  async function hand() {
    setBusy(true);
    setError(null);
    try {
      await handRoom(to);
      // Nothing to reset: he is not the owner any more, so this whole block
      // goes off his screen the moment the session says so.
    } catch {
      setError(t('set.hand_failed'));
      setArmed(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-1.5">
      <label htmlFor="hand-to" className="text-[1.0625rem] font-semibold text-muted">
        {t('set.hand_over')}
      </label>
      <p className="m-0 text-sm text-muted">{t('set.hand_hint')}</p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          id="hand-to"
          value={to}
          onChange={(e) => {
            setTo(e.target.value);
            setArmed(false);
          }}
          aria-label={t('set.hand_who')}
          className={cn(FIELD, 'w-auto min-w-0 flex-1 py-0')}
          data-testid="hand-to"
        >
          <option value="">{t('set.hand_who')}</option>
          {members.map((m) => (
            <option key={m.memberId} value={m.memberId}>
              {m.name}
            </option>
          ))}
        </select>
        <Button
          look={armed ? 'primary' : 'plain'}
          disabled={busy || to === ''}
          onClick={() => (armed ? void hand() : setArmed(true))}
          data-testid="hand-over"
        >
          <UserCheck size={18} aria-hidden="true" />
          <span className="min-w-0 truncate">
            {armed ? t('set.hand_sure', { name }) : t('set.hand_do')}
          </span>
        </Button>
      </div>
      {error ? (
        <p className="error m-0 text-sm" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Taking a dad out of the room.
 *
 * Armed like the handover, with his name on the second press, because it
 * lands on another man at once and on every phone he has. It says afterwards
 * what it could not do: the word he knows still opens the door, and the form
 * to change it is right above.
 */
function Remove({ members }: { members: RosterEntry[] }) {
  const { t } = useT();
  const [who, setWho] = useState('');
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (members.length === 0 && done === null) return null;

  const name = members.find((m) => m.memberId === who)?.name ?? '';

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await removeMember(who);
      setDone(name);
      setWho('');
    } catch {
      setError(t('set.remove_failed'));
    } finally {
      setArmed(false);
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-1.5">
      <label htmlFor="remove-who" className="text-[1.0625rem] font-semibold text-muted">
        {t('set.remove')}
      </label>
      <p className="m-0 text-sm text-muted">{t('set.remove_hint')}</p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          id="remove-who"
          value={who}
          onChange={(e) => {
            setWho(e.target.value);
            setArmed(false);
            setDone(null);
          }}
          aria-label={t('set.remove_who')}
          className={cn(FIELD, 'w-auto min-w-0 flex-1 py-0')}
          data-testid="remove-who"
        >
          <option value="">{t('set.remove_who')}</option>
          {members.map((m) => (
            <option key={m.memberId} value={m.memberId}>
              {m.name}
            </option>
          ))}
        </select>
        <Button
          look={armed ? 'danger' : 'plain'}
          disabled={busy || who === ''}
          onClick={() => (armed ? void remove() : setArmed(true))}
          data-testid="remove-do"
        >
          <UserMinus size={18} aria-hidden="true" />
          <span className="min-w-0 truncate">
            {armed ? t('set.remove_sure', { name }) : t('set.remove_do')}
          </span>
        </Button>
      </div>
      {done !== null ? (
        <p className="m-0 text-sm text-muted" role="status" data-testid="remove-done">
          {t('set.remove_done', { name: done })}
        </p>
      ) : null}
      {error ? (
        <p className="error m-0 text-sm" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Ending the room.
 *
 * Last in the creator's fold, armed AND by name: the button does nothing
 * until the room's name has been typed back, and then wants a second press.
 * What it takes with it is every dad's — the pictures of their children are
 * the reason it exists — so it is the one thing here that asks more than a
 * tap. He lands in another room of his if he has one, or at the door.
 */
function Delete({ roomName }: { roomName: string }) {
  const { t } = useT();
  const [typed, setTyped] = useState('');
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Key | null>(null);

  async function go() {
    setBusy(true);
    setError(null);
    const result = await deleteRoom(typed);
    if (result !== 'deleted') {
      setBusy(false);
      setArmed(false);
      setError(result === 'wrong_name' ? 'set.delete_wrong' : 'set.delete_failed');
      return;
    }
    // His own rows went with the room, so the list is what is left of him.
    const next = (await fetchMyRooms().catch(() => []))[0];
    if (next !== undefined) await switchRoom(next.id).catch(() => false);
    location.reload();
  }

  return (
    <div className="grid grid-cols-1 gap-1.5">
      <label htmlFor="delete-name" className="text-[1.0625rem] font-semibold text-muted">
        {t('set.delete')}
      </label>
      <p className="m-0 text-sm text-muted">{t('set.delete_hint')}</p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id="delete-name"
          value={typed}
          onChange={(e) => {
            setTyped(e.target.value);
            setArmed(false);
          }}
          placeholder={t('set.delete_name')}
          autoComplete="off"
          className={cn(FIELD, 'min-w-0 flex-1')}
          data-testid="delete-name"
        />
        <Button
          look={armed ? 'danger' : 'plain'}
          disabled={busy || typed.trim() === ''}
          onClick={() => (armed ? void go() : setArmed(true))}
          data-testid="delete-do"
        >
          <Trash2 size={18} aria-hidden="true" />
          <span className="min-w-0 truncate">
            {armed ? t('set.delete_sure', { room: roomName }) : t('set.delete_do')}
          </span>
        </Button>
      </div>
      {error ? (
        <p className="error m-0 text-sm" role="alert">
          {t(error)}
        </p>
      ) : null}
    </div>
  );
}
