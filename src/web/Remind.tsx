import { useEffect, useState } from 'react';
import { useT } from './i18n';
import { disablePush, enablePush, pushShape, type PushShape } from './push';
import { Switch } from './ui/Switch';

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

  // Nothing at all unless there is something to press. "Your browser is
  // blocking notifications" is a sentence about a setting three menus deep in
  // somebody else's app, in the middle of a list of buttons.
  if (shape === null || shape.kind !== 'ready') {
    return shape?.kind === 'needs-install' ? (
      <p className="quiet remind-note" data-testid="remind-install">
        {t('remind.needs_install')}
      </p>
    ) : null;
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
    <div className="mt-3 border-t border-line">
      <Switch
        label={t('remind.off')}
        checked={shape.on}
        disabled={busy}
        onChange={() => void toggle()}
        testId="remind"
      />
    </div>
  );
}
