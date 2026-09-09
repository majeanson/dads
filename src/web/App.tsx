import { JoinScreen } from './JoinScreen';
import { useSession } from './useSession';

/**
 * M1 shows the door and what is directly behind it. The room itself — presence,
 * chat, the prompt, the board, the table — arrives in M2 onward.
 */
export function App() {
  const { state, signedIn, signOut } = useSession();

  if (state.status === 'loading') return <main className="quiet">…</main>;
  if (state.status === 'error')
    return <main className="quiet">Can’t reach the house right now.</main>;
  if (state.status === 'out') return <JoinScreen onJoined={signedIn} />;

  const { group, member } = state.session;
  return (
    <main className="room">
      <header>
        <h1>{group.name}</h1>
        <p className="lede" data-testid="whoami">
          You’re in as {member.displayName}.
        </p>
      </header>
      <p className="quiet">The room opens in M2.</p>
      <button type="button" className="link" onClick={() => void signOut()}>
        Sign out
      </button>
    </main>
  );
}
