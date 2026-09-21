import { useEffect } from 'react';
import { useAreaDrawingStore, useAnalysisStore, useUIStore, useAnalysisPreviewStore } from '@/store';
import { CARD_TYPE_LABELS } from '@/types/card';
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
    const cardConfig = useAnalysisStore.getState().analysisConfigs[drawingCardIndex];
    const title =
      cardConfig?.display_name ||
      (cardConfig ? CARD_TYPE_LABELS[cardConfig.type as keyof typeof CARD_TYPE_LABELS] : undefined) ||
      `Area ${drawingCardIndex + 1}`;
    // Fallback snap plane = floor of the model bounds (or world origin).
    const bounds = useUIStore.getState().speckleBounds;
    manager.setGroundPlaneZ(bounds ? bounds.min[2] : 0);
    manager.startDrawing(drawingCardIndex, title);
    if (selectionExtension) {
      selectionExtension.enabled = false;
    }

    const canvas = containerRef.current.querySelector('canvas');
    if (!canvas) return;

    const onPointerMove = (e: PointerEvent) => {
      manager.handlePointerMove(e);
    };

    const persistArea = (area: NonNullable<ReturnType<typeof manager.handleClick>>) => {
      areaDrawingCtx.finishDrawing(drawingCardIndex, area);
      useAnalysisStore.getState().handleUpdateConfig(drawingCardIndex, { drawnArea: area });
      manager.addCompletedArea(area, 'default');
    };

    const onClick = (e: MouseEvent) => {
      e.stopPropagation();
      const result = manager.handleClick(e);
      if (result) {
        persistArea(result);
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
      useAnalysisStore.getState().handleUpdateConfig(cardIndex, { drawnArea: result });
      manager.addCompletedArea(result, 'default');
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
