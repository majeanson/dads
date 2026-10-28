import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createDeviceLink } from './api';
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
    </div>
  );
}
