import { useEffect, useRef } from 'react';
import { useAnalysisPreviewStore, useSpeckleStore } from '@/store';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';

/**
 * Scene bridge for the text-card result phase:
 *   - highlights linked analysis-group objects (scenario-style light-warning), and
 *   - shows preview spheres + labels at each selected prompt's planned position.
 *
 * Active only while a text-based card with a result is expanded. Prompt hover
 * only recolours the existing preview (no rebuild), so labels never flash.
 */
export function useSpeckleAnalysisPreview({ isViewerReady }: { isViewerReady: boolean }) {
  const active = useAnalysisPreviewStore((s) => s.active);
  const cardIndex = useAnalysisPreviewStore((s) => s.cardIndex);
  const objectIds = useAnalysisPreviewStore((s) => s.objectIds);
  const points = useAnalysisPreviewStore((s) => s.points);
  const highlightedPromptId = useAnalysisPreviewStore((s) => s.highlightedPromptId);
  const { areaDrawingManager } = useSpeckleEngineStore();

  // Read the latest highlight inside the rebuild effect without re-triggering it.
  const highlightRef = useRef(highlightedPromptId);
  highlightRef.current = highlightedPromptId;

  // Effect A — (re)build previews when the selected set / positions change.
  useEffect(() => {
    if (!isViewerReady || !areaDrawingManager) return;

    if (!active || cardIndex === null) {
      useSpeckleStore.getState().clearScenarioPreviewHighlight();
      areaDrawingManager.setSoundPreviews([]);
      return;
    }

    if (objectIds.length > 0) {
      useSpeckleStore.getState().setScenarioPreviewHighlight(objectIds);
    } else {
      useSpeckleStore.getState().clearScenarioPreviewHighlight();
    }
    areaDrawingManager.setSoundPreviews(points);
    areaDrawingManager.setPreviewHighlight(highlightRef.current);

    return () => {
      useSpeckleStore.getState().clearScenarioPreviewHighlight();
      areaDrawingManager.setSoundPreviews([]);
    };
  }, [isViewerReady, areaDrawingManager, active, cardIndex, objectIds, points]);

  // Effect B — hover recolours the existing preview sphere in place.
  useEffect(() => {
    if (!areaDrawingManager) return;
    areaDrawingManager.setPreviewHighlight(highlightedPromptId);
  }, [areaDrawingManager, highlightedPromptId]);
}
