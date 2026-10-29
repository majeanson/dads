import {
  Bell,
  CalendarCheck,
  CalendarHeart,
  CalendarRange,
  Coffee,
  DoorOpen,
  MessageCircle,
  MessageCircleQuestion,
  Palette,
  Phone,
  Search,
  Send,
  Settings2,
  Smartphone,
  Spade,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { CallMember, RoomMessage, RoomsOpen, RosterEntry } from '../shared/protocol';
import type { DadNight } from '../shared/dadNight';
import type { Todo } from './api';
import { Component, lazy, Suspense, type ReactNode } from 'react';
import { Menu, type SheetName } from './Menu';
import { useT, type Key } from './i18n';
import { Logo } from './Logo';
import { Button } from './ui/Button';
import { Sheet } from './ui/Sheet';

/**
 * The sheets' bodies, loaded when first wanted rather than with the page.
 *
 * Home is what the app opens on, and it needs none of them: the week, the
 * night, the questions, Find, Settings and the rest were a third of what a
 * phone on LTE parsed before the first screen could paint. They are fetched
 * in the background once home is up (`preloadSheets`, from `Room`), so
 * opening one is instant — and a dad whose page was loaded before a deploy
 * already holds them, rather than asking for files the new deploy no longer
 * has.
 */
const bodies = {
  Board: () => import('./Board'),
  Events: () => import('./Events'),
  Find: () => import('./Find'),
  Here: () => import('./Here'),
  Invite: () => import('./Invite'),
  LinkDevice: () => import('./LinkDevice'),
  MyRooms: () => import('./MyRooms'),
  Night: () => import('./Night'),
  Questions: () => import('./Questions'),
  Settings: () => import('./Settings'),
};
const Board = lazy(() => bodies.Board().then((m) => ({ default: m.Board })));
const Events = lazy(() => bodies.Events().then((m) => ({ default: m.Events })));
const Find = lazy(() => bodies.Find().then((m) => ({ default: m.Find })));
const Here = lazy(() => bodies.Here().then((m) => ({ default: m.Here })));
const Invite = lazy(() => bodies.Invite().then((m) => ({ default: m.Invite })));
const LinkDevice = lazy(() => bodies.LinkDevice().then((m) => ({ default: m.LinkDevice })));
const MyRooms = lazy(() => bodies.MyRooms().then((m) => ({ default: m.MyRooms })));
const Night = lazy(() => bodies.Night().then((m) => ({ default: m.Night })));
const Questions = lazy(() => bodies.Questions().then((m) => ({ default: m.Questions })));
const Settings = lazy(() => bodies.Settings().then((m) => ({ default: m.Settings })));

/** Fetch every sheet's code now, quietly. Failures are the sheet's to report
 * when it is opened, not this. */
export function preloadSheets(): void {
  for (const load of Object.values(bodies)) void load().catch(() => {});
}

/**
 * A sheet's body, waited for — and a fetch that failed said in words.
 *
 * Without a boundary a failed import throws past React's root and the whole
 * app goes blank: the network the phone lost on the way into a sheet would
 * take the conversation with it. This keeps the failure inside the sheet,
 * with the one thing that fixes it.
 */
function Body({ children }: { children: ReactNode }) {
  return (
    <Failed>
      <Suspense
        fallback={
          <Logo
            size={36}
            hole="var(--bg)"
            motion="glint"
            className="mx-auto my-6 block text-muted"
          />
        }
      >
        {children}
      </Suspense>
    </Failed>
  );
}

class Failed extends Component<{ children: ReactNode; fallback?: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return this.props.fallback ?? <Reload />;
  }
}

function Reload() {
  const { t } = useT();
  return (
    <div className="grid justify-items-start gap-3">
      <p className="m-0 text-[1.0625rem]">{t('sheet.failed')}</p>
      <Button onClick={() => location.reload()}>{t('sheet.reload')}</Button>
    </div>
  );
}

