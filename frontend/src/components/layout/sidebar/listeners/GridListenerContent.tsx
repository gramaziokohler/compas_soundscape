'use client';

import { useCallback } from 'react';
import { RangeSlider } from '@/components/ui/RangeSlider';
import { ObjectPickerBar } from '@/components/ui/ObjectPickerBar';
import { GRID_LISTENER_CONFIG } from '@/utils/constants';
import { useGridListenersStore } from '@/store/gridListenersStore';
import { useObjectSelectionPhase } from '@/hooks/useObjectSelectionPhase';
import { RefreshIcon } from '@/components/ui/Icon';
import type { GridListenerData } from '@/types/receiver';

interface GridListenerContentProps {
  grid: GridListenerData;
  color: string;
  onComputeBounds: (objectIds: string[]) => { min: [number, number, number]; max: [number, number, number] } | null;
}

export function GridListenerContent({ grid, color, onComputeBounds }: GridListenerContentProps) {
  const { updateGridListener, setGridListenerBounds } = useGridListenersStore();

  // Selecting phase owned by the shared hook — Enter commits, Escape/cancel
  // clears BOTH the Speckle SelectionExtension highlight and the app state.
  const {
    isSelecting,
    selectedObjectIds,
    startSelecting,
    commit,
    cancel,
  } = useObjectSelectionPhase({
    active: true,
    hasConfirmedSelection: !!grid.boundingBox,
    onEnterSelecting: () => {
      // Destroy the current listener meshes by clearing bounds + points immediately.
      updateGridListener(grid.id, { selectedObjectIds: [], boundingBox: null, points: [] });
    },
    onCommit: (ids) => {
      const bbox = onComputeBounds(ids);
      if (bbox) {
        setGridListenerBounds(grid.id, ids, bbox);
        return true;
      }
      return false;
    },
    deps: [grid.id, onComputeBounds, setGridListenerBounds, updateGridListener],
  });

  const handleDragStart = useCallback(() => {
    useGridListenersStore.temporal.getState().pause();
  }, []);

  const handleSpacingChange = useCallback((field: 'xSpacing' | 'ySpacing' | 'zOffset', value: number) => {
    updateGridListener(grid.id, { [field]: value });
  }, [grid.id, updateGridListener]);

  const handleDragEnd = useCallback((field: 'xSpacing' | 'ySpacing' | 'zOffset', value: number) => {
    updateGridListener(grid.id, { [field]: value });
    useGridListenersStore.temporal.getState().resume();
  }, [grid.id, updateGridListener]);

  return (
    <div className="space-y-2">
      {/* Top control row */}
      <ObjectPickerBar
        isSelecting={isSelecting}
        selectedCount={selectedObjectIds.length}
        message="Select one or multiple surfaces on the model, then validate."
        confirmLabel="Validate"
        cancelLabel="Cancel"
        onConfirm={commit}
        onCancel={cancel}
      />
      {!isSelecting && (
        <div className="flex items-center gap-1.5">
          <span className="flex-1 text-[10px] text-secondary-hover">
            {grid.points.length} listener point{grid.points.length !== 1 ? 's' : ''}
          </span>
          <button
            onClick={startSelecting}
            className="w-6 h-6 flex-shrink-0 flex items-center justify-center rounded-md text-secondary-hover hover:text-foreground hover:bg-secondary-light transition-all cursor-pointer"
            title="Recreate grid"
          >
            <RefreshIcon size="0.75rem" />
          </button>
        </div>
      )}

      <RangeSlider
        inline
        label="X"
        value={grid.xSpacing}
        min={GRID_LISTENER_CONFIG.MIN_SPACING}
        max={GRID_LISTENER_CONFIG.MAX_SPACING}
        step={0.5}
        defaultValue={GRID_LISTENER_CONFIG.DEFAULT_X_SPACING}
        color={color}
        formatValue={(v) => `${v.toFixed(1)} m`}
        onDragStart={handleDragStart}
        onChange={(v) => handleSpacingChange('xSpacing', v)}
        onChangeCommitted={(v) => handleDragEnd('xSpacing', v)}
      />
      <RangeSlider
        inline
        label="Y"
        value={grid.ySpacing}
        min={GRID_LISTENER_CONFIG.MIN_SPACING}
        max={GRID_LISTENER_CONFIG.MAX_SPACING}
        step={0.5}
        defaultValue={GRID_LISTENER_CONFIG.DEFAULT_Y_SPACING}
        color={color}
        formatValue={(v) => `${v.toFixed(1)} m`}
        onDragStart={handleDragStart}
        onChange={(v) => handleSpacingChange('ySpacing', v)}
        onChangeCommitted={(v) => handleDragEnd('ySpacing', v)}
      />
      <RangeSlider
        inline
        label="Z"
        value={grid.zOffset}
        min={GRID_LISTENER_CONFIG.MIN_Z_OFFSET}
        max={GRID_LISTENER_CONFIG.MAX_Z_OFFSET}
        step={0.1}
        defaultValue={GRID_LISTENER_CONFIG.DEFAULT_Z_OFFSET}
        color={color}
        formatValue={(v) => `${v.toFixed(1)} m`}
        onDragStart={handleDragStart}
        onChange={(v) => handleSpacingChange('zOffset', v)}
        onChangeCommitted={(v) => handleDragEnd('zOffset', v)}
      />
    </div>
  );
}