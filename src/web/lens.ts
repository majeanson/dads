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

type Transitioning = Document & {
  startViewTransition?: (update: () => void) => { finished: Promise<void> };
};

/**
 * Change screens through the glasses.
 *
 * Going IN, the conversation opens out of the lens of the mark on the door,
 * as if he had leaned into it. Coming OUT, it shrinks back into the same lens.
 * A view transition does the drawing: the browser holds a picture of the old
 * screen and the new one, and the new one is clipped to the lens and let out
 * (or the old one taken in). `update` runs inside it synchronously, so by the
 * time anything can look, the DOM is already the new screen.
 *
 * Where there is no view transition (Firefox, older Safari), or the phone
 * wants less motion, or there is no lens to go through, it simply changes.
 */
export function throughLens(update: () => void, way: 'in' | 'out', mark: Element | null): void {
  const lens = lensOf(mark) ?? last;
  if (lens) last = lens;
  const doc = document as Transitioning;
  if (!doc.startViewTransition || lens === null || wantsStill()) {
    update();
    return;
  }
  const root = document.documentElement;
  const right = window.innerWidth - lens.left - lens.width;
  const bottom = window.innerHeight - lens.top - lens.height;
  root.style.setProperty(
    '--lens-inset',
    `${lens.top}px ${right}px ${bottom}px ${lens.left}px round ${lens.radius}px`,
  );
  root.dataset.lens = way;
  doc
    .startViewTransition(() => flushSync(update))
    .finished.catch(() => undefined)
    .finally(() => {
      delete root.dataset.lens;
    });
}
