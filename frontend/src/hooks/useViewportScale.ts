import { useEffect, useState } from 'react';
import { buildScale, getViewport, setViewport, type Scale } from '@/utils/scale';

/**
 * Tracks the CSS-pixel viewport (window resize + browser zoom via visualViewport)
 * and exposes a `Scale` object for fluid / clamped-fluid sizing. It also publishes
 * the live size as CSS custom properties on <html> so static CSS can participate
 * without any JS:
 *
 *   --ui-vw   (px) — current viewport width
 *   --ui-vh   (px) — current viewport height
 *   --ui-dvh  (px) — dynamic viewport height (clears collapsing browser chrome)
 *
 * Mount once at the app root (outside any Suspense boundary) so every consumer
 * of `getScale()` / these CSS vars sees an up-to-date viewport.
 */
export function useViewportScale(): Scale {
  const [viewport, setViewportState] = useState(getViewport);

  useEffect(() => {
    let raf = 0;

    const sync = () => {
      raf = 0;
      const w = window.visualViewport?.width ?? window.innerWidth;
      const h = window.visualViewport?.height ?? window.innerHeight;
      setViewport(w, h);
      setViewportState(getViewport());

      const root = document.documentElement;
      root.style.setProperty('--ui-vw', `${w}px`);
      root.style.setProperty('--ui-vh', `${h}px`);
      root.style.setProperty('--ui-dvh', `${window.innerHeight}px`);
    };

    // Throttle via rAF so rapid (visualViewport) resize bursts coalesce.
    const requestSync = () => {
      if (raf) return;
      raf = requestAnimationFrame(sync);
    };

    sync(); // apply immediately on mount

    const vv = window.visualViewport;
    vv?.addEventListener('resize', requestSync);
    vv?.addEventListener('scroll', requestSync);
    window.addEventListener('resize', requestSync);
    window.addEventListener('orientationchange', requestSync);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      vv?.removeEventListener('resize', requestSync);
      vv?.removeEventListener('scroll', requestSync);
      window.removeEventListener('resize', requestSync);
      window.removeEventListener('orientationchange', requestSync);
    };
  }, []);

  return buildScale(viewport);
}