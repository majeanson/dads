import { useEffect } from 'react';

/**
 * The room is as tall as the part of the screen a dad can see.
 *
 * On a phone the keyboard does not shrink the page; it covers it. `100dvh` is
 * still the whole screen with the keyboard up, so a composer pinned to the
 * bottom of the room sits underneath the keys and iOS "helps" by scrolling
 * the whole document, half the header included, off the top. Android Chrome
 * can be told to resize the page instead (`interactive-widget` in the
 * viewport meta); iOS cannot, and this is the one way that works on both:
 * measure the visual viewport and make the room exactly that tall, so the
 * composer lands on top of the keyboard and the conversation gives up the
 * space rather than the header.
 *
 * `onResize` runs after the change, for the caller that wants the newest line
 * to stay in view when the list just lost a third of its height.
 */
export function useVisualViewport(onResize?: () => void): void {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;

    let last = -1;

    function fit() {
      if (!vv) return;
      // A pinch-zoomed viewport reports a height divided by the zoom. That is
      // a different question from "how much did the keyboard cover": measure
      // it back in layout pixels, so zooming (and panning, which fires
      // `scroll`) leaves the room the size it was.
      const zoomed = vv.scale > 1.01;
      const height = Math.round(vv.height * vv.scale);
      // iOS has sometimes already scrolled the layout viewport by the time
      // this fires. There is nothing up there to see; put it back. Not while
      // zoomed: the page is legitimately scrolled to where he is looking.
      if (!zoomed && window.scrollY !== 0) window.scrollTo(0, 0);
      // The room is a fixed layer, which stays where the LAYOUT viewport is;
      // when iOS slides the visual one down to keep a field in view, follow it.
      root.style.setProperty('--app-top', zoomed ? '0px' : `${Math.round(vv.offsetTop)}px`);
      // Nothing changed is nothing to do. Without this, `onResize` scrolls
      // the list into view, which pans a zoomed viewport, which fires
      // `scroll`, which comes back here — the flashing.
      if (height === last) return;
      last = height;
      root.style.setProperty('--app-h', `${height}px`);
      onResize?.();
    }

    fit();
    vv.addEventListener('resize', fit);
    vv.addEventListener('scroll', fit);
    return () => {
      vv.removeEventListener('resize', fit);
      vv.removeEventListener('scroll', fit);
      root.style.removeProperty('--app-h');
      root.style.removeProperty('--app-top');
    };
  }, [onResize]);
}