export type { SheetName } from './Menu';
/** What the app does, one plain line each. "What this is" lists them all. */
const ABOUT_FEATURES: { key: Key; icon: LucideIcon }[] = [
  // Each one wears the icon the app already uses for it, so a line here is
  // the same picture as the row, the sheet or the button it describes.
  { key: 'about.f_night', icon: CalendarHeart },
  { key: 'about.f_poll', icon: CalendarHeart },
  { key: 'about.f_calendar', icon: CalendarRange },
  { key: 'about.f_chat', icon: MessageCircle },
  { key: 'about.f_call', icon: Phone },
  { key: 'about.f_questions', icon: MessageCircleQuestion },
  { key: 'about.f_week', icon: CalendarCheck },
  { key: 'about.f_table', icon: Spade },
  { key: 'about.f_people', icon: Users },
  { key: 'about.f_find', icon: Search },
  { key: 'about.f_remind', icon: Bell },
  { key: 'about.f_you', icon: Palette },
  { key: 'about.f_invite', icon: Send },
  { key: 'about.f_device', icon: Smartphone },
];

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
export function Sheets({
  open,
  onOpen,
  you,
  youName,
  messages,
  roster,
  call,
  night,
  pollPulse,
  nightPulse,
  eventsPulse,
  rooms,
  members,
  createdBy,
  ownerName,
  roomName,
  todo,
  tableOpen,
  mine,
  onToggleTable,
  onAnswerPrompt,
  canAnswer,
  onTodoChanged,
  onSignOut,
}: {
  open: SheetName | null;
  onOpen: (sheet: SheetName | null) => void;
  /** Everyone in the group, present or not. The roster is who is connected;
   * handing the room over is not a thing to offer only about men who happen
   * to be online. */
  members: RosterEntry[];
  /** The member who opened this room, or null for a room that has no creator
   * — every room made before rooms had one, where the switches stay
   * everybody's. */
  createdBy?: string | null;
  /** That man's name, for the line above the switches. */
  ownerName?: string;
  /** The room's name: the title of its "who is in it" sheet. */
  roomName?: string;
  /** The reader's own member id. */
  you: string;
  youName: string;
  messages: RoomMessage[];
  roster: RosterEntry[];
  call: CallMember[];
  night: DadNight | null;
  /** Bumped when the room says somebody marked the calendar that picks the
   * next night. The dad-night sheet holds it when there is nothing on the
   * books. */
  pollPulse: number;
  /** And when somebody answers, or puts something up for the evening. */
  nightPulse: number;
  /** And when somebody puts up, moves, cancels or answers an event. */
  eventsPulse: number;
  rooms: RoomsOpen;
  todo: Todo;
  tableOpen: boolean;
  /** How many rooms this phone is in. */
  mine: number;
  onToggleTable: () => void;
  onAnswerPrompt: (body: string) => boolean;
  canAnswer: boolean;
  onTodoChanged: () => void;
  onSignOut: () => void;
}) {
  const { t } = useT();
  const close = () => onOpen(null);

  if (open === null) return null;

  if (open === 'menu') {
    return (
      <Sheet title={t('menu.title')} onClose={close}>
        <Menu
          rooms={rooms}
          todo={todo}
          tableOpen={tableOpen}
          mine={mine}
          onToggleTable={onToggleTable}
          onOpen={onOpen}
        />
      </Sheet>
    );
  }

  if (open === 'here') {
    return (
      <Sheet title={roomName ?? t('here.title')} pose={Users} onClose={close}>
        <Body>
          <Here
            roster={roster.map((m) => ({
              memberId: m.memberId,
              name: m.name,
              you: m.memberId === you,
            }))}
            everyone={members
              .filter((m) => m.gone !== true)
              .map((m) => ({ memberId: m.memberId, name: m.name, you: m.memberId === you }))}
            call={call}
          />
        </Body>
      </Sheet>
    );
  }

  if (open === 'prompts') {
    return (
      // The questions draw their own sheet, so a failure needs one drawn for it.
      <Failed
        fallback={
          <Sheet title={t('menu.questions')} onClose={close}>
            <Reload />
          </Sheet>
        }
      >
        <Suspense fallback={null}>
          <Questions
            messages={messages}
            onAnswer={onAnswerPrompt}
            canAnswer={canAnswer}
            host={createdBy == null || createdBy === you}
            onClose={close}
          />
        </Suspense>
      </Failed>
    );
  }

  if (open === 'board') {
    return (
      <Sheet title={t('b.title')} pose={Coffee} onClose={close}>
        <Body>
          <Board onChanged={onTodoChanged} />
        </Body>
      </Sheet>
    );
  }

  if (open === 'night') {
    return (
      <Sheet title={t('n.title')} pose={CalendarHeart} onClose={close}>
        <Body>
          <Night night={night} you={you} pollPulse={pollPulse} nightPulse={nightPulse} />
        </Body>
      </Sheet>
    );
  }

  if (open === 'events') {
    return (
      <Sheet title={t('ev.title')} pose={CalendarRange} onClose={close}>
        <Body>
          <Events night={night} you={you} pulse={eventsPulse} />
        </Body>
      </Sheet>
    );
  }

  if (open === 'find') {
    return (
      <Sheet title={t('find.title')} pose={Search} onClose={close}>
        <Body>
          <Find />
        </Body>
      </Sheet>
    );
  }

  if (open === 'rooms') {
    return (
      <Sheet title={t('rooms.title')} pose={DoorOpen} onClose={close}>
        <Body>
          <MyRooms
            onClose={close}
            // The creator with anybody else still in it hands it on first:
            // leaving would leave the word and the switches with nobody.
            handOverFirst={
              createdBy === you && members.some((m) => m.memberId !== you && m.gone !== true)
            }
            onSettings={() => onOpen('settings')}
          />
        </Body>
      </Sheet>
    );
  }

  // Two lines, in a dad's words, for a man who was handed a link and
  // wonders what he has joined. Short on purpose: the app explains itself by
  // being used, and the night is the thing to answer.
  if (open === 'about') {
    return (
      <Sheet title={t('about.title')} onClose={close}>
        <div className="grid gap-4 text-[1.0625rem]" data-testid="about">
          <p className="m-0">{t('join.lede')}</p>
          <p className="m-0">{t('about.main')}</p>
          <ul className="m-0 grid list-none gap-2.5 p-0 text-base" data-testid="about-features">
            {ABOUT_FEATURES.map(({ key, icon: Icon }) => (
              <li key={key} className="flex items-start gap-3">
                <Icon size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-muted" />
                <span className="min-w-0">{t(key)}</span>
              </li>
            ))}
          </ul>
        </div>
      </Sheet>
    );
  }

  if (open === 'link') {
    return (
      <Sheet title={t('link.title')} pose={Smartphone} onClose={close}>
        <Body>
          <LinkDevice />
        </Body>
      </Sheet>
    );
  }

  if (open === 'invite') {
    return (
      <Sheet title={t('inv.title')} pose={Send} onClose={close}>
        <Body>
          <Invite />
        </Body>
      </Sheet>
    );
  }

  return (
    <Sheet title={t('set.title')} pose={Settings2} onClose={close}>
      <Body>
        <Settings
          rooms={rooms}
          you={{ memberId: you, name: youName }}
          // A room with no creator is everybody's, which is what it always was.
          members={members}
          mine={createdBy == null || createdBy === you}
          ownerName={createdBy == null ? '' : (ownerName ?? '')}
          onInvite={() => onOpen('invite')}
          onLink={() => onOpen('link')}
          onSignOut={onSignOut}
        />
      </Body>
    </Sheet>
  );
}
