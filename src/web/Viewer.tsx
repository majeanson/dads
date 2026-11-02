import * as Dialog from '@radix-ui/react-dialog';
import { ChevronLeft, ChevronRight, Download, X } from 'lucide-react';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useT } from './i18n';
import { mediaUrl } from './media';
import { Button } from './ui/Button';
import { useBackCloses } from './useBackCloses';
import {
  AT_REST,
  doubleTap,
  dragMove,
  dragStart,
  groundFor,
  isDoubleTap,
  isTap,
  panTo,
  pinchEnd,
  pinchMove,
  pinchStart,
  sidewaysEnd,
  sidewaysOffset,
  verticalEnd,
  verticalOffset,
  zoomed,
  type Drag,
  type Pinch,
  type Point,
  type Tap,
  type View,
} from './viewerGestures';
import type { Attachment } from '../shared/protocol';

/** The black between one picture and the next as they slide (`.viewer-frame`, 1rem). */
const GAP_PX = 16;

/** What the fingers are doing, kept out of React: a render per pixel is a stutter. */
interface Hands {
  /** Every finger (or pen) down on the picture, where it is on the screen. */
  down: Map<number, Point>;
  drag: Drag | null;
  dragId: number | null;
  pinch: Pinch | null;
  view: View;
  /** The view a pan started from. */
  panFrom: View;
  lastTap: Tap | null;
  /** The last pointer's kind, so a double click is a mouse's and never a thumb's. */
  kind: string;
  /** The picture being slid to, while the slide plays. */
  sliding: number | null;
}

/**
 * Painting is by hand, on the one element, as the swipe on a line does it.
 * `animate` false is a finger on the glass: it follows exactly. True leaves
 * the stylesheet's transition to carry it, which the reduced-motion rule
 * shortens to nothing — so every spring here is CSS, never a JS timer.
 */
function paintTrack(el: HTMLElement | null, x: number, y: number, animate: boolean) {
  if (el === null) return;
  el.style.transition = animate ? '' : 'none';
  el.style.translate = x === 0 && y === 0 ? '' : `${x}px ${y}px`;
}

function paintGround(els: (HTMLElement | null)[], opacity: number, animate: boolean) {
  for (const el of els) {
    if (el === null) continue;
    el.style.transition = animate ? '' : 'none';
    el.style.opacity = opacity === 1 ? '' : String(opacity);
  }
}

