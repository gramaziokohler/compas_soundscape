import { useEffect, useState } from 'react';

interface FixedRowWindow {
  /** First row index to render (inclusive). */
  start: number;
  /** Last row index to render (exclusive). */
  end: number;
  /** Spacer height above the rendered rows (px). */
  padTop: number;
  /** Spacer height below the rendered rows (px). */
  padBottom: number;
}

/**
 * Windowing for a scroll container whose rows all have the same height: only
 * the rows inside the viewport (± `overscan`) are rendered, and two spacers
 * keep the total scroll height, so `scrollTop = index × rowHeight` still lands
 * on a row.
 *
 * A hidden container (`display: none`, clientHeight 0) renders no rows. Before
 * the first measurement, `initialRows` rows are rendered.
 *
 * @param containerRef - The scrolling element (overflow: auto).
 * @param rowCount - Total number of rows.
 * @param rowHeight - Fixed row height (px).
 * @param overscan - Extra rows rendered above and below the viewport.
 * @param initialRows - Rows to render before the container is measured.
 */
export function useFixedRowWindow(
  containerRef: React.RefObject<HTMLElement | null>,
  rowCount: number,
  rowHeight: number,
  overscan: number,
  initialRows: number,
): FixedRowWindow {
  const [viewport, setViewport] = useState<{ scrollTop: number; height: number } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let raf: number | null = null;
    const measure = () => {
      raf = null;
      setViewport((prev) => {
        const next = { scrollTop: el.scrollTop, height: el.clientHeight };
        return prev && prev.scrollTop === next.scrollTop && prev.height === next.height ? prev : next;
      });
    };
    const schedule = () => { if (raf === null) raf = requestAnimationFrame(measure); };
    measure();
    el.addEventListener('scroll', schedule, { passive: true });
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', schedule);
      ro.disconnect();
      if (raf !== null) cancelAnimationFrame(raf);
    };
    // The container element itself is mounted for the hook's lifetime; re-run
    // only if the row count changes the content height enough to matter.
  }, [containerRef, rowCount]);

  let start = 0;
  let end = Math.min(rowCount, initialRows);
  if (viewport) {
    if (viewport.height === 0) {
      end = 0;
    } else {
      start = Math.max(0, Math.floor(viewport.scrollTop / rowHeight) - overscan);
      end = Math.min(rowCount, Math.ceil((viewport.scrollTop + viewport.height) / rowHeight) + overscan);
    }
  }
  if (start > end) start = end;

  return {
    start,
    end,
    padTop: start * rowHeight,
    padBottom: Math.max(0, rowCount - end) * rowHeight,
  };
}
