import { useState, useRef, useCallback, useEffect } from 'react';

interface UseVerticalResizeOptions {
  /** Fraction (0–1) of the container height taken by the top section. */
  initialRatio: number;
  minRatio: number;
  maxRatio: number;
  onRatioChange?: (ratio: number) => void;
}

interface UseVerticalResizeReturn {
  ratio: number;
  isResizing: boolean;
  handleMouseDown: (e: React.MouseEvent) => void;
}

/**
 * Handles drag-to-resize behaviour for a vertical split inside a fixed-height
 * container (top section vs. bottom section). Mirrors `useSidebarResize` but
 * tracks a ratio of the container height instead of an absolute pixel width.
 *
 * The container height is read once at drag start from the handle's parent, so
 * the ratio stays correct even if the container resizes between drags.
 *
 * Attaches global mousemove/mouseup listeners only while dragging so there is
 * zero overhead during normal interaction.
 */
export function useVerticalResize({
  initialRatio,
  minRatio,
  maxRatio,
  onRatioChange,
}: UseVerticalResizeOptions): UseVerticalResizeReturn {
  const [ratio, setRatio] = useState(initialRatio);
  const [isResizing, setIsResizing] = useState(false);

  const startYRef = useRef(0);
  const startRatioRef = useRef(0);
  const containerHeightRef = useRef(0);

  // Sync external changes (e.g. Zustand persist rehydration) into local state,
  // but never overwrite a value mid-drag.
  useEffect(() => {
    if (!isResizing) setRatio(initialRatio);
  }, [initialRatio, isResizing]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    startYRef.current = e.clientY;
    startRatioRef.current = ratio;
    const container = (e.currentTarget as HTMLElement).parentElement;
    containerHeightRef.current = container ? container.getBoundingClientRect().height : window.innerHeight;
  }, [ratio]);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientY - startYRef.current;
      const containerHeight = containerHeightRef.current || 1;
      const newRatio = Math.min(
        maxRatio,
        Math.max(minRatio, startRatioRef.current + delta / containerHeight)
      );
      setRatio(newRatio);
      onRatioChange?.(newRatio);
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
  }, [isResizing, minRatio, maxRatio, onRatioChange]);

  return { ratio, isResizing, handleMouseDown };
}
