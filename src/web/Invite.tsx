import { Check, Copy, Share2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createInvite } from './api';
import { useT } from './i18n';
import { Button } from './ui/Button';
import { FIELD } from './ui/field';

/**
 * The link that gets the other four dads in.
 *
 * Until this existed, joining meant being told a URL and a passphrase and
 * typing both correctly — which is two chances to fail before anybody has said
 * hello. The group's code cannot go in a link (it is only ever stored as a
 * hash, on purpose), so the link carries a token of its own.
 *
 * Minted on open rather than held: a fresh week each time it is asked for, and
 * nothing sitting in this app waiting to be read off a shoulder.
 */
export function Invite() {
  const { t, lang } = useT();
  const [link, setLink] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  // One timer, restarted by every copy: a second press inside the two seconds
  // used to be taken down by the FIRST press's timer, a second early — the
  // same true-over-true shape as the door's dead second press.
  const copiedFor = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(copiedFor.current), []);

  // In his language, and minted again if he changes it with the sheet open:
  // the link's preview speaks the language it was made in.
  useEffect(() => {
    let cancelled = false;
    createInvite(lang)
      .then((i) => !cancelled && setLink(i.url))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [lang]);

  async function copy() {
    if (link === null) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      clearTimeout(copiedFor.current);
      copiedFor.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // A browser that will not give up the clipboard leaves the link on the
      // screen, selectable. That is the fallback, and it needs no sentence.
    }
  }

  if (failed) return <p className="text-danger">{t('inv.failed')}</p>;
  if (link === null) return <p className="text-muted">{t('inv.making')}</p>;

  return (
    <div className="grid gap-3" data-testid="invite">
      <label htmlFor="invite-link" className="sr-only">
        {t('inv.link')}
      </label>
      <input
        id="invite-link"
        readOnly
        value={link}
        data-testid="invite-link"
        className={FIELD}
        onFocus={(e) => e.currentTarget.select()}
      />

      <div className="flex flex-wrap gap-2">
        <Button look="primary" size="lg" onClick={() => void copy()}>
          {copied ? <Check size={18} aria-hidden="true" /> : <Copy size={18} aria-hidden="true" />}
          {copied ? t('inv.copied') : t('inv.copy')}
        </Button>
        {/* Only where it means something: on a phone this opens the share
            sheet and is the shortest path there is; on a desktop the browser
            does not have one and a button that does nothing is worse than no
            button. */}
        {typeof navigator.share === 'function' ? (
          <Button
            size="lg"
            onClick={() =>
              void navigator.share({ text: t('inv.share_text'), url: link }).catch(() => {})
            }
          >
            <Share2 size={18} aria-hidden="true" />
            {t('inv.share')}
          </Button>
        ) : null}
      </div>

      <p className="m-0 text-base text-muted">{t('inv.week')}</p>
    </div>
  );
}
