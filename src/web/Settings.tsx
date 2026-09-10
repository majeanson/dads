import { useState } from 'react';
import { setRooms } from './api';
import { useT } from './i18n';
import { NightEditor } from './NightEditor';
import { Remind } from './Remind';
import { Toggles } from './Toggles';
import { Switch } from './ui/Switch';
import type { DadNight } from '../shared/dadNight';
import type { RoomsOpen } from '../shared/protocol';

/**
 * Everything a dad might ever change, in one place.
 *
 * Two kinds of thing, and the difference matters enough to be a heading each:
 * what the GROUP has open, which any dad may change and all of them then see,
 * and what THIS dad reads it in, which is his alone and lives on his device.
 */
export function Settings({ night, rooms }: { night: DadNight | null; rooms: RoomsOpen }) {
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
    <div className="settings" data-testid="settings">
      <section>
        <h2 className="mb-2 text-sm font-semibold text-muted">{t('n.title')}</h2>
        <NightEditor night={night} onDone={() => {}} />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-muted">{t('set.rooms')}</h2>
        {/* Any dad, like the night: there is no admin in a room of five
            friends, and inventing one for three switches would be inventing
            one. */}
        <div className="grid gap-2">
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
        <h2 className="mb-2 text-sm font-semibold text-muted">{t('set.yours')}</h2>
        <Toggles />
        <Remind />
      </section>
    </div>
  );
}
