import {
  CalendarCheck,
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
export const ITEM =
  'h-[clamp(2.75rem,6dvh,4rem)] gap-3.5 rounded-[var(--radius-control)] px-4 text-[1.125rem]';

/**
 * The rest of the app, as rows — and which rows depends on where he is.
 *
 * HOME is about the group and the week: the questions, the week, bringing
 * somebody in, and the settings. The night is not a row here because the
 * card above IS the night, and it carries its own way into the sheet.
 *
 * The CONVERSATION is about talking: the questions (answering one posts a
 * line), the week, the table, and finding a line said before the backfill.
 * Nothing else — the invite and the settings are one tap back, and a menu
 * that offers everything everywhere is a menu a man has to read.
 *
 * The questions and the week are on both on purpose: they are the two things
 * a dad is asked to DO, and a man in the middle of the conversation who is
 * told "your week to fill in" should not have to leave it to do so.
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
  onToggleTable,
  onOpen,
}: {
  /** Which screen it is on, which decides which rows it holds. */
  view: 'home' | 'talk';
  rooms: RoomsOpen;
  todo: Todo;
  tableOpen: boolean;
  onToggleTable: () => void;
  /** Opens a sheet; null closes whatever this menu is sitting in. */
  onOpen: (sheet: SheetName | null) => void;
}) {
  const { t } = useT();
  const home = view === 'home';

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

      {/* The table takes the room's place on a phone and sits beside it on a
          laptop; from home there is no room for it to take. */}
      {!home && rooms.table ? (
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

      {/* The way back to what was said before the backfill: the room hands
          over five hundred lines and the archive keeps every one, so for five
          men talking for a year this is the only door to most of it. It is
          about the conversation, so it is offered from the conversation. */}
      {!home ? (
        <Button block className={ITEM} onClick={() => onOpen('find')}>
          <Search size={22} aria-hidden="true" className="text-muted" />
          {t('menu.find')}
        </Button>
      ) : null}

      {/* Second from the bottom, not first: the room is for the dads who are
          already in it. But it is here at all because everything else in this
          app is worth nothing until the other four are here. */}
      {home ? (
        <Button block className={ITEM} onClick={() => onOpen('invite')}>
          <Send size={22} aria-hidden="true" className="text-muted" />
          {t('menu.invite')}
        </Button>
      ) : null}

      {home ? (
        <Button block className={ITEM} onClick={() => onOpen('settings')}>
          <SettingsIcon size={22} aria-hidden="true" className="text-muted" />
          {t('menu.settings')}
        </Button>
      ) : null}
    </nav>
  );
}
