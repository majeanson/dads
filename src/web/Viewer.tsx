import * as Dialog from '@radix-ui/react-dialog';
import { ChevronLeft, ChevronRight, Download, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useT } from './i18n';
import { mediaUrl } from './media';
import { Button } from './ui/Button';
import type { Attachment } from '../shared/protocol';

/** One picture in the room, with enough around it to say whose it is. */
export interface Shown {
  media: Attachment;
  name: string;
  at: number;
}

/**
 * A photograph, properly.
 *
 * Tapping one used to open the raw file in a new tab, which from the app on a
 * home screen means being thrown out into a browser with no way back except
 * the app switcher — for the one thing in here nobody would ever expect to be
 * hard to look at. It is a picture of somebody's child.
 *
 * So: the whole screen, in the app, with the others in the conversation a
 * swipe or an arrow away, and a way to keep it. On a phone that way is the
 * system's own share sheet, because "Save Image" is where a man expects a
 * picture to go and a downloads folder is not somewhere a phone really has.
 *
 * Radix's Dialog rather than a hand-rolled overlay: the focus trap, Escape,
 * the inert background and the labelling are the same problems the sheets
 * already solved.
 */
export function Viewer({
  shots,
  at,
  onMove,
  onClose,
}: {
  shots: Shown[];
  /** Index into `shots`, or -1 for nothing open. */
  at: number;
  onMove: (next: number) => void;
  onClose: () => void;
}) {
  const { t, lang } = useT();
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const shot = shots[at];

  // Arrows move between them, the way they do in every viewer anybody has
  // used. Escape is Radix's.
  useEffect(() => {
    if (shot === undefined) return;
    function key(event: KeyboardEvent) {
      if (event.key === 'ArrowLeft' && at > 0) onMove(at - 1);
      if (event.key === 'ArrowRight' && at < shots.length - 1) onMove(at + 1);
    }
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [at, shots.length, onMove, shot]);

  if (shot === undefined) return null;
  const href = mediaUrl(shot.media.id);

  /**
   * Keep it.
   *
   * The share sheet first, when the browser will take a file: on a phone that
   * is "Save Image", "Send to…", everything a man actually wants, and it is
   * the only route iOS really gives a web page to the camera roll. A plain
   * download anchor is the fallback, which is the right answer on a laptop.
   *
   * The fetch resolves from cache — the picture is on the screen — so the
   * user gesture is still live by the time share() is called.
   */
  async function save() {
    if (shot === undefined) return;
    setSaving(true);
    setFailed(false);
    try {
      const res = await fetch(href);
      const blob = await res.blob();
      const file = new File([blob], shot.media.name, { type: shot.media.contentType });
      if (navigator.canShare?.({ files: [file] }) === true) {
        await navigator.share({ files: [file] });
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = shot.media.name;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      // A share the dad cancelled is not a failure, and it is the only thing
      // that throws here in normal use.
      if (!(err instanceof DOMException && err.name === 'AbortError')) setFailed(true);
    } finally {
      setSaving(false);
    }
  }

  const when = new Date(shot.at).toLocaleString(lang === 'fr' ? 'fr-CA' : 'en-CA', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        {/* Solid, not translucent. At 90% the conversation read straight
            through the picture, which is the one thing on this screen. */}
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black" />
        <Dialog.Content
          className="viewer"
          data-testid="viewer"
          // The picture is the point; nothing here should be read aloud
          // before it is named.
          aria-describedby={undefined}
        >
          <Dialog.Title className="sr-only">{t('view.title', { name: shot.name })}</Dialog.Title>

          <div className="viewer-head">
            <p className="viewer-who">
              <span className="font-semibold">{shot.name}</span>
              <span className="viewer-when">{when}</span>
            </p>
            <Button
              look="quiet"
              className="text-white hover:text-white"
              disabled={saving}
              onClick={() => void save()}
              data-testid="viewer-save"
            >
              <Download size={16} aria-hidden="true" />
              {t('view.save')}
            </Button>
            <Dialog.Close asChild>
              <Button
                look="quiet"
                size="icon"
                className="text-white hover:text-white"
                aria-label={t('sheet.close')}
              >
                <X size={18} aria-hidden="true" />
                <span className="sr-only">{t('sheet.close')}</span>
              </Button>
            </Dialog.Close>
          </div>

          {/* Contained, not covered: a photograph of people is not wallpaper
              and must never have its edges cropped to fill a screen. */}
          <img className="viewer-shot" src={href} alt={shot.media.name} data-testid="viewer-shot" />

          <div className="viewer-foot">
            {shots.length < 2 ? null : (
              <>
                <Button
                  look="quiet"
                  size="icon"
                  className="text-white hover:text-white"
                  disabled={at === 0}
                  onClick={() => onMove(at - 1)}
                  aria-label={t('view.previous')}
                  data-testid="viewer-prev"
                >
                  <ChevronLeft size={20} aria-hidden="true" />
                  <span className="sr-only">{t('view.previous')}</span>
                </Button>
                <span className="viewer-count">
                  {t('view.of', { n: at + 1, total: shots.length })}
                </span>
                <Button
                  look="quiet"
                  size="icon"
                  className="text-white hover:text-white"
                  disabled={at === shots.length - 1}
                  onClick={() => onMove(at + 1)}
                  aria-label={t('view.next')}
                  data-testid="viewer-next"
                >
                  <ChevronRight size={20} aria-hidden="true" />
                  <span className="sr-only">{t('view.next')}</span>
                </Button>
              </>
            )}
            {failed ? (
              <p className="viewer-failed" role="alert">
                {t('view.failed')}
              </p>
            ) : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
