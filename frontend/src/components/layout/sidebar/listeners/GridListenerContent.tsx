'use client';

import { useCallback } from 'react';
import { FpsLockedNotice } from './FpsLockedNotice';
import { SurfaceGridEditor } from './SurfaceGridEditor';
import { GRID_LISTENER_CONFIG } from '@/utils/constants';
import { useGridListenersStore } from '@/store';
import type { GridListenerData } from '@/types/receiver';

type BBox = { min: [number, number, number]; max: [number, number, number] };

interface GridListenerContentProps {
  grid: GridListenerData;
  color: string;
  onComputeBounds: (objectIds: string[]) => BBox | null;
  /** Grid powered (its points shown in the viewer). */
  isPowered: boolean;
  /** Viewer locked in the FPS view of one of this grid's points. */
  isInFPS: boolean;
  /** Power the grid on (no-op when already powered). */
  onPowerOn: () => void;
}

/**
 * GridListenerContent Component
 *
 * Grid listener card body: the shared surface editor (boundary, spacing, offset)
 * writing to the grid listeners store.
 */
export function GridListenerContent({
  grid,
  color,
  onComputeBounds,
  isPowered,
  isInFPS,
  onPowerOn,
}: GridListenerContentProps) {
  const onUpdate = useCallback(
    (updates: Partial<Omit<GridListenerData, 'id'>>) => useGridListenersStore.getState().updateGridListener(grid.id, updates),
    [grid.id],
  );
  const onSetBounds = useCallback(
    (ids: string[], bbox: BBox) => useGridListenersStore.getState().setGridListenerBounds(grid.id, ids, bbox),
    [grid.id],
  );

  return (
    <div className="card-stack">
      {isInFPS && <FpsLockedNotice />}
      <SurfaceGridEditor
        grid={grid}
        color={color}
        onComputeBounds={onComputeBounds}
        isPowered={isPowered}
        onPowerOn={onPowerOn}
        onUpdate={onUpdate}
        onSetBounds={onSetBounds}
        undoStoreId="gridListeners"
        defaultSpacing={GRID_LISTENER_CONFIG.DEFAULT_X_SPACING}
        pointNoun="listener point"
      />
    </div>
  );
}
