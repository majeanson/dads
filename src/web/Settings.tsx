import {
  ChevronDown,
  ChevronRight,
  LogOut,
  Send,
  SlidersHorizontal,
  Smartphone,
  House,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { GLASSES, type RoomsOpen, type RosterEntry } from '../shared/protocol';
import { deviceSummary, roomSummary } from '../shared/settingsSummary';
import { setRooms } from './api';
import { settleFlips, shownSwitches, withoutFlip, type Flips } from './flips';
import { BuildLabel } from './BuildLabel';
import { hashedColour } from './dadColour';
import { Face } from './Face';
import { useT } from './i18n';
import { useMember } from './members';
import { pushShape } from './push';
import { Remind } from './Remind';
import { parseTextSize } from './textSizeValue';
import { TheRoom } from './TheRoom';
import { Toggles } from './Toggles';
import { Button } from './ui/Button';
import { cn } from './ui/cn';
import { Leaf } from './ui/Leaf';
import { Switch } from './ui/Switch';
import { useBackCloses } from './useBackCloses';
import { You } from './You';

/** The three screens behind the list. */
type LeafName = 'you' | 'room' | 'device';

/**
 * A row of the first screen: the menu's shape (one grouped list, the rows
 * hairlines inside it), a word on what is behind it, and a chevron saying it
 * goes somewhere. Taller than a menu row on a small phone because it carries
 * two lines, and 64px everywhere so the four rows read as one list.
 */
const ROW =
  'h-auto min-h-16 gap-3.5 rounded-none px-4 py-2 text-left text-[1.125rem] text-ink whitespace-normal hover:bg-paper hover:text-ink active:scale-100 active:bg-paper focus-visible:-outline-offset-3';

function Door({
  icon,
  label,
  summary,
  onClick,
  testId,
  accent = false,
}: {
  icon: ReactNode;
  label: string;
  summary?: string;
  onClick: () => void;
  testId: string;
  /** The one row that is an action rather than a place: inviting. */
  accent?: boolean;
}) {
  return (
    <Button block look="quiet" className={ROW} onClick={onClick} data-testid={testId}>
      {icon}
      <span className="grid min-w-0 flex-1">
        <span className={cn('min-w-0 truncate', accent && 'font-semibold text-accent')}>
          {label}
        </span>
        {summary ? (
          <span
            className="min-w-0 truncate text-sm font-normal text-muted"
            data-testid={`${testId}-summary`}
          >
            {summary}
          </span>
        ) : null}
      </span>
      <ChevronRight size={20} aria-hidden="true" className="shrink-0 text-muted" />
    </Button>
  );
}

/**
 * Everything a dad might ever change, as four doors (Marc, 2026-11-02:
 * "arrange settings differently so it's less cluttered").
 *
 * It was one long sheet — him, the room, this device — tuned to fill a 667px
 * phone to the pixel, with folds inside folds to get there. Now the first
 * screen is a short list: him, inviting somebody, the room, this device, and
 * the quiet line with sign out. Each row opens a leaf inside the same sheet,
 * the way a name in "Who's here" opens a profile, with the way back at the
 * top. On Android the phone's back button is that way back first, and only
 * then closes the sheet.
 *
 * The difference the old headings drew still holds, one leaf each: what the
 * GROUP has open, which the creator changes and everybody sees, and what THIS
 * dad reads it in, which is his alone and lives on his device.
 */
export function Settings({
  rooms,
  you,
  mine,
  ownerName,
  roomName,
  members,
  onInvite,
  onLink,
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
  /** This room's name, which deleting it asks to have typed back. */
  roomName: string;
  /** Everyone in the group, for handing the room to one of them. */
  members: RosterEntry[];
  /** Opens the invite sheet. */
  onInvite: () => void;
  /** Opens "Use on another device". */
  onLink: () => void;
  onSignOut: () => void;
}) {
  const { t, lang } = useT();
  const me = useMember(you.memberId);
  // Optimistic: the switch answers the finger, and the socket brings everyone
  // else's copy along a moment later. Only his own flips are kept here, on top
  // of `rooms`, so a switch flipped on another phone while this sheet is open
  // shows here too (it was a copy taken once, on open). See flips.ts.
  const [flips, setFlips] = useState<Flips>({});
  const shown = shownSwitches(rooms, flips);
  const [busy, setBusy] = useState(false);
  /** The word and the handover, shown only once the creator asks. */
  const [owning, setOwning] = useState(false);
  const [leaf, setLeaf] = useState<LeafName | null>(null);
  /** Whether this device is told when something is on, for the summary. */
  const [reminding, setReminding] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const cameFrom = useRef<LeafName | null>(null);

  // A leaf is a layer of its own: Android's back returns to the list before
  // it closes the sheet. The sheet's Close still closes everything.
  useBackCloses(leaf !== null, () => setLeaf(null));

  useEffect(() => {
    if (leaf !== null) return;
    // Read again each time the list shows, because the switch for it lives
    // in the leaf he may just have come back from.
    let cancelled = false;
    pushShape()
      .then((s) => !cancelled && setReminding(s.kind === 'ready' && s.on))
      .catch(() => undefined);
    // Back on the list, the focus goes to the row he left by, not to the top
    // of the page: the button that had it is gone.
    const from = cameFrom.current;
    cameFrom.current = null;
    if (from !== null) {
      list.current
        ?.querySelector<HTMLElement>(`[data-testid="settings-${from}"]`)
        ?.focus({ preventScroll: true });
    }
    return () => {
      cancelled = true;
    };
  }, [leaf]);

  function open(next: LeafName) {
    cameFrom.current = next;
    setLeaf(next);
  }

  // A flip stands until the room says the same thing.
  useEffect(() => setFlips((now) => settleFlips(rooms, now)), [rooms]);

  async function toggle(key: keyof RoomsOpen) {
    if (!mine) return;
    const value = !shown[key];
    setFlips((now) => ({ ...now, [key]: value }));
    setBusy(true);
    try {
      await setRooms({ [key]: value });
    } catch {
      setFlips((now) => withoutFlip(now, key));
    } finally {
      setBusy(false);
    }
  }

  const back = () => setLeaf(null);

  if (leaf === 'you') {
    return (
      <Leaf back={t('set.title')} onBack={back} title={t('you.title')} testId="settings-leaf-you">
        <You memberId={you.memberId} name={you.name} />
      </Leaf>
    );
  }

  if (leaf === 'room') {
    const switches: { key: keyof RoomsOpen; label: string }[] = [
      { key: 'questions', label: t('menu.questions') },
      { key: 'week', label: t('menu.week') },
      { key: 'table', label: t('set.table') },
    ];
    const owner = mine && ownerName !== '';
    return (
      <Leaf
        back={t('set.title')}
        onBack={back}
        title={roomName || t('set.rooms')}
        testId="settings-leaf-room"
      >
        <div>
          <h3 className="m-0 mb-1 text-[1.0625rem] font-semibold text-muted">
            {t('set.features')}
          </h3>
          {/* These three decide what the room IS, so they belong to the man
              who opened it. Said in words rather than shown as three dead
              switches with no explanation: a control a dad cannot work is a
              control that needs to say why. A room with no creator says
              nothing, because there is nothing to say — they are
              everybody's, as they were. */}
          {ownerName === '' || mine ? null : (
            <p className="m-0 mb-1 text-sm text-muted" data-testid="rooms-owner">
              {t('set.owner', { name: ownerName })}
            </p>
          )}
          <div className="border-t border-line">
            {switches.map((row) => (
              <Switch
                key={row.key}
                label={row.label}
                checked={shown[row.key]}
                disabled={busy || !mine}
                onChange={() => void toggle(row.key)}
                testId={`room-${row.key}`}
              />
            ))}
            {/* The rest of owning a room, and only for the man who does: the
                word that opens it, handing it on, taking a dad out, deleting
                it. Folded still, though the leaf has the room: four forms
                with a paragraph each are a long way to scroll past for a
                creator who came to flip a switch, and they mount only once
                he asks. A room with no creator shows none of it, because
                there is nobody it would belong to. */}
            {owner ? (
              <button
                type="button"
                className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-3 border-b border-line py-2 text-left text-[1.0625rem] text-ink"
                aria-expanded={owning}
                onClick={() => setOwning((o) => !o)}
                data-testid="room-owning"
              >
                <span className="min-w-0 truncate" data-testid="rooms-owner">
                  {t('set.owning')}
                </span>
                <ChevronDown
                  size={20}
                  aria-hidden="true"
                  className={cn('shrink-0 text-muted transition-transform', owning && 'rotate-180')}
                />
              </button>
            ) : null}
          </div>
          {owner && owning ? (
            <div className="mt-3">
              <TheRoom members={members} you={you.memberId} roomName={roomName} />
            </div>
          ) : null}
        </div>
      </Leaf>
    );
  }

  if (leaf === 'device') {
    return (
      <Leaf
        back={t('set.title')}
        onBack={back}
        title={t('set.yours')}
        testId="settings-leaf-device"
      >
        {/* One list, one shape. Language, theme, the size of the words and
            the reminder are four answers to four questions, and they look
            like it. */}
        <div className="border-t border-line">
          <Toggles />
          <Remind />
          {/* Being him on another phone is about HIM and this device both, and
              it is what a dad looks for the day he gets a new phone or adds
              the home-screen app: here, beside the other things about this
              phone, and still in the Menu where it always was. */}
          <button
            type="button"
            className="flex min-h-[clamp(2.75rem,6dvh,4rem)] w-full cursor-pointer items-center gap-3 border-b border-line py-2 text-left text-[1.125rem] text-ink"
            onClick={onLink}
            data-testid="settings-link"
          >
            <Smartphone size={20} aria-hidden="true" className="shrink-0 text-muted" />
            <span className="min-w-0 flex-1 truncate">{t('link.title')}</span>
            <ChevronRight size={20} aria-hidden="true" className="shrink-0 text-muted" />
          </button>
        </div>
      </Leaf>
    );
  }

  // What the device leaf chose, read off the page rather than kept twice:
  // the theme and the text size are stamped on <html> the moment they are
  // picked, and that stamp is what the screen is actually showing.
  const root = document.documentElement.dataset;
  const theme = root.theme === 'light' || root.theme === 'dark' ? root.theme : 'system';
  const pair = me?.glasses ?? GLASSES[0];
  const colour = me?.colour ?? hashedColour(you.memberId);

  return (
    <div className="settings grid gap-3" data-testid="settings" ref={list}>
      <nav className="menu" aria-label={t('set.title')}>
        {/* Him first: the only row about a person rather than the software,
            and a man's own name above the group's switches is the right way
            round. */}
        <Door
          icon={<Face memberId={you.memberId} size={32} />}
          label={you.name}
          summary={`${t(`glasses.${pair}`)} · ${t(`colour.${colour}` as 'colour.1')}`}
          onClick={() => open('you')}
          testId="settings-you"
        />
        {/* Bringing somebody in (2026-09-25): reached from home's corner as
            well as the Menu. Any dad may invite — it is not one of the
            creator's switches — and it is the one row that does something
            rather than opening a page, so it is the one in the accent. */}
        <Door
          icon={<Send size={22} aria-hidden="true" className="shrink-0 text-accent" />}
          label={t('menu.invite')}
          onClick={onInvite}
          testId="settings-invite"
          accent
        />
        <Door
          icon={<House size={22} aria-hidden="true" className="shrink-0 text-muted" />}
          label={roomName || t('set.rooms')}
          summary={
            !mine && ownerName !== ''
              ? t('set.owned_by', { name: ownerName })
              : roomSummary(lang, shown)
          }
          onClick={() => open('room')}
          testId="settings-room"
        />
        <Door
          icon={<SlidersHorizontal size={22} aria-hidden="true" className="shrink-0 text-muted" />}
          label={t('set.yours')}
          summary={deviceSummary(lang, theme, parseTextSize(root.text), reminding)}
          onClick={() => open('device')}
          testId="settings-device"
        />
      </nav>
      {/* Signing out is about THIS device, and a dad does it about once: one
          quiet line, with the build beside it — which phone is running which
          build is a question for the day something looks wrong, not for
          every visit. */}
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          className="flex min-h-11 cursor-pointer items-center gap-2 text-left text-[1.0625rem] text-muted"
          onClick={onSignOut}
          data-testid="settings-sign-out"
        >
          <LogOut size={18} aria-hidden="true" className="shrink-0" />
          {t('menu.sign_out')}
        </button>
        <BuildLabel />
      </div>
    </div>
  );
}
