import { ChevronLeft, Menu as MenuIcon } from 'lucide-react';
import { JoinCall } from './CallBar';
import type { CallState } from './useCall';
import { useT } from './i18n';
import { Button } from './ui/Button';

/**
 * The app bar, in two shapes.
 *
 * On HOME it is the group's name and the head-count and nothing else. The
 * menu is on home itself, under the night and the door, and the call is
 * joined from the conversation — so there is nothing for the bar to hold a
 * button for.
 *
 * In the CONVERSATION it is one slim row: the way back, the head-count (and
 * the night, when it is close) as the only information, and the call and the
 * menu as plain icons. The group's name goes: he came in from a screen that
 * said it in the biggest type in the app, and every row the bar takes here is
 * a row of conversation it costs.
 *
 * Either way it must be structurally incapable of overflowing. The name and
 * the count give way (`min-width: 0` on the left, `shrink-0` on the actions),
 * because an over-long header does not wrap — it makes the whole PAGE wider,
 * and the composer ends up half off the right-hand side of a phone.
 */
export function RoomHeader({
  groupName,
  view,
  connection,
  here,
  soon,
  callState,
  waiting,
  onHome,
  onWho,
  onNight,
  onMenu,
  onJoinCall,
}: {
  groupName: string;
  view: 'home' | 'talk';
  connection: 'connecting' | 'open' | 'reconnecting';
  here: number;
  /** The countdown, but only inside 24 hours. Null the rest of the week. */
  soon: string | null;
  callState: CallState;
  /** A question is waiting for him: the one thing in this menu that can. */
  waiting: boolean;
  onHome: () => void;
  onWho: () => void;
  onNight: () => void;
  onMenu: () => void;
  onJoinCall: () => void;
}) {
  const { t } = useT();
  const slim = view === 'talk';

  return (
    <header className={`room-head border-b border-line ${slim ? 'pb-2' : 'pb-2.5'}`}>
      {/* A real back button, first in the bar, the way every app on a phone
          does it. It was the group's name with a chevron, which is the
          convention on a desktop and something nobody finds on a phone. */}
      {slim ? (
        <Button
          size="icon"
          look="quiet"
          className="-ml-1 shrink-0"
          onClick={onHome}
          aria-label={t('home.title')}
          data-testid="go-home"
        >
          <ChevronLeft size={24} aria-hidden="true" />
          <span className="sr-only">{t('home.title')}</span>
        </Button>
      ) : null}

      <div className="min-w-0">
        {/* Still the page's one h1 in the conversation, for anything reading
            the structure aloud — just not on the screen. */}
        <h1 className={slim ? 'sr-only' : 'display truncate text-xl text-muted'}>{groupName}</h1>
        {/* The count is also the door to the roster and to who has been about.
            A button, because it does something — but not a blue underlined
            link, which is three times louder than a group of five men needs
            its own head-count to be. */}
        <p className="text-[1.0625rem] text-ink">
          <button type="button" className="count-in" data-testid="connection" onClick={onWho}>
            {connection === 'open'
              ? t('room.here', { n: here })
              : connection === 'connecting'
                ? t('room.opening')
                : t('room.reconnecting')}
          </button>
          {/* Not on home, where the night is the first thing on the screen and
              four times the size. A header that repeats what is an inch below
              it is the app saying something twice. */}
          {soon === null || !slim ? null : (
            <span className="max-[30rem]:block max-[30rem]:pt-0.5">
              <span className="max-[30rem]:hidden"> · </span>
              <button
                type="button"
                className="count-in max-[30rem]:block max-[30rem]:text-left"
                data-testid="night-soon"
                onClick={onNight}
              >
                {soon}
              </button>
            </span>
          )}
        </p>
      </div>

      {/* Only in the conversation. On home the menu is the screen and the
          call is a thing you join from beside the talk. */}
      {slim ? (
        <span className="head-actions">
          <JoinCall state={callState} onJoin={onJoinCall} />
          <Button size="icon" onClick={onMenu} aria-label={t('room.menu')} className="relative">
            <MenuIcon size={22} aria-hidden="true" />
            <span className="sr-only">{t('room.menu')}</span>
            {/* The one place a dot is right: the words are behind the button
                it sits on, and the menu says which thing in words. */}
            {waiting ? (
              <span
                className="absolute top-1 right-1 h-2.5 w-2.5 rounded-full bg-accent"
                data-testid="mark-menu"
                aria-hidden="true"
              />
            ) : null}
            {waiting ? <span className="sr-only">{t('room.waiting')}</span> : null}
          </Button>
        </span>
      ) : null}
    </header>
  );
}
