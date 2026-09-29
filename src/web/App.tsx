import { useLayoutEffect } from 'react';
import { useT, LangProvider } from './i18n';
import { JoinScreen } from './JoinScreen';
import { Room } from './Room';
import { dropShell } from './shell';
import { useSession } from './useSession';

/** Door or room, in whichever of the two languages this dad reads. */
function Shell() {
  const { t } = useT();
  const { state, signedIn, signOut } = useSession();

  // The first frame index.html painted comes down once there is something
  // to show instead — in a LAYOUT effect, so the door or the splash is on
  // the screen in the same frame the shell starts to go.
  const known = state.status !== 'loading';
  useLayoutEffect(() => {
    if (known) dropShell();
  }, [known]);

  if (state.status === 'loading') return <main className="quiet">…</main>;
  if (state.status === 'error') return <main className="error">{t('app.unreachable')}</main>;
  if (state.status === 'out') return <JoinScreen onJoined={signedIn} />;

  return <Room session={state.session} onSignOut={() => void signOut()} />;
}

export function App() {
  return (
    <LangProvider>
      <Shell />
    </LangProvider>
  );
}
