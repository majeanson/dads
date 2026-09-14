import {
  CalendarCheck,
  CalendarClock,
  MessageCircleQuestion,
  Search,
  Send,
  Settings as SettingsIcon,
  Spade,
} from 'lucide-react';
import type { RoomMessage, RoomsOpen, RosterEntry, CallMember } from '../shared/protocol';
import type { DadNight } from '../shared/dadNight';
import type { Todo } from './api';
import { Board } from './Board';
import { Find } from './Find';
import { Here } from './Here';
import { Invite } from './Invite';
import { Night } from './Night';
import { nightItem } from './NightEditor';
import { PromptCard } from './PromptCard';
import { PromptList } from './PromptList';
import { Settings } from './Settings';
import { useT } from './i18n';
import { Button } from './ui/Button';
import { Sheet } from './ui/Sheet';

/** What is open over the room, if anything. */
export type SheetName =
  'menu' | 'here' | 'prompts' | 'board' | 'night' | 'find' | 'invite' | 'settings';

/**
 * Everything the app can do that is not the conversation or the call.
 *
 * There is no tab strip: tabs are a claim that four things matter equally, and
 * here they do not — dads came to talk. So each of these is one button away
 * and nothing at all until it is asked for, and each opens as a `Sheet`, which
 * is a native `<dialog>`: the focus trap, Escape, the inert background and the
 * backdrop all come from the platform.
 *
 * A sheet MOUNTS when it opens, so it reads fresh data every time rather than
 * showing what was true when the page loaded.
 */
/**
 * One shape for every row in the menu.
 *
 * Taller than a button elsewhere in the app and set in a larger face: this is
 * a list a thumb picks from on a phone, at arm's length, usually one-handed,
 * and the rows are the whole content of the screen. The radius is home's
 * control radius, so the two screens a dad actually touches agree with each
 * other.
 */
const ITEM = 'h-14 gap-3 rounded-[var(--radius-control)] px-4 text-[1.0625rem]';

export function Sheets({
  open,
  onOpen,
  you,
  youName,
  messages,
  roster,
  call,
  night,
  rooms,
  todo,
  now,
  tableOpen,
  faceOf,
  onToggleTable,
  onAnswerPrompt,
  canAnswer,
  onTodoChanged,
  onSignOut,
}: {
  open: SheetName | null;
  onOpen: (sheet: SheetName | null) => void;
  /** The reader's own member id. */
  you: string;
  youName: string;
  messages: RoomMessage[];
  roster: RosterEntry[];
  call: CallMember[];
  night: DadNight | null;
  rooms: RoomsOpen;
  todo: Todo;
  /** A coarse clock, so the night item's countdown stays honest. */
  now: number;
  tableOpen: boolean;
  faceOf: (memberId: string | null) => number | undefined;
  onToggleTable: () => void;
  onAnswerPrompt: (body: string) => boolean;
  canAnswer: boolean;
  onTodoChanged: () => void;
  onSignOut: () => void;
}) {
  const { t, lang } = useT();
  const close = () => onOpen(null);

  if (open === null) return null;

  if (open === 'menu') {
    return (
      <Sheet title={t('menu.title')} onClose={close}>
        <nav className="menu" aria-label="Rooms">
          {rooms.questions ? (
            <Button block className={ITEM} onClick={() => onOpen('prompts')}>
              <MessageCircleQuestion size={20} aria-hidden="true" className="text-muted" />
              {t('menu.questions')}
              {/* The reason, in words, where a dot used to be: a mark says
                  "something", and something is what makes a man ignore it. */}
              {todo.prompt ? (
                <span
                  className="ml-auto text-sm font-normal text-accent"
                  data-testid="mark-prompts"
                >
                  {t('menu.prompt_waiting')}
                </span>
              ) : null}
            </Button>
          ) : null}

          {rooms.week ? (
            <Button block className={ITEM} onClick={() => onOpen('board')}>
              <CalendarCheck size={20} aria-hidden="true" className="text-muted" />
              {t('menu.week')}
              {todo.board ? (
                <span className="ml-auto text-sm font-normal text-accent" data-testid="mark-board">
                  {t('menu.board_waiting')}
                </span>
              ) : null}
            </Button>
          ) : null}

          {rooms.table ? (
            <Button
              block
              className={ITEM}
              onClick={() => {
                onToggleTable();
                close();
              }}
            >
              <Spade size={20} aria-hidden="true" className="text-muted" />
              {tableOpen ? t('menu.close_table') : t('menu.open_table')}
            </Button>
          ) : null}

          <Button block className={ITEM} data-testid="dad-night" onClick={() => onOpen('night')}>
            <CalendarClock size={20} aria-hidden="true" className="text-muted" />
            {nightItem(t, lang, night, now)}
          </Button>

          {/* The way back to what was said before the backfill: the room hands
              over five hundred lines and the archive keeps every one, so for
              five men talking for a year this is the only door to most of it. */}
          <Button block className={ITEM} onClick={() => onOpen('find')}>
            <Search size={20} aria-hidden="true" className="text-muted" />
            {t('menu.find')}
          </Button>

          {/* Second from the bottom, not first: the room is for the dads who
              are already in it. But it is in the menu at all because
              everything else in this app is worth nothing until the other four
              are here. */}
          <Button block className={ITEM} onClick={() => onOpen('invite')}>
            <Send size={20} aria-hidden="true" className="text-muted" />
            {t('menu.invite')}
          </Button>

          <Button block className={ITEM} onClick={() => onOpen('settings')}>
            <SettingsIcon size={20} aria-hidden="true" className="text-muted" />
            {t('menu.settings')}
          </Button>
        </nav>
      </Sheet>
    );
  }

  if (open === 'here') {
    return (
      <Sheet title={t('here.title')} onClose={close}>
        <Here
          roster={roster.map((m) => ({
            memberId: m.memberId,
            name: m.name,
            face: m.face,
            you: m.memberId === you,
          }))}
          call={call}
        />
      </Sheet>
    );
  }

  if (open === 'prompts') {
    return (
      <Sheet title={t('q.title')} onClose={close}>
        <PromptCard messages={messages} onAnswer={onAnswerPrompt} canAnswer={canAnswer} />
        <PromptList />
      </Sheet>
    );
  }

  if (open === 'board') {
    return (
      <Sheet title={t('b.title')} onClose={close}>
        <Board onChanged={onTodoChanged} />
      </Sheet>
    );
  }

  if (open === 'night') {
    return (
      <Sheet title={t('n.title')} onClose={close}>
        <Night night={night} you={you} />
      </Sheet>
    );
  }

  if (open === 'find') {
    return (
      <Sheet title={t('find.title')} onClose={close}>
        <Find faceOf={(memberId) => faceOf(memberId)} />
      </Sheet>
    );
  }

  if (open === 'invite') {
    return (
      <Sheet title={t('inv.title')} onClose={close}>
        <Invite />
      </Sheet>
    );
  }

  return (
    <Sheet title={t('set.title')} onClose={close}>
      <Settings
        rooms={rooms}
        // From the roster rather than the session: the session was written at
        // the door and does not know about a face set since.
        you={{
          memberId: you,
          name: youName,
          face: roster.find((m) => m.memberId === you)?.face,
        }}
        onSignOut={onSignOut}
      />
    </Sheet>
  );
}
