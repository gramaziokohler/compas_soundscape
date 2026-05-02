'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { RangeSlider } from '@/components/ui/RangeSlider';
import { CheckboxField } from '@/components/ui/CheckboxField';
import { GRID_LISTENER_CONFIG } from '@/utils/constants';
import { useGridListenersStore } from '@/store/gridListenersStore';
import { useSpeckleStore } from '@/store';
import type { GridListenerData } from '@/types/receiver';

interface GridListenerCardProps {
  grid: GridListenerData;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onDelete: () => void;
  onComputeBounds: (
    objectIds: string[],
  ) => { min: [number, number, number]; max: [number, number, number] } | null;
  color: string;
  index: number;
}

type SelectionPhase = 'idle' | 'selecting' | 'ready';

export function GridListenerCard({
  grid,
  isExpanded,
  onToggleExpand,
  onDelete,
  onComputeBounds,
  color,
  index,
}: GridListenerCardProps) {
  const {
    updateGridListener,
    setGridListenerBounds,
    toggleGridListenerHiddenForSimulation,
  } = useGridListenersStore();

  const selectedObjectIds = useSpeckleStore((s) => s.selectedObjectIds);

  const [phase, setPhase] = useState<SelectionPhase>(() =>
    grid.boundingBox ? 'ready' : 'idle',
  );
  const [isEditingName, setIsEditingName] = useState(false);
  const [editName, setEditName] = useState(grid.name);

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

  // Pause zundo temporal during drag to avoid snapshotting points on every tick
  const handleDragStart = useCallback(() => {
    useGridListenersStore.temporal.getState().pause();
  }, []);

  const handleSpacingChange = useCallback(
    (field: 'xSpacing' | 'ySpacing' | 'zOffset', value: number) => {
      updateGridListener(grid.id, { [field]: value });
    },
    [grid.id, updateGridListener],
  );

  // Resume temporal on pointer-up (takes one snapshot for undo)
  const handleDragEnd = useCallback(
    (field: 'xSpacing' | 'ySpacing' | 'zOffset', value: number) => {
      updateGridListener(grid.id, { [field]: value });
      useGridListenersStore.temporal.getState().resume();
    },
    [grid.id, updateGridListener],
  );

  const handleNameSave = useCallback(() => {
    if (editName.trim()) updateGridListener(grid.id, { name: editName.trim() });
    setIsEditingName(false);
  }, [grid.id, editName, updateGridListener]);

  const btnLabel =
    phase === 'selecting' ? 'Validate selection' : phase === 'ready' ? 'Recreate grid' : 'Select objects';

  const btnColor =
    phase === 'selecting' ? 'var(--color-success)' : phase === 'ready' ? 'var(--color-secondary-hover)' : color;

  return (
    <div
      className="rounded-lg transition-all duration-200 p-2"
      style={{
        '--card-color': color,
        backgroundColor: isExpanded ? `${color}18` : 'var(--color-secondary-lighter, #f8fafc)',
        border: isExpanded ? `1px solid ${color}55` : '1px solid transparent',
        opacity: grid.hiddenForSimulation ? 0.55 : 1,
      } as React.CSSProperties}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        {isEditingName ? (
          <input
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={handleNameSave}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleNameSave();
              if (e.key === 'Escape') setIsEditingName(false);
            }}
            autoFocus
            className="flex-1 text-xs font-medium px-2 py-0.5 rounded-lg border outline-none focus:ring-1 bg-background text-foreground"
            style={{ borderColor: color }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <button
            className="flex-1 text-left text-xs font-medium transition-opacity group cursor-pointer min-w-0 overflow-hidden"
            style={{ color: isExpanded ? color : 'var(--color-foreground)' }}
            onClick={onToggleExpand}
            onDoubleClick={() => { setEditName(grid.name); setIsEditingName(true); }}
            title="Click to expand. Double-click to rename"
          >
            <div className="truncate">
              {index + 1}. {grid.name}
              {grid.hiddenForSimulation && (
                <span className="ml-1 text-[9px] text-warning opacity-70">(hidden)</span>
              )}
              <span className="text-[10px] ml-1 opacity-0 group-hover:opacity-40 transition-opacity">✏️</span>
            </div>
          </button>
        )}

        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); toggleGridListenerHiddenForSimulation(grid.id); }}
            className={`w-5 h-5 flex items-center justify-center rounded-full transition-colors ${
              grid.hiddenForSimulation
                ? 'bg-warning-light text-warning'
                : 'text-secondary-hover hover:bg-secondary-light hover:text-foreground'
            }`}
            title={grid.hiddenForSimulation ? 'Show for simulation' : 'Hide for simulation'}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              {grid.hiddenForSimulation ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" clipRule="evenodd" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
              )}
            </svg>
          </button>

          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="w-5 h-5 flex items-center justify-center rounded-full transition-colors text-secondary-hover hover:bg-error-light hover:text-error flex-shrink-0"
            title="Delete grid listener"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div className="mt-2 pt-2 border-t space-y-2" style={{ borderColor: `${color}33` }}>
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
            <div
              className="text-[10px] rounded-lg px-2 py-1.5 text-white leading-relaxed"
              style={{ backgroundColor: 'color-mix(in srgb, var(--color-success) 80%, transparent)' }}
            >
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
      )}
    </div>
  );
}
