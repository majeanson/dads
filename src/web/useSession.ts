import { useCallback, useEffect, useState } from 'react';
import { claimDeviceLink, fetchSession, leave as leaveApi, type Session } from './api';
import { report } from './oops';

type State =
  | { status: 'loading' }
  | { status: 'out'; outOf?: string }
  | { status: 'in'; session: Session }
  | { status: 'error'; message: string };

export function useSession() {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    // A link from another of his devices, taken once and taken OFF the
    // address bar: it is a credential. Spent before the session is asked for,
    // so a phone that follows it lands inside as him.
    const link = /^#link=([A-Za-z0-9_-]{32,})$/.exec(location.hash)?.[1];
    if (link !== undefined) history.replaceState(null, '', location.pathname + location.search);
    (link === undefined ? Promise.resolve(false) : claimDeviceLink(link).catch(() => false))
      .then(() => fetchSession())
      .then((session) => {
        if (cancelled) return;
        setState(session ? { status: 'in', session } : { status: 'out' });
      })
      .catch((err: unknown) => {
        report('web.session', err);
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

  /** The room closed his socket: he left it, or was taken out of it. */
  const removedFrom = useCallback((room: string) => setState({ status: 'out', outOf: room }), []);

  return { state, signedIn, signOut, removedFrom };
}
