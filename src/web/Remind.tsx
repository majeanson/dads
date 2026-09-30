import { Bell, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useT } from './i18n';
import { disablePush, enablePush, pushShape, type PushShape } from './push';
import { Button } from './ui/Button';
import { Switch } from './ui/Switch';

/**
 * Asked once per device, yes or no: a reminder is offered where a dad is
 * already answering about the night, and a second offer after "not now" is
 * nagging. Storage that refuses means never asking, for the same reason.
 */
const ASKED = 'dads.remind.asked';

function markAsked() {
  try {
    localStorage.setItem(ASKED, '1');
  } catch {
    // Then it simply is not offered again in this session either.
  }
}

/** Whether to offer the reminder now: never asked here, and a switch that
 * would work and is off. The same subscription as Settings' switch. */
export async function worthOffering(): Promise<boolean> {
  try {
    if (localStorage.getItem(ASKED)) return false;
  } catch {
    return false;
  }
  const shape = await pushShape().catch(() => null);
  return shape?.kind === 'ready' && !shape.on;
}

/**
 * "Remind me the day before", offered on home right after he says he is
 * coming. Only one dad had found the switch in Settings; the moment he
 * answers is when a reminder means something. It takes the place of the
 * night's quiet row until he answers it, because home has no height to give.
 */
export function RemindOffer({ onDone }: { onDone: () => void }) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);

  async function yes() {
    setBusy(true);
    try {
      await enablePush();
    } catch {
      // Refused or failed: Settings keeps the switch for another day.
    } finally {
      markAsked();
      onDone();
    }
  }

  return (
    <div className="flex h-10 min-w-0 items-center gap-1" data-testid="remind-offer">
      <Button
        look="quiet"
        className="h-10 min-w-0 justify-start px-0"
        disabled={busy}
        onClick={() => void yes()}
        data-testid="remind-offer-yes"
      >
        <Bell size={17} aria-hidden="true" className="shrink-0" />
        <span className="min-w-0 truncate">{t('remind.offer')}</span>
      </Button>
      <Button
        look="quiet"
        className="ml-auto h-10 w-10 shrink-0 p-0"
        aria-label={t('remind.offer_no')}
        disabled={busy}
        onClick={() => {
          markAsked();
          onDone();
        }}
        data-testid="remind-offer-no"
      >
        <X size={18} aria-hidden="true" />
        <span className="sr-only">{t('remind.offer_no')}</span>
      </Button>
    </div>
  );
}

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
    <div>
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
