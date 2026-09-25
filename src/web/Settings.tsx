import { LogOut } from 'lucide-react';
import { useState } from 'react';
import { setRooms } from './api';
import { useT } from './i18n';
import { Remind } from './Remind';
import { Toggles } from './Toggles';
import { You } from './You';
import { Button } from './ui/Button';
import { Switch } from './ui/Switch';
import type { RoomsOpen, RosterEntry } from '../shared/protocol';
import { TheRoom } from './TheRoom';

/**
 * Everything a dad might ever change, in one place.
 *
 * Two kinds of thing, and the difference matters enough to be a heading each:
 * what the GROUP has open, which any dad may change and all of them then see,
 * and what THIS dad reads it in, which is his alone and lives on his device.
 */
export function Settings({
  rooms,
  you,
  mine,
  ownerName,
  members,
  onSignOut,
}: {
  rooms: RoomsOpen;
  /** Him. His face and his pair are read by `You` from the room's members. */
  you: { memberId: string; name: string };
  /** Whether the three switches are his: he opened the room, or the room has
   * no creator and they are everybody's, as they were before creators. */
  mine: boolean;
  /** Who did open it, when it was not him. Empty if the room has no creator. */
  ownerName: string;
  /** Everyone in the group, for handing the room to one of them. */
  members: RosterEntry[];
  onSignOut: () => void;
}) {
  const { t } = useT();
  // Optimistic: the switch answers the finger, and the socket brings everyone
  // else's copy along a moment later.
  const [shown, setShown] = useState(rooms);
  const [busy, setBusy] = useState(false);

  async function toggle(key: keyof RoomsOpen) {
    if (!mine) return;
    const next = { ...shown, [key]: !shown[key] };
    setShown(next);
    setBusy(true);
    try {
      await setRooms({ [key]: next[key] });
    } catch {
      setShown(shown);
    } finally {
      setBusy(false);
    }
  }

  const rows: { key: keyof RoomsOpen; label: string }[] = [
    { key: 'questions', label: t('menu.questions') },
    { key: 'week', label: t('menu.week') },
    { key: 'table', label: t('set.table') },
  ];

  return (
    <div className="settings grid gap-4" data-testid="settings">
      {/* First, because it is the only thing in here that is about HIM rather
          than about the software, and because a man's own name above the
          group's switches is the right way round. */}
      <section>
        <h2 className="mb-1 text-[1.0625rem] font-semibold text-muted">{t('you.title')}</h2>
        <You memberId={you.memberId} name={you.name} />
      </section>

      <section>
        <h2 className="mb-1 text-[1.0625rem] font-semibold text-muted">{t('set.rooms')}</h2>
        {/* These three decide what the room IS, so they belong to the man who
            opened it. Said in words rather than shown as three dead switches
            with no explanation: a control a dad cannot work is a control that
            needs to say why. A room with no creator says nothing, because
            there is nothing to say — they are everybody's, as they were. */}
        {ownerName === '' ? null : (
          <p className="m-0 mb-1 text-sm text-muted" data-testid="rooms-owner">
            {mine ? t('set.yours_to_change') : t('set.owner', { name: ownerName })}
          </p>
        )}
        <div className="border-t border-line">
          {rows.map((row) => (
            <Switch
              key={row.key}
              label={row.label}
              checked={shown[row.key]}
              disabled={busy || !mine}
              onChange={() => void toggle(row.key)}
              testId={`room-${row.key}`}
            />
          ))}
        </div>

        {/* The rest of owning a room, and only for the man who does: the word
            that opens it, and handing it on. A room with no creator shows
            neither, because there is nobody they would belong to. */}
        {mine && ownerName !== '' ? (
          <div className="mt-4">
            <TheRoom members={members} you={you.memberId} />
          </div>
        ) : null}
      </section>

      <section>
        <h2 className="mb-1 text-[1.0625rem] font-semibold text-muted">{t('set.yours')}</h2>
        {/* One list, one shape. Language, theme and the reminder are three
            answers to three questions, and they now look like it. */}
        <div className="border-t border-line">
          <Toggles />
          <Remind />
        </div>
      </section>

      {/* Last, and quiet: a dad signs out of this app about once. */}
      <Button look="quiet" onClick={onSignOut} className="justify-self-start px-0">
        <LogOut size={20} aria-hidden="true" />
        {t('menu.sign_out')}
      </Button>
    </div>
  );
}
