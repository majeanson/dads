import {
  CalendarCheck,
  CalendarClock,
  MessageCircleQuestion,
  Search,
  Send,
  Settings as SettingsIcon,
  Spade,
} from 'lucide-react';
import type { RoomsOpen } from '../shared/protocol';
import type { DadNight } from '../shared/dadNight';
import type { Todo } from './api';
import { nightItem } from './NightEditor';
import { useT } from './i18n';
import { Button } from './ui/Button';

/** What is open over the room, if anything. */
export type SheetName =
  'menu' | 'here' | 'prompts' | 'board' | 'night' | 'find' | 'invite' | 'settings';

/**
 * One shape for every row in the menu.
 *
 * Taller than a button elsewhere in the app and set in a larger face: this is
 * a list a thumb picks from on a phone, at arm's length, usually one-handed,
 * and the rows are the whole content of the screen. The radius is home's
 * control radius, so the two screens a dad actually touches agree with each
 * other.
 */
const ITEM = 'h-16 gap-3.5 rounded-[var(--radius-control)] px-4 text-[1.125rem]';

/**
 * Everything the app can do that is not the conversation or the call, as a
 * list of plain rows in the order a dad is likely to want them.
 *
 * It lives in two places. On HOME it is on the screen itself, under the night
 * and the door, in what used to be empty space — so nothing there is behind a
 * button, and what is waiting for him is said in words on the row it belongs
 * to. In the CONVERSATION it is behind the Menu button, because every row it
 * would take there is a row of conversation.
 *
 * The marks say WHICH thing is waiting, in words, where a dot used to be: a
 * mark says "something", and something is what makes a man ignore it. A mark
 * for something somebody else did would be noise, and a number invites him to
 * drive it to zero.
 */
export function Menu({
  view,
  rooms,
  todo,
  night,
  now,
  tableOpen,
  onToggleTable,
  onOpen,
}: {
  /** Which screen it is on, which decides whether the table is offered. */
  view: 'home' | 'talk';
  rooms: RoomsOpen;
  todo: Todo;
  night: DadNight | null;
  /** A coarse clock, so the night item's countdown stays honest. */
  now: number;
  tableOpen: boolean;
  onToggleTable: () => void;
  /** Opens a sheet; null closes whatever this menu is sitting in. */
  onOpen: (sheet: SheetName | null) => void;
}) {
  const { t, lang } = useT();

  return (
    <nav className="menu" aria-label="Rooms">
      {rooms.questions ? (
        <Button block className={ITEM} onClick={() => onOpen('prompts')}>
          <MessageCircleQuestion size={22} aria-hidden="true" className="text-muted" />
          {t('menu.questions')}
          {todo.prompt ? (
            <span className="ml-auto text-sm font-normal text-accent" data-testid="mark-prompts">
              {t('menu.prompt_waiting')}
            </span>
          ) : null}
        </Button>
      ) : null}

      {rooms.week ? (
        <Button block className={ITEM} onClick={() => onOpen('board')}>
          <CalendarCheck size={22} aria-hidden="true" className="text-muted" />
          {t('menu.week')}
          {todo.board ? (
            <span className="ml-auto text-sm font-normal text-accent" data-testid="mark-board">
              {t('menu.board_waiting')}
            </span>
          ) : null}
        </Button>
      ) : null}

      {/* Only from the conversation: the table takes the room's place on a
          phone and sits beside it on a laptop, and from home there is no room
          for it to take. */}
      {rooms.table && view === 'talk' ? (
        <Button
          block
          className={ITEM}
          onClick={() => {
            onToggleTable();
            onOpen(null);
          }}
        >
          <Spade size={22} aria-hidden="true" className="text-muted" />
          {tableOpen ? t('menu.close_table') : t('menu.open_table')}
        </Button>
      ) : null}

      <Button block className={ITEM} data-testid="dad-night" onClick={() => onOpen('night')}>
        <CalendarClock size={22} aria-hidden="true" className="text-muted" />
        {nightItem(t, lang, night, now)}
      </Button>

      {/* The way back to what was said before the backfill: the room hands
          over five hundred lines and the archive keeps every one, so for five
          men talking for a year this is the only door to most of it. */}
      <Button block className={ITEM} onClick={() => onOpen('find')}>
        <Search size={22} aria-hidden="true" className="text-muted" />
        {t('menu.find')}
      </Button>

      {/* Second from the bottom, not first: the room is for the dads who are
          already in it. But it is in the menu at all because everything else
          in this app is worth nothing until the other four are here. */}
      <Button block className={ITEM} onClick={() => onOpen('invite')}>
        <Send size={22} aria-hidden="true" className="text-muted" />
        {t('menu.invite')}
      </Button>

      <Button block className={ITEM} onClick={() => onOpen('settings')}>
        <SettingsIcon size={22} aria-hidden="true" className="text-muted" />
        {t('menu.settings')}
      </Button>
    </nav>
  );
}
