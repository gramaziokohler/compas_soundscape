'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { RangeSlider } from '@/components/ui/RangeSlider';
import { CheckboxField } from '@/components/ui/CheckboxField';
import { GRID_LISTENER_CONFIG } from '@/utils/constants';
import { useGridListenersStore } from '@/store/gridListenersStore';
import { useSpeckleStore } from '@/store';
import type { GridListenerData } from '@/types/receiver';

interface GridListenerContentProps {
  grid: GridListenerData;
  color: string;
  onComputeBounds: (objectIds: string[]) => { min: [number, number, number]; max: [number, number, number] } | null;
}

type SelectionPhase = 'idle' | 'selecting' | 'ready';

export function GridListenerContent({ grid, color, onComputeBounds }: GridListenerContentProps) {
  const { updateGridListener, setGridListenerBounds } = useGridListenersStore();
  const selectedObjectIds = useSpeckleStore((s) => s.selectedObjectIds);

  const [phase, setPhase] = useState<SelectionPhase>(() => grid.boundingBox ? 'ready' : 'idle');
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
      else if (e.key === 'Escape') { e.preventDefault(); setPhase(grid.boundingBox ? 'ready' : 'idle'); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, grid.boundingBox]);

  const handleValidate = useCallback(() => {
    const ids = selectionRef.current.length > 0 ? selectionRef.current : selectedObjectIds;
    if (ids.length === 0) { setPhase(grid.boundingBox ? 'ready' : 'idle'); return; }
    const bbox = onComputeBounds(ids);
    if (bbox) { setGridListenerBounds(grid.id, ids, bbox); setPhase('ready'); }
    else { setPhase(grid.boundingBox ? 'ready' : 'idle'); }
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

  const btnLabel = phase === 'selecting' ? 'Validate selection' : phase === 'ready' ? 'Recreate grid' : 'Select objects';
  const btnColor = phase === 'selecting' ? 'var(--color-success)' : phase === 'ready' ? 'var(--color-secondary-hover)' : color;

  return (
    <div className="space-y-2">
      <RangeSlider
        label="X spacing"
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
        showLabels={false}
      />
      <RangeSlider
        label="Y spacing"
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
        showLabels={false}
      />
      <RangeSlider
        label="Z offset"
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
        showLabels={false}
      />

      <CheckboxField
        checked={grid.showListeners}
        onChange={(v) => updateGridListener(grid.id, { showListeners: v })}
        label="Show listeners"
      />

      {grid.boundingBox && (
        <div className="text-[10px] text-secondary-hover">
          {grid.points.length} listener point{grid.points.length !== 1 ? 's' : ''}
        </div>
      )}

      {phase === 'selecting' && (
        <div className="text-[10px] rounded-lg px-2 py-1.5 text-white leading-relaxed" style={{ backgroundColor: 'color-mix(in srgb, var(--color-success) 80%, transparent)' }}>
          Select one or multiple surfaces. Press Enter or click the button to validate. Esc to cancel.
        </div>
      )}

      <div className="flex justify-center">
        <button
          onClick={() => {
            if (phase === 'selecting') handleValidate();
            else { selectionRef.current = []; setPhase('selecting'); }
          }}
          className="py-1.5 px-4 rounded-lg text-xs font-medium text-white transition-all"
          style={{ backgroundColor: btnColor }}
        >
          {btnLabel}
        </button>
      </div>
    </div>
  );
}
