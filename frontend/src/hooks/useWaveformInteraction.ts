/**
 * Waveform Interaction Hook
 *
 * Manages zoom and pan interactions for audio waveform visualization.
 * Features:
 * - Mouse wheel zoom (centered on cursor position)
 * - Click-and-drag panning
 * - Double-click to reset view
 * - Programmatic reset function
 *
 * @module hooks/useWaveformInteraction
 */

import { useState, useCallback, useRef, RefObject, useEffect } from 'react';

export interface ViewportState {
  /** Zoom level (1 = normal, >1 = zoomed in) */
  zoom: number;
  /** Pan offset X in normalized coordinates (0-1) */
  panX: number;
  /** Pan offset Y in normalized coordinates (0-1) */
  panY: number;
}

export interface WaveformInteractionHook {
  /** Current viewport state */
  viewport: ViewportState;
  /** Whether user is currently dragging */
  isDragging: boolean;
  /** Reset viewport to default (zoom=1, pan=0) */
  resetViewport: () => void;
  /** Handle mouse wheel event for zooming */
  handleWheel: (e: WheelEvent) => void;
  /** Handle mouse down for drag start */
  handleMouseDown: (e: MouseEvent) => void;
  /** Handle mouse move for dragging */
  handleMouseMove: (e: MouseEvent) => void;
  /** Handle mouse up for drag end */
  handleMouseUp: () => void;
  /** Handle double click for reset */
  handleDoubleClick: () => void;
}

interface UseWaveformInteractionOptions {
  /** Canvas element ref */
  canvasRef: RefObject<HTMLCanvasElement | null>;
  /** Minimum zoom level (default: 1) */
  minZoom?: number;
  /** Maximum zoom level (default: 10) */
  maxZoom?: number;
  /** Zoom sensitivity (default: 0.001) */
  zoomSensitivity?: number;
}

const DEFAULT_VIEWPORT: ViewportState = { zoom: 1, panX: 0, panY: 0 };

/**
 * Custom hook for managing waveform zoom and pan interactions
 *
 * @param options - Configuration options
 * @returns Viewport state and event handlers
 */
export function useWaveformInteraction({
  canvasRef,
  minZoom = 1,
  maxZoom = 10,
  zoomSensitivity = 0.001
}: UseWaveformInteractionOptions): WaveformInteractionHook {
  const [viewport, setViewport] = useState<ViewportState>(DEFAULT_VIEWPORT);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  /**
   * Reset viewport to default state
   */
  const resetViewport = useCallback(() => {
    setViewport(DEFAULT_VIEWPORT);
  }, []);

  /**
   * Handle mouse wheel for zooming
   * Zooms centered on cursor position
   */
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = (e.clientX - rect.left) / rect.width;
    const mouseY = (e.clientY - rect.top) / rect.height;

    setViewport(prev => {
      // Calculate new zoom level
      const zoomDelta = -e.deltaY * zoomSensitivity;
      const newZoom = Math.max(minZoom, Math.min(maxZoom, prev.zoom + zoomDelta));

      // If zoom didn't change, don't update anything
      if (newZoom === prev.zoom) return prev;

      // Adjust pan to zoom towards cursor position
      const zoomRatio = newZoom / prev.zoom;
      const newPanX = prev.panX + (mouseX - 0.5) * (1 - 1 / zoomRatio);
      const newPanY = prev.panY + (mouseY - 0.5) * (1 - 1 / zoomRatio);

      // Constrain pan to valid range
      const maxPanX = (newZoom - 1) / (2 * newZoom);
      const maxPanY = (newZoom - 1) / (2 * newZoom);

      return {
        zoom: newZoom,
        panX: Math.max(-maxPanX, Math.min(maxPanX, newPanX)),
        panY: Math.max(-maxPanY, Math.min(maxPanY, newPanY))
      };
    });
  }, [canvasRef, minZoom, maxZoom, zoomSensitivity]);

  /**
   * Handle mouse down to start dragging
   */
  const handleMouseDown = useCallback((e: MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      panX: viewport.panX,
      panY: viewport.panY
    };
  }, [canvasRef, viewport.panX, viewport.panY]);

  /**
   * Handle mouse move for dragging
   */
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging || !dragStartRef.current) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    // Store dragStart in a local variable to prevent race conditions
    const dragStart = dragStartRef.current;

    const rect = canvas.getBoundingClientRect();
    const deltaX = (e.clientX - dragStart.x) / rect.width;
    const deltaY = (e.clientY - dragStart.y) / rect.height;

    setViewport(prev => {
      // Calculate new pan position
      const newPanX = dragStart.panX - deltaX;
      const newPanY = dragStart.panY - deltaY;

      // Constrain pan to valid range based on zoom level
      const maxPanX = (prev.zoom - 1) / (2 * prev.zoom);
      const maxPanY = (prev.zoom - 1) / (2 * prev.zoom);

      return {
        ...prev,
        panX: Math.max(-maxPanX, Math.min(maxPanX, newPanX)),
        panY: Math.max(-maxPanY, Math.min(maxPanY, newPanY))
      };
    });
  }, [isDragging, canvasRef]);

  /**
   * Handle mouse up to end dragging
   */
  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    dragStartRef.current = null;
  }, []);

  /**
   * Handle double click to reset viewport
   */
  const handleDoubleClick = useCallback(() => {
    resetViewport();
  }, [resetViewport]);

  // Attach/detach event listeners
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.addEventListener('wheel', handleWheel, { passive: false });
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('dblclick', handleDoubleClick);

    return () => {
      canvas.removeEventListener('wheel', handleWheel);
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('dblclick', handleDoubleClick);
    };
  }, [canvasRef, handleWheel, handleMouseDown, handleDoubleClick]);

  // Attach mouse move/up to window for smooth dragging
  useEffect(() => {
    if (!isDragging) return;

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, handleMouseMove, handleMouseUp]);

  return {
    viewport,
    isDragging,
    resetViewport,
    handleWheel,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleDoubleClick
  };
}
