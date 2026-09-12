import { useT, LangProvider } from './i18n';
import { JoinScreen } from './JoinScreen';
import { Room } from './Room';
import { useSession } from './useSession';

/** Door or room, in whichever of the two languages this dad reads. */
function Shell() {
  const { t } = useT();
  const { state, signedIn, signOut } = useSession();

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
