import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { approvePair, createDeviceLink } from './api';
import { useT } from './i18n';
import { Button } from './ui/Button';
import { FIELD } from './ui/field';

/**
 * The link that brings another of his devices in as HIM.
 *
 * Joining by name never reaches an existing dad (a second phone with the same
 * name is a second dad), so the only way to carry a profile across is from a
 * device that already is him. The link is good for ten minutes, once, and is
 * minted fresh each time the sheet opens.
 */
export function LinkDevice() {
  const { t } = useT();
  const [link, setLink] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedFor = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(copiedFor.current), []);

  useEffect(() => {
    let cancelled = false;
    createDeviceLink()
      .then((l) => !cancelled && setLink(l.url))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, []);

  async function copy() {
    if (link === null) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      clearTimeout(copiedFor.current);
      copiedFor.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // The link stays on the screen, selectable.
    }
  }

  if (failed) return <p className="text-danger">{t('link.failed')}</p>;
  if (link === null) return <p className="text-muted">{t('link.making')}</p>;

  return (
    <div className="grid gap-3" data-testid="link-device">
      <p className="m-0 text-[1.0625rem]">{t('link.what')}</p>
      <label htmlFor="device-link" className="sr-only">
        {t('link.link')}
      </label>
      <input
        id="device-link"
        readOnly
        value={link}
        data-testid="device-link"
        className={FIELD}
        onFocus={(e) => e.currentTarget.select()}
      />
      <div>
        <Button look="primary" size="lg" onClick={() => void copy()}>
          {copied ? <Check size={18} aria-hidden="true" /> : <Copy size={18} aria-hidden="true" />}
          {copied ? t('link.copied') : t('link.copy')}
        </Button>
      </div>
      <p className="m-0 text-base text-muted">{t('link.expires')}</p>
      <LetIn />
    </div>
  );
}

/**
 * The other way round: the new device is showing a code (the home-screen app
 * cannot open the link above), and this one, which is already him, types it.
 */
function LetIn() {
  const { t } = useT();
  const [code, setCode] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'bad'>('idle');

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (code.trim() === '') return;
    setState('busy');
    try {
      setState((await approvePair(code)) ? 'done' : 'bad');
    } catch {
      setState('bad');
    }
  }

  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="grid gap-2 border-t border-line pt-4"
      data-testid="pair-approve"
    >
      <label htmlFor="pair-code-in" className="text-base text-muted">
        {t('link.code')}
      </label>
      <div className="flex gap-2">
        <input
          id="pair-code-in"
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            setState('idle');
          }}
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          maxLength={12}
          className={`${FIELD} min-w-0 flex-1 uppercase tracking-widest`}
          data-testid="pair-code-in"
        />
        <Button type="submit" look="primary" size="lg" disabled={state === 'busy'}>
          {t('link.code_do')}
        </Button>
      </div>
      {state === 'done' ? (
        <p className="m-0 text-base" role="status" data-testid="pair-done">
          {t('link.code_done')}
        </p>
      ) : state === 'bad' ? (
        <p className="m-0 text-base text-danger" role="alert">
          {t('link.code_bad')}
        </p>
      ) : null}
    </form>
  );
}
