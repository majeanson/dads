import { JoinScreen } from './JoinScreen';
import { Room } from './Room';
import { useSession } from './useSession';

/**
 * Door or room. The prompt, the board and the table (M4–M6) mount inside Room.
 */
export function App() {
  const { state, signedIn, signOut } = useSession();

  if (state.status === 'loading') return <main className="quiet">…</main>;
  if (state.status === 'error')
    return <main className="quiet">Can’t reach the house right now.</main>;
  if (state.status === 'out') return <JoinScreen onJoined={signedIn} />;

  return <Room session={state.session} onSignOut={() => void signOut()} />;
}
