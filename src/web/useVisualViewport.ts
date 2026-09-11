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

    function fit() {
      if (!vv) return;
      root.style.setProperty('--app-h', `${Math.round(vv.height)}px`);
      // iOS has sometimes already scrolled the layout viewport by the time
      // this fires. There is nothing up there to see; put it back.
      if (window.scrollY !== 0) window.scrollTo(0, 0);
      onResize?.();
    }

    fit();
    vv.addEventListener('resize', fit);
    vv.addEventListener('scroll', fit);
    return () => {
      vv.removeEventListener('resize', fit);
      vv.removeEventListener('scroll', fit);
      root.style.removeProperty('--app-h');
    };
  }, [onResize]);
}
