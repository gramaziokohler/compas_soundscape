import { useEffect } from 'react';
import {
  useAreaDrawingStore,
  useAnalysisStore,
  useUIStore,
  useAnalysisPreviewStore,
  useGridListenersStore,
  setUndoRedoOverride,
  notifyUndoRedoChanged,
} from '@/store';
import { CARD_TYPE_LABELS } from '@/types/card';
import type { DrawnArea } from '@/types/area-drawing';
import { GRID_LISTENER_CONFIG } from '@/utils/constants';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import type { AreaDrawingManager } from '@/lib/three/area-drawing-manager';

/** Who the polygon being drawn belongs to: an analysis card or a grid listener. */
interface DrawingTarget {
  cardIndex: number | null;
  gridListenerId: string | null;
}

function analysisCardTitle(cardIndex: number): string {
  const config = useAnalysisStore.getState().analysisConfigs[cardIndex];
  return (
    config?.display_name ||
    (config ? CARD_TYPE_LABELS[config.type as keyof typeof CARD_TYPE_LABELS] : undefined) ||
    `Area ${cardIndex + 1}`
  );
}

/**
 * Persist a closed polygon on its owner. Analysis-card areas get a scene visual;
 * grid-listener areas become the grid boundary (its listener points show it).
 */
function commitDrawnArea(manager: AreaDrawingManager, area: DrawnArea, target: DrawingTarget) {
  const areaStore = useAreaDrawingStore.getState();
  if (target.gridListenerId !== null) {
    const gridStore = useGridListenersStore.getState();
    // The grid may have been deleted while drawing — just leave drawing mode.
    if (gridStore.gridListeners.some((g) => g.id === target.gridListenerId)) {
      gridStore.setGridListenerArea(target.gridListenerId, area);
    }
    areaStore.cancelDrawing();
    return;
  }
  if (target.cardIndex === null) return;
  areaStore.finishDrawing(target.cardIndex, area);
  useAnalysisStore.getState().handleUpdateConfig(target.cardIndex, { drawnArea: area });
  manager.addCompletedArea(area, 'default');
}

