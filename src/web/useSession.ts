import { useCallback, useEffect, useState } from 'react';
import { fetchSession, leave as leaveApi, type Session } from './api';

type State =
  | { status: 'loading' }
  | { status: 'out' }
  | { status: 'in'; session: Session }
  | { status: 'error'; message: string };

export function useSession() {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetchSession()
      .then((session) => {
        if (cancelled) return;
        setState(session ? { status: 'in', session } : { status: 'out' });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ status: 'error', message: String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const signedIn = useCallback((session: Session) => setState({ status: 'in', session }), []);

  const signOut = useCallback(async () => {
    await leaveApi();
    setState({ status: 'out' });
  }, []);

  return { state, signedIn, signOut };
}
