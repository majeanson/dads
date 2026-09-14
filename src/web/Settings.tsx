import { LogOut } from 'lucide-react';
import { useState } from 'react';
import { setRooms } from './api';
import { useT } from './i18n';
import { Remind } from './Remind';
import { Toggles } from './Toggles';
import { You } from './You';
import { Button } from './ui/Button';
import { Switch } from './ui/Switch';
import type { RoomsOpen } from '../shared/protocol';

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
  onSignOut,
}: {
  rooms: RoomsOpen;
  /** Him, from the roster — which is where his face's version lives. */
  you: { memberId: string; name: string; face?: number };
  onSignOut: () => void;
}) {
  const { t } = useT();
  // Optimistic: the switch answers the finger, and the socket brings everyone
  // else's copy along a moment later.
  const [shown, setShown] = useState(rooms);
  const [busy, setBusy] = useState(false);

  async function toggle(key: keyof RoomsOpen) {
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
    <div className="settings grid gap-6" data-testid="settings">
      {/* First, because it is the only thing in here that is about HIM rather
          than about the software, and because a man's own name above the
          group's switches is the right way round. */}
      <section>
        <h2 className="mb-2 text-[0.9375rem] font-semibold text-muted">{t('you.title')}</h2>
        <You memberId={you.memberId} name={you.name} face={you.face} />
      </section>

      <section>
        <h2 className="mb-2 text-[0.9375rem] font-semibold text-muted">{t('set.rooms')}</h2>
        {/* Any dad, like the night: there is no admin in a room of five
            friends, and inventing one for three switches would be inventing
            one. */}
        <div className="border-t border-line">
          {rows.map((row) => (
            <Switch
              key={row.key}
              label={row.label}
              checked={shown[row.key]}
              disabled={busy}
              onChange={() => void toggle(row.key)}
              testId={`room-${row.key}`}
            />
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-[0.9375rem] font-semibold text-muted">{t('set.yours')}</h2>
        {/* One list, one shape. Language, theme and the reminder are three
            answers to three questions, and they now look like it. */}
        <div className="border-t border-line">
          <Toggles />
          <Remind />
        </div>
      </section>

      {/* Last, and quiet: a dad signs out of this app about once. */}
      <Button look="quiet" onClick={onSignOut} className="justify-self-start px-0">
        <LogOut size={16} aria-hidden="true" />
        {t('menu.sign_out')}
      </Button>
    </div>
  );
}
