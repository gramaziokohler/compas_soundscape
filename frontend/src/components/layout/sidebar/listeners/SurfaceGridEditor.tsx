'use client';

import { useCallback, useEffect, useRef } from 'react';
import { RangeSlider } from '@/components/ui/RangeSlider';
import { ObjectPickerBar } from '@/components/ui/ObjectPickerBar';
import { OptionToggle } from '@/components/ui/OptionToggle';
import { AreaDrawingBanner } from '@/components/ui/AreaDrawingBanner';
import { Notice } from '@/components/ui/Notice';
import { GRID_LISTENER_CONFIG } from '@/utils/constants';
import { useAreaDrawingStore, pauseStore, commitStore } from '@/store';
import { useObjectSelectionPhase } from '@/hooks/useObjectSelectionPhase';
import { RefreshIcon } from '@/components/ui/Icon';
import type { GridListenerData, GridPlacementMode } from '@/types/receiver';

type BBox = { min: [number, number, number]; max: [number, number, number] };
type SpacingField = 'xSpacing' | 'ySpacing' | 'zOffset';

export interface SurfaceGridEditorProps {
  /** The surface being edited (grid listener or heatmap). */
  grid: GridListenerData;
  color: string;
  onComputeBounds: (objectIds: string[]) => BBox | null;
  /** Card powered. */
  isPowered: boolean;
  /** Power the card on (no-op when already powered). */
  onPowerOn: () => void;
  /** Store writes of the owning card kind. */
  onUpdate: (updates: Partial<Omit<GridListenerData, 'id'>>) => void;
  onSetBounds: (objectIds: string[], bbox: BBox) => void;
  /** Undo-registry id of the owning store (one undo step per slider drag). */
  undoStoreId: string;
  /** Default X / Y spacing (double-click reset of the sliders). */
  defaultSpacing: number;
  /** Noun of one point in the count line ("listener point", "map point"). */
  pointNoun: string;
}

const PLACEMENT_OPTIONS = [
  {
    value: 'objects' as const,
    label: 'Select objects',
    title: 'Spread the points over the bounding box of surfaces picked in the viewer',
  },
  {
    value: 'area' as const,
    label: 'Draw area',
    tone: 'warning' as const,
    title: 'Draw a polygon in the viewer and keep the points inside it',
  },
];

/**
 * SurfaceGridEditor Component
 *
 * Defines a grid of points over a surface — shared by the Grid listener and the
 * Heatmap cards. While there is no boundary yet, the user picks how to define it:
 * "Select objects" (bounding box of picked surfaces, default) or "Draw area"
 * (polygon drawn in the viewer, points clipped to it). Once confirmed, it shows
 * the point count, a recreate button and the spacing / offset sliders.
 */
