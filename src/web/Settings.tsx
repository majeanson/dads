import { ChevronDown, ChevronRight, LogOut, Send } from 'lucide-react';
import { useState } from 'react';
import { setRooms } from './api';
import { useT } from './i18n';
import { Remind } from './Remind';
import { Toggles } from './Toggles';
import { You } from './You';
import { cn } from './ui/cn';
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
  onInvite,
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
  /** Opens the invite sheet. */
  onInvite: () => void;
  onSignOut: () => void;
}) {
  const { t } = useT();
  // Optimistic: the switch answers the finger, and the socket brings everyone
  // else's copy along a moment later.
  const [shown, setShown] = useState(rooms);
  const [busy, setBusy] = useState(false);
  /** The word and the handover, shown only once the creator asks. */
  const [owning, setOwning] = useState(false);

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
        {/* The heading's row is the one place the rest of owning a room —
            the word, and handing it on — can live without costing the sheet
            a pixel: a joined dad's Settings fills a 667px phone exactly, so
            for the creator a paragraph, a row, even a sentence of its own
            put it past the bottom. The control sits beside the heading, its
            hit area reaching beyond the line the way the header's count
            does, and the two forms mount only once he opens it. */}
        <div className="mb-1 flex items-baseline justify-between gap-3">
          <h2 className="m-0 text-[1.0625rem] font-semibold text-muted">{t('set.rooms')}</h2>
          {mine && ownerName !== '' ? (
            <button
              type="button"
              className="-my-2.5 flex min-h-11 min-w-0 cursor-pointer items-center gap-1 text-sm text-muted"
              aria-expanded={owning}
              onClick={() => setOwning((o) => !o)}
              data-testid="room-owning"
            >
              <span className="min-w-0 truncate" data-testid="rooms-owner">
                {t('set.owning')}
              </span>
              <ChevronDown
                size={16}
                aria-hidden="true"
                className={cn('shrink-0 transition-transform', owning && 'rotate-180')}
              />
            </button>
          ) : null}
        </div>
        {/* These three decide what the room IS, so they belong to the man who
            opened it. Said in words rather than shown as three dead switches
            with no explanation: a control a dad cannot work is a control that
            needs to say why. A room with no creator says nothing, because
            there is nothing to say — they are everybody's, as they were. */}
        {ownerName === '' || mine ? null : (
          <p className="m-0 mb-1 text-sm text-muted" data-testid="rooms-owner">
            {t('set.owner', { name: ownerName })}
          </p>
        )}
        <div className="border-t border-line">
          {/* Bringing somebody in, first in the room's list (2026-09-25): it
              lived on home's menu and in the conversation's, and now lives
              here, reached from home's corner as well as the Menu. Any dad
              may invite — it is not one of the creator's switches. */}
          <button
            type="button"
            className="flex min-h-[clamp(2.75rem,6dvh,4rem)] w-full cursor-pointer items-center gap-3 border-b border-line py-2.5 text-left text-[1.125rem] text-ink"
            onClick={onInvite}
            data-testid="settings-invite"
          >
            <Send size={20} aria-hidden="true" className="shrink-0 text-muted" />
            <span className="min-w-0 flex-1 truncate">{t('menu.invite')}</span>
            <ChevronRight size={20} aria-hidden="true" className="shrink-0 text-muted" />
          </button>
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
        {mine && ownerName !== '' && owning ? (
          <div className="mt-3">
            <TheRoom members={members} you={you.memberId} />
          </div>
        ) : null}
      </section>

      <section>
        {/* Signing out sits on this heading's row, quiet: a dad does it about
            once, it is about THIS device, and a row of its own was the pixels
            the invite above now spends — Settings fills a 667px phone. */}
        <div className="mb-1 flex items-baseline justify-between gap-3">
          <h2 className="m-0 text-[1.0625rem] font-semibold text-muted">{t('set.yours')}</h2>
          <button
            type="button"
            className="-my-2.5 flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 text-sm text-muted"
            onClick={onSignOut}
          >
            <LogOut size={16} aria-hidden="true" />
            {t('menu.sign_out')}
          </button>
        </div>
        {/* One list, one shape. Language, theme and the reminder are three
            answers to three questions, and they now look like it. */}
        <div className="border-t border-line">
          <Toggles />
          <Remind />
        </div>
      </section>
    </div>
  );
}
