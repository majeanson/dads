import {
  CalendarCheck,
  DoorOpen,
  MessageCircleQuestion,
  Search,
  Send,
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
 * The rest of the app, as rows — and which rows depends on where he is.
 *
 * HOME is about the group and the week: the questions, the week, bringing
 * somebody in, and the settings. The night is not a row here because the
 * card above IS the night, and it carries its own way into the sheet.
 *
 * The CONVERSATION carries the FULL menu: the questions (answering one posts
 * a line), the week, the table, finding a line said before the backfill, the
 * invite and the settings. Home's is the shorter one — a man standing on home
 * is one tap from the conversation, but a man in the conversation should not
 * have to walk back out to change a setting or bring somebody in (2026-09-16;
 * it used to hold only the talking rows, and a dad told "your week to fill
 * in" mid-conversation had to leave it to do so).
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
  tableOpen,
  mine,
  onToggleTable,
  onOpen,
}: {
  /** Which screen it is on, which decides which rows it holds. */
  view: 'home' | 'talk';
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
  const home = view === 'home';

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
          laptop; from home there is no room for it to take. */}
      {!home && rooms.table ? (
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
          men talking for a year this is the only door to most of it. It is
          about the conversation, so it is offered from the conversation. */}
      {!home ? (
        <Button block look="quiet" className={ROW} onClick={() => onOpen('find')}>
          <Search size={22} aria-hidden="true" className="shrink-0 text-muted" />
          <span className="min-w-0 truncate">{t('menu.find')}</span>
        </Button>
      ) : null}

      {/* Second from the bottom, not first: the room is for the dads who are
          already in it. But it is here at all because everything else in this
          app is worth nothing until the other four are here. */}
      <Button block look="quiet" className={ROW} onClick={() => onOpen('invite')}>
        <Send size={22} aria-hidden="true" className="shrink-0 text-muted" />
        <span className="min-w-0 truncate">{t('menu.invite')}</span>
      </Button>

      {/* In the conversation only, like Find — home holds the short menu and
          a fifth row there puts the door off the bottom of a 667px phone,
          which the fit suite measures. Always present with one room, though,
          because this is also the only way to get ANOTHER: a man already
          inside cannot reach the door, and starting a room lives on the door.
          The count appears when there is something to count. */}
      {!home ? (
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
      ) : null}

      <Button block look="quiet" className={ROW} onClick={() => onOpen('settings')}>
        <SettingsIcon size={22} aria-hidden="true" className="shrink-0 text-muted" />
        <span className="min-w-0 truncate">{t('menu.settings')}</span>
      </Button>
    </nav>
  );
}