function paintView(img: HTMLElement | null, stage: HTMLElement | null, v: View, animate: boolean) {
  if (img === null) return;
  img.style.transition = animate ? '' : 'none';
  img.style.translate = v.x === 0 && v.y === 0 ? '' : `${v.x}px ${v.y}px`;
  img.style.scale = v.scale === 1 ? '' : String(v.scale);
  if (stage === null) return;
  if (zoomed(v)) stage.setAttribute('data-zoomed', 'yes');
  else stage.removeAttribute('data-zoomed');
}

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

  // The phone's back button closes the picture, not the app.
  useBackCloses(shot !== undefined, onClose);

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

  // A save that went wrong on one picture is not news about the next one.
  useEffect(() => setFailed(false), [at]);

  const stage = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const picture = useRef<HTMLImageElement>(null);
  const ground = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const foot = useRef<HTMLDivElement>(null);
  const hands = useRef<Hands>({
    down: new Map(),
    drag: null,
    dragId: null,
    pinch: null,
    view: AT_REST,
    panFrom: AT_REST,
    lastTap: null,
    kind: '',
    sliding: null,
  });

  // A new picture starts at rest, where the slide left it: the track back
  // at nought and nothing zoomed. Before the paint, so the picture that slid
  // in does not jump back out for a frame while React catches up.
  useLayoutEffect(() => {
    const h = hands.current;
    // Not the fingers: one that came down to finish a slide is already
    // the next gesture, and this runs straight after it.
    h.view = AT_REST;
    h.sliding = null;
    h.lastTap = null;
    for (const img of track.current?.querySelectorAll('img') ?? [])
      paintView(img, null, AT_REST, false);
    stage.current?.removeAttribute('data-zoomed');
    paintTrack(track.current, 0, 0, false);
    paintGround([ground.current, head.current, foot.current], 1, false);
  }, [at]);

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
      // Not synchronously: Chrome tolerates a revoke straight after the
      // click, and Firefox and Safari have both cancelled the download for
      // it. This is the laptop path, which is exactly where those two are.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
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

  /*
   * The gestures (Marc, 2026-11-02): sideways to the next or the one before,
   * down to close, two fingers to zoom, a double tap to zoom where it lands.
   * The decisions are `viewerGestures.ts`; this is the wiring. The header and
   * the foot are outside the stage, so their buttons never start one.
   */
  const h = hands.current;
  const sizes = () => ({
    pic: { w: picture.current?.offsetWidth ?? 0, h: picture.current?.offsetHeight ?? 0 },
    area: { w: stage.current?.clientWidth ?? 0, h: stage.current?.clientHeight ?? 0 },
  });
  /** A point on the screen, from the stage's centre — where the picture's centre is. */
  const fromCentre = (p: Point): Point => {
    const box = stage.current?.getBoundingClientRect();
    if (box === undefined) return p;
    return { x: p.x - (box.left + box.width / 2), y: p.y - (box.top + box.height / 2) };
  };
  const span = () => (stage.current?.clientWidth ?? 0) + GAP_PX;
  const chrome = () => [ground.current, head.current, foot.current];
  const show = (v: View, animate: boolean) => {
    h.view = v;
    paintView(picture.current, stage.current, v, animate);
  };
  const springBack = () => {
    paintTrack(track.current, 0, 0, true);
    paintGround(chrome(), 1, true);
  };
  /** The slide finished (or a finger came down before it had): now it IS the next one. */
  const landed = () => {
    const next = h.sliding;
    h.sliding = null;
    if (next !== null) onMove(next);
  };
  const slide = (step: number) => {
    const target = -step * span();
    const now = parseFloat(track.current?.style.translate ?? '') || 0;
    h.sliding = at + step;
    // Already there: no transition would run, so nothing would end it.
    if (Math.abs(now - target) < 1) return landed();
    paintTrack(track.current, target, 0, true);
  };
  const lift = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!h.down.delete(event.pointerId)) return;
    const cancelled = event.type === 'pointercancel';
    if (h.pinch !== null) {
      if (h.down.size >= 2) return;
      h.pinch = null;
      const { pic, area } = sizes();
      show(pinchEnd(h.view, pic, area), true);
      // The finger still down pans on from here, if there is anything to pan.
      const rest = [...h.down.entries()][0];
      if (rest !== undefined && zoomed(h.view)) {
        h.dragId = rest[0];
        // Started long ago as far as a tap is concerned: the last finger of
        // a pinch coming up is not the first half of a double tap.
        h.drag = dragStart(rest[1], -Infinity, true);
        h.panFrom = h.view;
      }
      return;
    }
    const d = h.drag;
    if (d === null || event.pointerId !== h.dragId) return;
    h.drag = null;
    h.dragId = null;
    if (cancelled) return springBack();
    const t = event.timeStamp;
    if (isTap(d, t)) {
      const tap = { x: event.clientX, y: event.clientY, t };
      if (event.pointerType === 'mouse' || !isDoubleTap(h.lastTap, tap)) {
        h.lastTap = tap;
        return;
      }
      h.lastTap = null;
      const { pic, area } = sizes();
      return show(doubleTap(h.view, fromCentre(tap), pic, area), true);
    }
    if (d.phase === 'sideways') {
      const step = sidewaysEnd(d, t, at, shots.length, span());
      return step === 0 ? springBack() : slide(step);
    }
    if (d.phase === 'vertical') return verticalEnd(d, t) ? onClose() : springBack();
  };

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        {/* Solid, not translucent. At 90% the conversation read straight
            through the picture, which is the one thing on this screen. */}
        <Dialog.Overlay ref={ground} className="viewer-ground fixed inset-0 z-[60] bg-black" />
        <Dialog.Content
          className="viewer"
          data-testid="viewer"
          // The picture is the point; nothing here should be read aloud
          // before it is named.
          aria-describedby={undefined}
        >
          <Dialog.Title className="sr-only">{t('view.title', { name: shot.name })}</Dialog.Title>

          <div ref={head} className="viewer-head">
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

          {/* The stage: where the fingers are the picture's, and nothing
              else's — `touch-action: none`, so the page neither scrolls nor
              pinches under them. The one before and the one after sit either
              side of it, off the screen, so a swipe pulls the next picture in
              rather than a gap. */}
          <div
            ref={stage}
            className="viewer-stage"
            data-testid="viewer-stage"
            onPointerDown={(event) => {
              h.kind = event.pointerType;
              // A finger down before the slide has finished: finish it now.
              if (h.sliding !== null) landed();
              // A mouse keeps the buttons and the arrows; it only drags a
              // picture that is zoomed in, which there is no other way to see.
              if (event.pointerType === 'mouse' && (event.button !== 0 || !zoomed(h.view))) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              const p = { x: event.clientX, y: event.clientY };
              h.down.set(event.pointerId, p);
              if (h.down.size === 1) {
                h.dragId = event.pointerId;
                h.drag = dragStart(p, event.timeStamp, zoomed(h.view));
                h.panFrom = h.view;
                return;
              }
              if (h.down.size !== 2) return;
              // A second finger: whatever the first was doing, it is a pinch now.
              h.drag = null;
              h.dragId = null;
              h.lastTap = null;
              springBack();
              const [a, b] = [...h.down.values()];
              if (a !== undefined && b !== undefined)
                h.pinch = pinchStart(h.view, fromCentre(a), fromCentre(b));
            }}
            onPointerMove={(event) => {
              if (!h.down.has(event.pointerId)) return;
              const p = { x: event.clientX, y: event.clientY };
              h.down.set(event.pointerId, p);
              if (h.pinch !== null) {
                const [a, b] = [...h.down.values()];
                if (a !== undefined && b !== undefined)
                  show(pinchMove(h.pinch, fromCentre(a), fromCentre(b)), false);
                return;
              }
              if (h.drag === null || event.pointerId !== h.dragId) return;
              const d = dragMove(h.drag, p, event.timeStamp);
              h.drag = d;
              if (d.phase === 'pan') {
                const { pic, area } = sizes();
                show(panTo(h.panFrom, d.dx, d.dy, pic, area), false);
              } else if (d.phase === 'sideways') {
                paintTrack(track.current, sidewaysOffset(d.dx, at, shots.length, span()), 0, false);
              } else if (d.phase === 'vertical') {
                const y = verticalOffset(d.dy, sizes().area.h);
                paintTrack(track.current, 0, y, false);
                paintGround(chrome(), groundFor(y), false);
              }
            }}
            onPointerUp={lift}
            onPointerCancel={lift}
            // A double click zooms too, on a laptop; a thumb's double tap is
            // the lift's (a browser may also call it a double click).
            onDoubleClick={(event) => {
              if (h.kind !== 'mouse') return;
              const { pic, area } = sizes();
              show(
                doubleTap(h.view, fromCentre({ x: event.clientX, y: event.clientY }), pic, area),
                true,
              );
            }}
          >
            <div
              ref={track}
              className="viewer-track"
              onTransitionEnd={(event) => {
                if (event.target === event.currentTarget && event.propertyName === 'translate')
                  landed();
              }}
            >
              {[at - 1, at, at + 1].map((i) => {
                const one = shots[i];
                if (one === undefined) return null;
                const side = i < at ? 'prev' : i > at ? 'next' : 'here';
                // Keyed on the picture, so the one that slid in is the same
                // element when it becomes the one shown: nothing reloads.
                return (
                  <div
                    key={one.media.id}
                    className="viewer-frame"
                    data-side={side}
                    aria-hidden={side === 'here' ? undefined : true}
                  >
                    {/* Contained, not covered: a photograph of people is not
                        wallpaper and must never have its edges cropped to
                        fill a screen. */}
                    <img
                      ref={side === 'here' ? picture : undefined}
                      className="viewer-shot"
                      src={mediaUrl(one.media.id)}
                      alt={side === 'here' ? t('view.title', { name: one.name }) : ''}
                      draggable={false}
                      data-testid={side === 'here' ? 'viewer-shot' : undefined}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          <div ref={foot} className="viewer-foot">
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
