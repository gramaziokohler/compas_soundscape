'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { RangeSlider } from '@/components/ui/RangeSlider';
import { HelperHint } from '@/components/ui/HelperHint';
import { GRID_LISTENER_CONFIG } from '@/utils/constants';
import { useGridListenersStore } from '@/store/gridListenersStore';
import { useSpeckleStore } from '@/store';
import type { GridListenerData } from '@/types/receiver';

interface GridListenerContentProps {
  grid: GridListenerData;
  color: string;
  onComputeBounds: (objectIds: string[]) => { min: [number, number, number]; max: [number, number, number] } | null;
}

type SelectionPhase = 'selecting' | 'ready';

export function GridListenerContent({ grid, color, onComputeBounds }: GridListenerContentProps) {
  const { updateGridListener, setGridListenerBounds } = useGridListenersStore();
  const selectedObjectIds = useSpeckleStore((s) => s.selectedObjectIds);

  const [phase, setPhase] = useState<SelectionPhase>(() => grid.boundingBox ? 'ready' : 'selecting');
  const selectionRef = useRef<string[]>([]);

  useEffect(() => {
    if (phase === 'selecting' && selectedObjectIds.length > 0) {
      selectionRef.current = [...selectedObjectIds];
    }
  }, [selectedObjectIds, phase]);

  useEffect(() => {
    if (phase !== 'selecting') return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Enter') { e.preventDefault(); handleValidate(); }
      else if (e.key === 'Escape') { e.preventDefault(); setPhase(grid.boundingBox ? 'ready' : 'selecting'); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, grid.boundingBox]);

  const startSelecting = useCallback(() => {
    selectionRef.current = [];
    setPhase('selecting');
  }, []);

  const handleValidate = useCallback(() => {
    const ids = selectionRef.current.length > 0 ? selectionRef.current : selectedObjectIds;
    if (ids.length === 0) { setPhase(grid.boundingBox ? 'ready' : 'selecting'); return; }
    const bbox = onComputeBounds(ids);
    if (bbox) { setGridListenerBounds(grid.id, ids, bbox); setPhase('ready'); }
    else { setPhase(grid.boundingBox ? 'ready' : 'selecting'); }
    selectionRef.current = [];
  }, [grid.id, grid.boundingBox, selectedObjectIds, onComputeBounds, setGridListenerBounds]);

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
      {phase === 'selecting' ? (
        <div className="flex items-center gap-1.5">
          <span className="flex-1 text-[10px] text-secondary-hover leading-snug">
            select one or multiples surfaces
          </span>
          <button
            onClick={handleValidate}
            className="w-6 h-6 flex-shrink-0 flex items-center justify-center rounded-md text-white transition-all cursor-pointer"
            style={{ backgroundColor: 'var(--color-success)' }}
            title="Validate selection"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <span className="flex-1 text-[10px] text-secondary-hover">
            {grid.points.length} listener point{grid.points.length !== 1 ? 's' : ''}
          </span>
          <button
            onClick={startSelecting}
            className="w-6 h-6 flex-shrink-0 flex items-center justify-center rounded-md text-secondary-hover hover:text-foreground hover:bg-secondary-light transition-all cursor-pointer"
            title="Recreate grid"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h5M20 20v-5h-5M20 9a8 8 0 00-14.32-3M4 15a8 8 0 0014.32 3" />
            </svg>
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

      <HelperHint
        text={
          phase === 'selecting'
            ? 'Hold shift to select multiple objects, press Enter when finished.'
            : null
        }
      />
    </div>
  );
}
