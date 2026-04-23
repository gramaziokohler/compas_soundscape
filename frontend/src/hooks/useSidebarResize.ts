import { useState, useRef, useCallback, useEffect } from 'react';

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

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    startXRef.current = e.clientX;
    startWidthRef.current = width;
  }, [width]);

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
