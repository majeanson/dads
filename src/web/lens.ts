import { flushSync } from 'react-dom';
import { LEFT_LENS, wantsStill } from './Splash';

interface Lens {
  left: number;
  top: number;
  width: number;
  height: number;
  radius: number;
}

/** The left lens of a mark on the screen, in viewport pixels. */
function lensOf(mark: Element | null): Lens | null {
  const box = mark?.getBoundingClientRect();
  if (!box || box.width === 0) return null;
  return {
    left: box.left + LEFT_LENS.x * box.width,
    top: box.top + LEFT_LENS.y * box.height,
    width: LEFT_LENS.w * box.width,
    height: LEFT_LENS.h * box.height,
    radius: LEFT_LENS.r * box.width,
  };
}

/** The last lens gone through, for the way back: by then home is hidden and
 * its mark has no box to measure. */
let last: Lens | null = null;

/** Note the lens on the way in, which is drawn by the splash, not here. */
export function noteLens(mark: Element | null): void {
  last = lensOf(mark) ?? last;
}

type Transitioning = Document & {
  startViewTransition?: (update: () => void) => { finished: Promise<void> };
};

/**
 * Change screens through the glasses.
 *
 * Coming OUT of the conversation is the zoom into the glasses backwards: the
 * chat shrinks into the lens of the door's mark and home comes back around it.
 * (Going in is drawn live by Splash, which stays sharp where a zoomed picture
 * of a 32px mark would not.) A view transition does the drawing:
 * the browser holds a picture of each screen, one is scaled about the lens
 * and the other clipped to it. `update` runs inside it synchronously, so by the
 * time anything can look, the DOM is already the new screen.
 *
 * Where there is no view transition (Firefox, older Safari), or the phone
 * wants less motion, or there is no lens to go through, it simply changes.
 */
export function throughLens(update: () => void, way: 'out', mark: Element | null): void {
  const lens = lensOf(mark) ?? last;
  if (lens) last = lens;
  const doc = document as Transitioning;
  if (!doc.startViewTransition || lens === null || wantsStill()) {
    update();
    return;
  }
  const root = document.documentElement;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // The camera flies into the lens: the home screen scales about the lens's
  // centre by `zoom`, and the conversation is clipped to the lens as that
  // scale draws it — the same rectangle, grown by the same factor, so the
  // chat is always exactly what is inside the glass. `zoom` is just enough
  // for the grown lens to cover the screen.
  const cx = lens.left + lens.width / 2;
  const cy = lens.top + lens.height / 2;
  const zoom = Math.max(
    cx / (lens.width / 2),
    (vw - cx) / (lens.width / 2),
    cy / (lens.height / 2),
    (vh - cy) / (lens.height / 2),
  );
  const inset = (s: number) => {
    const w = (lens.width / 2) * s;
    const h = (lens.height / 2) * s;
    return `${cy - h}px ${vw - cx - w}px ${vh - cy - h}px ${cx - w}px round ${lens.radius * s}px`;
  };
  root.style.setProperty('--lens-from', inset(1));
  root.style.setProperty('--lens-to', inset(zoom));
  root.style.setProperty('--lens-origin', `${cx}px ${cy}px`);
  root.style.setProperty('--lens-zoom', String(zoom));
  root.dataset.lens = way;
  doc
    .startViewTransition(() => flushSync(update))
    .finished.catch(() => undefined)
    .finally(() => {
      delete root.dataset.lens;
    });
}
