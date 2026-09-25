import {
  CalendarCheck,
  DoorOpen,
  MessageCircleQuestion,
  Search,
  Settings as SettingsIcon,
  Spade,
} from 'lucide-react';
import type { RoomsOpen } from '../shared/protocol';
import type { Todo } from './api';
import { useT } from './i18n';
import { Button } from './ui/Button';

/** What is open over the room, if anything. */
export type SheetName =
  'menu' | 'here' | 'prompts' | 'board' | 'night' | 'find' | 'invite' | 'rooms' | 'settings';

/**
 * One shape for every row in the menu.
 *
 * Taller than a button elsewhere in the app and set in a larger face: this is
 * a list a thumb picks from on a phone, at arm's length, usually one-handed,
 * and the rows are the whole content of the screen. The radius is home's
 * control radius, so the two screens a dad actually touches agree with each
 * other.
 */
export const ITEM =
  'h-[clamp(2.75rem,6dvh,4rem)] gap-3.5 rounded-[var(--radius-control)] px-4 text-[1.125rem]';

/**
 * A row of the menu itself, which is one grouped list rather than a stack of
 * boxes: the list draws the edge and the hairlines, and a row is only a place
 * to press. Same height and type as `ITEM`, so a list elsewhere that still
 * uses boxed rows reads as the same family.
 */
const ROW =
  'h-[clamp(2.75rem,6dvh,4rem)] gap-3.5 rounded-none px-4 text-[1.125rem] text-ink hover:bg-paper hover:text-ink active:scale-100 active:bg-paper focus-visible:-outline-offset-3';

/**
 * The rest of the app, as rows, behind the conversation's Menu button.
 *
 * Home holds none of it (2026-09-25): home is the night and the way in, with
 * Settings as an icon in its corner — and bringing somebody in lives inside
 * Settings, from either screen. Everything else is here, where a man mid-
 * conversation can reach it without walking back out.
 *
 * The marks say WHICH thing is waiting, in words, where a dot used to be: a
 * mark says "something", and something is what makes a man ignore it. A mark
 * for something somebody else did would be noise, and a number invites him to
 * drive it to zero.
 */
export function Menu({
  rooms,
  todo,
  tableOpen,
  mine,
  onToggleTable,
  onOpen,
}: {
  rooms: RoomsOpen;
  todo: Todo;
  tableOpen: boolean;
  /** How many rooms this phone is in. One is the normal answer. */
  mine: number;
  onToggleTable: () => void;
  /** Opens a sheet; null closes whatever this menu is sitting in. */
  onOpen: (sheet: SheetName | null) => void;
}) {
  const { t } = useT();

  return (
    <nav className="menu" aria-label="Rooms">
      {rooms.questions ? (
        <Button block look="quiet" className={ROW} onClick={() => onOpen('prompts')}>
          <MessageCircleQuestion size={22} aria-hidden="true" className="shrink-0 text-muted" />
          <span className="min-w-0 truncate">{t('menu.questions')}</span>
          {todo.prompt ? (
            <span
              className="ml-auto min-w-0 truncate text-sm font-normal text-accent"
              data-testid="mark-prompts"
            >
              {t('menu.prompt_waiting')}
            </span>
          ) : null}
        </Button>
      ) : null}

      {rooms.week ? (
        <Button block look="quiet" className={ROW} onClick={() => onOpen('board')}>
          <CalendarCheck size={22} aria-hidden="true" className="shrink-0 text-muted" />
          <span className="min-w-0 truncate">{t('menu.week')}</span>
          {todo.board ? (
            <span
              className="ml-auto min-w-0 truncate text-sm font-normal text-accent"
              data-testid="mark-board"
            >
              {t('menu.board_waiting')}
            </span>
          ) : null}
        </Button>
      ) : null}

      {/* The table takes the room's place on a phone and sits beside it on a
          laptop. */}
      {rooms.table ? (
        <Button
          block
          look="quiet"
          className={ROW}
          onClick={() => {
            onToggleTable();
            onOpen(null);
          }}
        >
          <Spade size={22} aria-hidden="true" className="shrink-0 text-muted" />
          <span className="min-w-0 truncate">
            {tableOpen ? t('menu.close_table') : t('menu.open_table')}
          </span>
        </Button>
      ) : null}

      {/* The way back to what was said before the backfill: the room hands
          over five hundred lines and the archive keeps every one, so for five
          men talking for a year this is the only door to most of it. */}
      <Button block look="quiet" className={ROW} onClick={() => onOpen('find')}>
        <Search size={22} aria-hidden="true" className="shrink-0 text-muted" />
        <span className="min-w-0 truncate">{t('menu.find')}</span>
      </Button>

      {/* Present with one room, because this is also the only way to get
          ANOTHER: a man already inside cannot reach the door, and starting a
          room lives on the door. The count appears when there is something
          to count. */}
      <Button
        block
        look="quiet"
        className={ROW}
        onClick={() => onOpen('rooms')}
        data-testid="menu-rooms"
      >
        <DoorOpen size={22} aria-hidden="true" className="shrink-0 text-muted" />
        <span className="min-w-0 truncate">{t('menu.rooms')}</span>
        {mine > 1 ? (
          <span className="ml-auto shrink-0 text-sm font-normal text-muted">{mine}</span>
        ) : null}
      </Button>

      <Button block look="quiet" className={ROW} onClick={() => onOpen('settings')}>
        <SettingsIcon size={22} aria-hidden="true" className="shrink-0 text-muted" />
        <span className="min-w-0 truncate">{t('menu.settings')}</span>
      </Button>
    </nav>
  );
}
