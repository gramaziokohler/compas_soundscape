import { useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react';

interface UseSidebarResizeOptions {
  initialWidth: number;
  minWidth: number;
  maxWidth: number;
  /**
   * 'right' — handle is on the right edge; dragging right grows, left shrinks (left sidebar).
   * 'left'  — handle is on the left edge; dragging left grows, right shrinks (right sidebar).
   */
  direction: 'right' | 'left';
  onWidthChange?: (width: number) => void;
}

interface UseSidebarResizeReturn {
  width: number;
  isResizing: boolean;
  handleMouseDown: (e: React.MouseEvent) => void;
}

/**
 * Handles drag-to-resize behaviour for panel sidebars.
 *
 * Attaches global mousemove/mouseup listeners only while dragging so there is
 * zero overhead during normal interaction.
 */
export function useSidebarResize({
  initialWidth,
  minWidth,
  maxWidth,
  direction,
  onWidthChange,
}: UseSidebarResizeOptions): UseSidebarResizeReturn {
  const [width, setWidth] = useState(initialWidth);
  const [isResizing, setIsResizing] = useState(false);

  const startXRef = useRef(0);
  const startWidthRef = useRef(0);
  // Until the user drags, width tracks the resolution-banded CSS default.
  // After a drag, only min/max re-clamps apply (window resize must not
  // re-expand the panel as a fraction of the viewport).
  const userHasDraggedRef = useRef(false);
  const didReportRef = useRef(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    userHasDraggedRef.current = true;
    setIsResizing(true);
    startXRef.current = e.clientX;
    startWidthRef.current = width;
  }, [width]);

  // Re-clamp whenever min/max/default change (breakpoint step or viewport
  // overflow). Always report the initial width even when it did not change —
  // otherwise consumers (scene control buttons) keep a stale fallback. Runs
  // in useLayoutEffect so the parent can position overlays before first paint.
  useLayoutEffect(() => {
    if (isResizing) return;
    const target = userHasDraggedRef.current ? width : initialWidth;
    const clamped = Math.min(maxWidth, Math.max(minWidth, Math.round(target)));
    const widthChanged = clamped !== width;
    if (widthChanged) {
      setWidth(clamped);
    }
    if (!didReportRef.current || widthChanged) {
      didReportRef.current = true;
      onWidthChange?.(clamped);
    }
  }, [width, initialWidth, minWidth, maxWidth, isResizing, onWidthChange]);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - startXRef.current;
      const newWidth =
        direction === 'right'
          ? Math.min(maxWidth, Math.max(minWidth, startWidthRef.current + delta))
          : Math.min(maxWidth, Math.max(minWidth, startWidthRef.current - delta));

      setWidth(newWidth);
      onWidthChange?.(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, direction, minWidth, maxWidth, onWidthChange]);

  return { width, isResizing, handleMouseDown };
}
