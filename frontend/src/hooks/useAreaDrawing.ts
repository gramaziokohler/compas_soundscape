/**
 * useAreaDrawing Hook
 *
 * Convenience wrapper around AreaDrawingContext for a specific card index.
 * Used by TextContextContent and AnalysisSection to interact with the
 * area drawing state for a single analysis card.
 */

import { useMemo } from 'react';
import { useAreaDrawingContext } from '@/contexts/AreaDrawingContext';

export function useAreaDrawing(cardIndex: number) {
  const ctx = useAreaDrawingContext();

  return useMemo(() => ({
    area: ctx.getArea(cardIndex),
    hasArea: ctx.hasArea(cardIndex),
    visualState: ctx.areaVisualStates.get(cardIndex) ?? 'default',
    isDrawingThisCard: ctx.isDrawing && ctx.drawingCardIndex === cardIndex,
    isAnyDrawing: ctx.isDrawing,
    startDrawing: () => ctx.startDrawing(cardIndex),
    cancelDrawing: ctx.cancelDrawing,
    removeArea: () => ctx.removeArea(cardIndex),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [cardIndex, ctx.version]);
}
