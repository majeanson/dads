import { useCallback, useEffect, useState } from 'react';
import { fetchSession, pollPair, startPair, type Session } from './api';
import { useT } from './i18n';
import { Button } from './ui/Button';

const EVERY_MS = 2000;

/**
 * The door, for a device that is new but the dad is not.
 *
 * A home-screen app on an iPhone keeps storage of its own and cannot open a
 * link made in Safari, so this goes the other way round: it shows a code, and a
 * device that already is him types it in (`LinkDevice`). Then this one asks
 * the room who it is and comes in.
 */
export function PairDevice({
  onJoined,
  onBack,
}: {
  onJoined: (session: Session) => void;
  onBack: () => void;
}) {
  const { t } = useT();
  const [pair, setPair] = useState<{ code: string; poll: string } | null>(null);
  const [state, setState] = useState<'asking' | 'waiting' | 'expired' | 'failed'>('asking');
  const [round, setRound] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState('asking');
    startPair()
      .then((p) => {
        if (cancelled) return;
        setPair(p);
        setState('waiting');
      })
      .catch(() => !cancelled && setState('failed'));
    return () => {
      cancelled = true;
    };
  }, [round]);

  useEffect(() => {
    if (pair === null || state !== 'waiting') return;
    let cancelled = false;
    const timer = setInterval(() => {
      pollPair(pair.poll)
        .then(async (answer) => {
          if (cancelled || answer === 'pending') return;
          if (answer === 'gone') {
            setState('expired');
            return;
          }
          const session = await fetchSession();
          if (!cancelled && session) onJoined(session);
        })
        .catch(() => {
          // The next tick asks again.
        });
    }, EVERY_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [pair, state, onJoined]);

  const again = useCallback(() => setRound((r) => r + 1), []);

  return (
    <div className="grid gap-4" data-testid="pair-device">
      <h2 className="display m-0 text-3xl text-ink">{t('pair.title')}</h2>
      {state === 'failed' ? (
        <p className="m-0 text-danger" role="alert">
          {t('pair.failed')}
        </p>
      ) : state === 'expired' ? (
        <p className="m-0 text-muted" role="status">
          {t('pair.expired')}
        </p>
      ) : (
        <>
          <p
            className="display m-0 text-5xl tracking-[0.12em] text-ink"
            data-testid="pair-code"
            aria-live="polite"
          >
            {pair?.code ?? '…'}
          </p>
          <p className="m-0 text-[1.0625rem]">{t('pair.how')}</p>
          <p className="m-0 text-base text-muted" role="status">
            {t('pair.waiting')}
          </p>
        </>
      )}
      {state === 'expired' || state === 'failed' ? (
        <Button look="primary" size="lg" onClick={again} className="justify-center">
          {t('pair.new')}
        </Button>
      ) : null}
      <Button look="quiet" size="lg" onClick={onBack} className="justify-center">
        {t('pair.back')}
      </Button>
    </div>
  );
}
