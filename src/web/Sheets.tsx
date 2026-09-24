import { CalendarHeart, Coffee, DoorOpen, Search, Send, Settings2, Users } from 'lucide-react';
import type {
  CallMember,
  GlassesKind,
  RoomMessage,
  RoomsOpen,
  RosterEntry,
} from '../shared/protocol';
import type { DadNight } from '../shared/dadNight';
import type { Todo } from './api';
import { Board } from './Board';
import { Find } from './Find';
import { Here } from './Here';
import { Invite } from './Invite';
import { Menu, type SheetName } from './Menu';
import { MyRooms } from './MyRooms';
import { Night } from './Night';
import { Questions } from './Questions';
import { Settings } from './Settings';
import { useT } from './i18n';
import { Sheet } from './ui/Sheet';

export type { SheetName } from './Menu';

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
  view,
  you,
  youName,
  messages,
  roster,
  call,
  night,
  pollPulse,
  nightPulse,
  rooms,
  members,
  createdBy,
  ownerName,
  todo,
  tableOpen,
  mine,
  faceOf,
  glassesOf,
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
  /** Which screen the menu was opened from. */
  view: 'home' | 'talk';
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
  rooms: RoomsOpen;
  todo: Todo;
  tableOpen: boolean;
  /** How many rooms this phone is in. */
  mine: number;
  faceOf: (memberId: string | null) => number | undefined;
  glassesOf: (memberId: string) => GlassesKind | undefined;
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
          view={view}
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
      <Sheet title={t('here.title')} pose={Users} onClose={close}>
        <Here
          roster={roster.map((m) => ({
            memberId: m.memberId,
            name: m.name,
            face: m.face,
            glasses: glassesOf(m.memberId),
            you: m.memberId === you,
          }))}
          call={call}
        />
      </Sheet>
    );
  }

  if (open === 'prompts') {
    return (
      <Questions
        messages={messages}
        onAnswer={onAnswerPrompt}
        canAnswer={canAnswer}
        onClose={close}
      />
    );
  }

  if (open === 'board') {
    return (
      <Sheet title={t('b.title')} pose={Coffee} onClose={close}>
        <Board
          onChanged={onTodoChanged}
          faceOf={(memberId) => faceOf(memberId)}
          glassesOf={glassesOf}
        />
      </Sheet>
    );
  }

  if (open === 'night') {
    return (
      <Sheet title={t('n.title')} pose={CalendarHeart} onClose={close}>
        <Night night={night} you={you} pollPulse={pollPulse} nightPulse={nightPulse} />
      </Sheet>
    );
  }

  if (open === 'find') {
    return (
      <Sheet title={t('find.title')} pose={Search} onClose={close}>
        <Find faceOf={(memberId) => faceOf(memberId)} glassesOf={glassesOf} />
      </Sheet>
    );
  }

  if (open === 'rooms') {
    return (
      <Sheet title={t('rooms.title')} pose={DoorOpen} onClose={close}>
        <MyRooms onClose={close} />
      </Sheet>
    );
  }

  if (open === 'invite') {
    return (
      <Sheet title={t('inv.title')} pose={Send} onClose={close}>
        <Invite />
      </Sheet>
    );
  }

  return (
    <Sheet title={t('set.title')} pose={Settings2} onClose={close}>
      <Settings
        rooms={rooms}
        // From the roster rather than the session: the session was written at
        // the door and does not know about a face set since.
        you={{
          memberId: you,
          name: youName,
          face: roster.find((m) => m.memberId === you)?.face,
          glasses: members.find((m) => m.memberId === you)?.glasses,
        }}
        // A room with no creator is everybody's, which is what it always was.
        members={members}
        mine={createdBy == null || createdBy === you}
        ownerName={createdBy == null ? '' : (ownerName ?? '')}
        onSignOut={onSignOut}
      />
    </Sheet>
  );
}
