import { useEffect, useState } from 'react';
import { useT } from './i18n';
import { disablePush, enablePush, pushShape, type PushShape } from './push';

/**
 * "Tell me when the table opens."
 *
 * Off until a dad presses it, per device, and it says plainly when it cannot
 * be offered rather than showing a switch that does nothing. On an iPhone that
 * is most of the time: Apple only allows notifications once the app is on the
 * home screen, which is worth saying out loud since it is a thing he can fix.
 */
export function Remind() {
  const { t } = useT();
  const [shape, setShape] = useState<PushShape | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    pushShape()
      .then((s) => !cancelled && setShape(s))
      .catch(() => !cancelled && setShape({ kind: 'unsupported' }));
    return () => {
      cancelled = true;
    };
  }, []);

  if (shape === null || shape.kind === 'unsupported' || shape.kind === 'unavailable') return null;

  if (shape.kind === 'needs-install') {
    return (
      <p className="quiet remind-note" data-testid="remind-install">
        {t('remind.needs_install')}
      </p>
    );
  }

  if (shape.kind === 'blocked') {
    return (
      <p className="quiet remind-note" data-testid="remind-blocked">
        {t('remind.blocked')}
      </p>
    );
  }

  async function toggle() {
    setBusy(true);
    try {
      if (shape !== null && shape.kind === 'ready' && shape.on) {
        await disablePush();
        setShape({ kind: 'ready', on: false });
      } else {
        setShape({ kind: 'ready', on: await enablePush() });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      aria-pressed={shape.on}
      disabled={busy}
      onClick={() => void toggle()}
      data-testid="remind"
    >
      {shape.on ? t('remind.on') : t('remind.off')}
    </button>
  );
}