export function useSpeckleAreaDrawing({
  isViewerReady,
  containerRef,
}: {
  isViewerReady: boolean;
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const areaDrawingCtx = useAreaDrawingStore();
  const { areaDrawingManager, selectionExtension } = useSpeckleEngineStore();

  // ============================================================================
  // Effect - Area Drawing Mode (event listeners on canvas)
  // ============================================================================
  useEffect(() => {
    const manager = areaDrawingManager;
    if (!manager || !containerRef.current) return;

    const { isDrawing, drawingCardIndex, drawingGridListenerId } = areaDrawingCtx;
    const target: DrawingTarget = { cardIndex: drawingCardIndex, gridListenerId: drawingGridListenerId };

    if (!isDrawing || (drawingCardIndex === null && drawingGridListenerId === null)) {
      // Not drawing — ensure manager is cancelled and selection re-enabled
      if ((manager as any).isDrawing) manager.cancelDrawing();
      if (selectionExtension) {
        selectionExtension.enabled = true;
      }
      return;
    }

    // Start drawing — disable SelectionExtension to prevent surface selection
    const title = drawingGridListenerId !== null
      ? useGridListenersStore.getState().gridListeners.find((g) => g.id === drawingGridListenerId)?.name ?? 'Grid'
      : analysisCardTitle(drawingCardIndex as number);
    // Fallback snap plane = floor of the model bounds (or world origin).
    const bounds = useUIStore.getState().speckleBounds;
    manager.setGroundPlaneZ(bounds ? bounds.min[2] : 0);
    manager.startDrawing(drawingCardIndex ?? GRID_LISTENER_CONFIG.AREA_CARD_INDEX, title);
    if (selectionExtension) {
      selectionExtension.enabled = false;
    }

    const canvas = containerRef.current.querySelector('canvas');
    if (!canvas) return;

    const onPointerMove = (e: PointerEvent) => {
      manager.handlePointerMove(e);
    };

    const persistArea = (area: DrawnArea) => commitDrawnArea(manager, area, target);

    const syncPointCount = () => {
      useAreaDrawingStore.getState().setDrawingPointCount(manager.pointCount);
      notifyUndoRedoChanged();
    };

    // While drawing, Ctrl+Z / Ctrl+Y (and the toolbar) undo / redo placed points.
    setUndoRedoOverride({
      undo: () => { manager.undoPoint(); syncPointCount(); },
      redo: () => { manager.redoPoint(); syncPointCount(); },
      canUndo: () => manager.canUndoPoint,
      canRedo: () => manager.canRedoPoint,
    });

    const onClick = (e: MouseEvent) => {
      e.stopPropagation();
      const result = manager.handleClick(e);
      if (result) {
        persistArea(result);
      } else {
        syncPointCount();
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const result = manager.confirmDrawing();
        if (result) {
          persistArea(result);
        }
      }
    };

    // Right-click does nothing while drawing (no scene context menu mid-polygon).
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    // Use capture phase to intercept before SpeckleEventBridge
    canvas.addEventListener('pointermove', onPointerMove, true);
    canvas.addEventListener('click', onClick, true);
    canvas.addEventListener('contextmenu', onContextMenu, true);
    document.addEventListener('keydown', onKeyDown, true);

    return () => {
      canvas.removeEventListener('pointermove', onPointerMove, true);
      canvas.removeEventListener('click', onClick, true);
      canvas.removeEventListener('contextmenu', onContextMenu, true);
      document.removeEventListener('keydown', onKeyDown, true);
      setUndoRedoOverride(null);
      // Re-enable selection when drawing effect cleans up
      if (selectionExtension) {
        selectionExtension.enabled = true;
      }
    };
  }, [areaDrawingCtx.isDrawing, areaDrawingCtx.drawingCardIndex, areaDrawingCtx.drawingGridListenerId, areaDrawingCtx.version, areaDrawingManager, selectionExtension, containerRef]);

  // ============================================================================
  // Effect - Sidebar "Validate" button confirm
  // ============================================================================
  useEffect(() => {
    if (!areaDrawingCtx.pendingConfirm) return;
    areaDrawingCtx.clearConfirmDrawing();

    const manager = areaDrawingManager;
    const { drawingCardIndex, drawingGridListenerId } = areaDrawingCtx;
    if (!manager || (drawingCardIndex === null && drawingGridListenerId === null)) return;

    const result = manager.confirmDrawing();
    if (result) {
      commitDrawnArea(manager, result, { cardIndex: drawingCardIndex, gridListenerId: drawingGridListenerId });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areaDrawingCtx.pendingConfirm, areaDrawingManager]);

  // ============================================================================
  // Effect - Sync Completed Area Visuals
  // ============================================================================
  const expandedTextCardIndex = useAnalysisPreviewStore((s) => s.expandedTextCardIndex);
  const sidebarWizardStep = useUIStore((s) => s.sidebarWizardStep);
  const analysisConfigs = useAnalysisStore((s) => s.analysisConfigs);

  useEffect(() => {
    const manager = areaDrawingManager;
    if (!manager) return;

    // Remove visuals for areas deleted from the store
    for (const cardIndex of manager.managedCardIndices) {
      if (!areaDrawingCtx.drawnAreas.has(cardIndex)) {
        manager.removeArea(cardIndex);
      }
    }

    // Add visuals for areas the scene lacks (re-keyed after a card was removed
    // or inserted before them, or restored from a soundscape).
    const managed = manager.managedCardIndices;
    for (const [cardIndex, area] of areaDrawingCtx.drawnAreas) {
      if (!managed.has(cardIndex)) {
        manager.addCompletedArea(area, areaDrawingCtx.areaVisualStates.get(cardIndex) ?? 'default');
      }
    }

    // Update visual states for all remaining areas
    for (const [cardIndex, state] of areaDrawingCtx.areaVisualStates) {
      manager.updateAreaVisualState(cardIndex, state);
    }

    // A drawn area is only shown in the Usage step and only for the card that
    // is currently expanded. Its label follows the (possibly regenerated) title.
    const inUsageStep = sidebarWizardStep === 1;
    for (const cardIndex of manager.managedCardIndices) {
      manager.setAreaVisible(cardIndex, inUsageStep && expandedTextCardIndex === cardIndex);
      const config = analysisConfigs[cardIndex];
      const title =
        config?.display_name ||
        (config ? CARD_TYPE_LABELS[config.type as keyof typeof CARD_TYPE_LABELS] : undefined) ||
        `Area ${cardIndex + 1}`;
      manager.updateAreaLabel(cardIndex, title);
    }
  }, [
    areaDrawingCtx.version,
    areaDrawingCtx.drawnAreas,
    areaDrawingCtx.areaVisualStates,
    areaDrawingManager,
    sidebarWizardStep,
    expandedTextCardIndex,
    analysisConfigs,
  ]);
}
