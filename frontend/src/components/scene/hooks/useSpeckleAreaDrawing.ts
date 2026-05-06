import { useEffect } from 'react';
import { useAreaDrawingStore } from '@/store';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';

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

    const { isDrawing, drawingCardIndex } = areaDrawingCtx;

    if (!isDrawing || drawingCardIndex === null) {
      // Not drawing — ensure manager is cancelled and selection re-enabled
      if ((manager as any).isDrawing) manager.cancelDrawing();
      if (selectionExtension) {
        selectionExtension.enabled = true;
      }
      return;
    }

    // Start drawing — disable SelectionExtension to prevent surface selection
    manager.startDrawing(drawingCardIndex, `Area ${drawingCardIndex + 1}`);
    if (selectionExtension) {
      selectionExtension.enabled = false;
    }

    const canvas = containerRef.current.querySelector('canvas');
    if (!canvas) return;

    const onPointerMove = (e: PointerEvent) => {
      manager.handlePointerMove(e);
    };

    const onClick = (e: MouseEvent) => {
      e.stopPropagation();
      const result = manager.handleClick(e);
      if (result) {
        areaDrawingCtx.finishDrawing(drawingCardIndex, result);
        manager.addCompletedArea(result, 'default');
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const result = manager.confirmDrawing();
        if (result) {
          areaDrawingCtx.finishDrawing(drawingCardIndex, result);
          manager.addCompletedArea(result, 'default');
        }
      }
    };

    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      manager.handleRightClick(e);
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
      // Re-enable selection when drawing effect cleans up
      if (selectionExtension) {
        selectionExtension.enabled = true;
      }
    };
  }, [areaDrawingCtx.isDrawing, areaDrawingCtx.drawingCardIndex, areaDrawingCtx.version, areaDrawingManager, selectionExtension, containerRef]);

  // ============================================================================
  // Effect - Sidebar "Validate" button confirm
  // ============================================================================
  useEffect(() => {
    if (!areaDrawingCtx.pendingConfirm) return;
    areaDrawingCtx.clearConfirmDrawing();

    const manager = areaDrawingManager;
    const cardIndex = areaDrawingCtx.drawingCardIndex;
    if (!manager || cardIndex === null) return;

    const result = manager.confirmDrawing();
    if (result) {
      areaDrawingCtx.finishDrawing(cardIndex, result);
      manager.addCompletedArea(result, 'default');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areaDrawingCtx.pendingConfirm, areaDrawingManager]);

  // ============================================================================
  // Effect - Sync Completed Area Visuals
  // ============================================================================
  useEffect(() => {
    const manager = areaDrawingManager;
    if (!manager) return;

    // Remove visuals for areas deleted from the store
    for (const cardIndex of manager.managedCardIndices) {
      if (!areaDrawingCtx.drawnAreas.has(cardIndex)) {
        manager.removeArea(cardIndex);
      }
    }

    // Update visual states for all remaining areas
    for (const [cardIndex, state] of areaDrawingCtx.areaVisualStates) {
      manager.updateAreaVisualState(cardIndex, state);
    }
  }, [areaDrawingCtx.version, areaDrawingManager]);
}