export function SurfaceGridEditor({
  grid,
  color,
  onComputeBounds,
  isPowered,
  onPowerOn,
  onUpdate,
  onSetBounds,
  undoStoreId,
  defaultSpacing,
  pointNoun,
}: SurfaceGridEditorProps) {
  const mode: GridPlacementMode = grid.placementMode ?? 'objects';
  const hasBoundary = !!grid.boundingBox;

  const isAnyDrawing = useAreaDrawingStore((s) => s.isDrawing);
  const isDrawingThisGrid = useAreaDrawingStore(
    (s) => s.isDrawing && s.drawingGridListenerId === grid.id,
  );

  /** Drop the current boundary + points and switch to `next` mode. */
  const clearBoundary = useCallback((next: GridPlacementMode) => {
    onUpdate({
      placementMode: next,
      selectedObjectIds: [],
      boundingBox: null,
      drawnArea: null,
      points: [],
    });
  }, [onUpdate]);

  // Selecting phase owned by the shared hook — Enter commits, Escape/cancel
  // clears BOTH the Speckle SelectionExtension highlight and the app state.
  // Only live in "Select objects" mode so its Enter/Escape never fight drawing.
  const {
    isSelecting,
    selectedObjectIds,
    startSelecting,
    commit,
    cancel,
  } = useObjectSelectionPhase({
    active: mode === 'objects',
    hasConfirmedSelection: hasBoundary,
    onEnterSelecting: () => clearBoundary('objects'),
    onCommit: (ids) => {
      const bbox = onComputeBounds(ids);
      if (bbox) {
        onSetBounds(ids, bbox);
        return true;
      }
      return false;
    },
    deps: [grid.id, onComputeBounds, onSetBounds, clearBoundary],
  });

  const startDrawing = useCallback(() => {
    clearBoundary('area');
    // The drawn polygon commits to whichever store owns this id (useSpeckleAreaDrawing).
    useAreaDrawingStore.getState().startGridDrawing(grid.id);
  }, [clearBoundary, grid.id]);

  const cancelDrawing = useCallback(() => {
    useAreaDrawingStore.getState().cancelDrawing();
  }, []);

  const confirmDrawing = useCallback(() => {
    useAreaDrawingStore.getState().requestConfirmDrawing();
  }, []);

  const selectMode = useCallback((next: GridPlacementMode) => {
    if (next === mode) {
      // Re-clicking "Draw area" after a cancelled/abandoned drawing restarts it.
      if (next === 'area' && !isDrawingThisGrid) startDrawing();
      return;
    }
    if (next === 'area') {
      cancel(); // drop any pending viewer selection highlight
      startDrawing();
    } else {
      if (isDrawingThisGrid) cancelDrawing();
      startSelecting();
    }
  }, [mode, isDrawingThisGrid, startDrawing, cancel, cancelDrawing, startSelecting]);

  const recreate = useCallback(() => {
    if (mode === 'area') startDrawing();
    else startSelecting();
  }, [mode, startDrawing, startSelecting]);

  // Escape abandons the polygon (the card falls back to its "Draw" prompt).
  useEffect(() => {
    if (!isDrawingThisGrid) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      cancelDrawing();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isDrawingThisGrid, cancelDrawing]);

  // A boundary just got committed (objects validated / area closed) → power the
  // card on. Mount and restore don't count.
  const hadBoundaryRef = useRef(hasBoundary);
  const onPowerOnRef = useRef(onPowerOn);
  onPowerOnRef.current = onPowerOn;
  useEffect(() => {
    if (hasBoundary && !hadBoundaryRef.current && !isPowered) onPowerOnRef.current();
    hadBoundaryRef.current = hasBoundary;
  }, [hasBoundary, isPowered]);

  // Collapsing / deleting the card must not leave the viewer stuck in drawing mode.
  useEffect(() => {
    return () => {
      const s = useAreaDrawingStore.getState();
      if (s.isDrawing && s.drawingGridListenerId === grid.id) s.cancelDrawing();
    };
  }, [grid.id]);

  // One undo step per slider drag.
  const handleDragStart = useCallback(() => {
    pauseStore(undoStoreId);
  }, [undoStoreId]);

  const handleSpacingChange = useCallback((field: SpacingField, value: number) => {
    onUpdate({ [field]: value });
  }, [onUpdate]);

  const handleDragEnd = useCallback((field: SpacingField, value: number) => {
    onUpdate({ [field]: value });
    commitStore(undoStoreId);
  }, [onUpdate, undoStoreId]);

  const isAreaIdle = mode === 'area' && !hasBoundary && !isDrawingThisGrid;

  return (
    <div className="card-stack">
      {/* Boundary mode — only while there is no confirmed boundary */}
      {!hasBoundary && (
        <OptionToggle<GridPlacementMode>
          value={isDrawingThisGrid ? 'area' : mode}
          onChange={selectMode}
          options={PLACEMENT_OPTIONS}
        />
      )}

      <ObjectPickerBar
        isSelecting={isSelecting}
        selectedCount={selectedObjectIds.length}
        message="Select one or multiple surfaces on the model, then validate."
        confirmLabel="Validate"
        cancelLabel="Cancel"
        onConfirm={commit}
        onCancel={cancel}
      />

      {isDrawingThisGrid && <AreaDrawingBanner onConfirm={confirmDrawing} onCancel={cancelDrawing} />}

      {isAreaIdle && (
        <div className="flex items-center gap-1.5">
          <span className="flex-1 text-xxs text-secondary-hover">
            Draw an area on the model to place the points inside it.
          </span>
          <button
            onClick={startDrawing}
            className="shrink-0 px-2 py-0.5 rounded text-xs font-medium cursor-pointer"
            style={{ backgroundColor: 'var(--color-warning)', color: 'var(--color-on-blue)' }}
          >
            Draw
          </button>
        </div>
      )}

      {isAnyDrawing && !isDrawingThisGrid && !hasBoundary && (
        <Notice type="info" variant="tag" message="Drawing in viewer…" />
      )}

      {hasBoundary && (
        <div className="flex items-center gap-1.5">
          <span className="flex-1 text-[10px] text-secondary-hover">
            {grid.points.length} {pointNoun}{grid.points.length !== 1 ? 's' : ''}
            {mode === 'area' ? ' in drawn area' : ''}
          </span>
          <button
            onClick={recreate}
            className="w-6 h-6 flex-shrink-0 flex items-center justify-center rounded-md text-secondary-hover hover:text-foreground hover:bg-secondary-light transition-all cursor-pointer"
            title={mode === 'area' ? 'Redraw area' : 'Recreate grid'}
          >
            <RefreshIcon size="0.75rem" />
          </button>
        </div>
      )}

      <RangeSlider
        label="X spacing"
        value={grid.xSpacing}
        min={GRID_LISTENER_CONFIG.MIN_SPACING}
        max={GRID_LISTENER_CONFIG.MAX_SPACING}
        step={0.5}
        defaultValue={defaultSpacing}
        color={color}
        unit="m"
        onDragStart={handleDragStart}
        onChange={(v) => handleSpacingChange('xSpacing', v)}
        onChangeCommitted={(v) => handleDragEnd('xSpacing', v)}
      />
      <RangeSlider
        label="Y spacing"
        value={grid.ySpacing}
        min={GRID_LISTENER_CONFIG.MIN_SPACING}
        max={GRID_LISTENER_CONFIG.MAX_SPACING}
        step={0.5}
        defaultValue={defaultSpacing}
        color={color}
        unit="m"
        onDragStart={handleDragStart}
        onChange={(v) => handleSpacingChange('ySpacing', v)}
        onChangeCommitted={(v) => handleDragEnd('ySpacing', v)}
      />
      <RangeSlider
        label="Z offset"
        value={grid.zOffset}
        min={GRID_LISTENER_CONFIG.MIN_Z_OFFSET}
        max={GRID_LISTENER_CONFIG.MAX_Z_OFFSET}
        step={0.1}
        defaultValue={GRID_LISTENER_CONFIG.DEFAULT_Z_OFFSET}
        color={color}
        unit="m"
        onDragStart={handleDragStart}
        onChange={(v) => handleSpacingChange('zOffset', v)}
        onChangeCommitted={(v) => handleDragEnd('zOffset', v)}
      />
    </div>
  );
}
