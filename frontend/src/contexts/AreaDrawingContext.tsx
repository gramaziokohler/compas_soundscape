/**
 * AreaDrawingContext
 *
 * Cross-component state for the polygon area drawing feature.
 * Follows the ref-based pattern from AcousticMaterialContext to avoid
 * re-render cascades between sidebar and 3D scene.
 *
 * Producers: AnalysisSection (start/cancel), SpeckleScene (finish)
 * Consumers: TextContextContent (status), SpeckleScene (drawing mode),
 *            useAnalysis (position generation)
 */

'use client';

import {
  createContext,
  useContext,
  useCallback,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { DrawnArea, AreaVisualState } from '@/types/area-drawing';

// ============================================================================
// Types
// ============================================================================

interface AreaDrawingContextValue {
  /** Map of card index → drawn area */
  drawnAreas: Map<number, DrawnArea>;
  /** Map of card index → visual state */
  areaVisualStates: Map<number, AreaVisualState>;
  /** Whether drawing mode is active */
  isDrawing: boolean;
  /** Card index currently being drawn for */
  drawingCardIndex: number | null;
  /** Version counter to notify consumers of state changes */
  version: number;

  // Actions
  startDrawing: (cardIndex: number) => void;
  cancelDrawing: () => void;
  finishDrawing: (cardIndex: number, area: DrawnArea) => void;
  removeArea: (cardIndex: number) => void;
  setAreaVisualState: (cardIndex: number, state: AreaVisualState) => void;
  getArea: (cardIndex: number) => DrawnArea | undefined;
  hasArea: (cardIndex: number) => boolean;
}

// ============================================================================
// Context
// ============================================================================

const AreaDrawingContext = createContext<AreaDrawingContextValue | null>(null);

// ============================================================================
// Provider
// ============================================================================

export function AreaDrawingProvider({ children }: { children: ReactNode }) {
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawingCardIndex, setDrawingCardIndex] = useState<number | null>(null);
  const [version, setVersion] = useState(0);

  // Store areas in refs for stable reads; version triggers re-renders
  const areasRef = useRef<Map<number, DrawnArea>>(new Map());
  const visualStatesRef = useRef<Map<number, AreaVisualState>>(new Map());

  const startDrawing = useCallback((cardIndex: number) => {
    setIsDrawing(true);
    setDrawingCardIndex(cardIndex);
    setVersion((v) => v + 1);
  }, []);

  const cancelDrawing = useCallback(() => {
    setIsDrawing(false);
    setDrawingCardIndex(null);
    setVersion((v) => v + 1);
  }, []);

  const finishDrawing = useCallback((cardIndex: number, area: DrawnArea) => {
    areasRef.current.set(cardIndex, area);
    visualStatesRef.current.set(cardIndex, 'default');
    setIsDrawing(false);
    setDrawingCardIndex(null);
    setVersion((v) => v + 1);
  }, []);

  const removeArea = useCallback((cardIndex: number) => {
    areasRef.current.delete(cardIndex);
    visualStatesRef.current.delete(cardIndex);
    setVersion((v) => v + 1);
  }, []);

  const setAreaVisualState = useCallback(
    (cardIndex: number, state: AreaVisualState) => {
      visualStatesRef.current.set(cardIndex, state);
      setVersion((v) => v + 1);
    },
    []
  );

  const getArea = useCallback(
    (cardIndex: number): DrawnArea | undefined => areasRef.current.get(cardIndex),
    []
  );

  const hasArea = useCallback(
    (cardIndex: number): boolean => areasRef.current.has(cardIndex),
    []
  );

  // Derive snapshot maps from refs each render (cheap — just Map references)
  const drawnAreas = areasRef.current;
  const areaVisualStates = visualStatesRef.current;

  return (
    <AreaDrawingContext.Provider
      value={{
        drawnAreas,
        areaVisualStates,
        isDrawing,
        drawingCardIndex,
        version,
        startDrawing,
        cancelDrawing,
        finishDrawing,
        removeArea,
        setAreaVisualState,
        getArea,
        hasArea,
      }}
    >
      {children}
    </AreaDrawingContext.Provider>
  );
}

// ============================================================================
// Hooks
// ============================================================================

export function useAreaDrawingContext() {
  const ctx = useContext(AreaDrawingContext);
  if (!ctx) {
    throw new Error('useAreaDrawingContext must be used within AreaDrawingProvider');
  }
  return ctx;
}
