/**
 * Cross-store card index links
 *
 * Keeps every store that points at an analysis (context/usage) card by index in
 * step with analysisStore when cards are inserted or removed. analysisStore
 * remaps its own state (configs, results, tabs); this module covers the rest.
 */

import type { IndexMapper } from '@/utils/cardIndexRemap';
import {
  remapIndexKeyedMap,
  remapIndexSet,
  remapNullableIndex,
  remapParentUsageIndex,
} from '@/utils/cardIndexRemap';
import { useSoundscapeStore } from './soundscapeStore';
import { useUIStore } from './uiStore';
import { useCardFlowStore } from './cardFlowStore';
import { useAreaDrawingStore } from './areaDrawingStore';
import { useAnalysisPreviewStore } from './analysisPreviewStore';
import { useSceneWorkflowStore } from './sceneWorkflowStore';

/**
 * Remap all analysis-card index links held outside analysisStore. Links to
 * removed cards are dropped (their children were already cascade-deleted).
 */
export function remapLinkedCardIndices(mapIndex: IndexMapper): void {
  // Sound configs → parent usage card (or -(contextIndex + 1) for audio contexts).
  const { soundConfigs } = useSoundscapeStore.getState();
  let soundLinkageChanged = false;
  const remappedSoundConfigs = soundConfigs.map((sc) => {
    const pui = sc.parentUsageOriginalIndex;
    const next = remapParentUsageIndex(pui, mapIndex);
    if (next === pui) return sc;
    soundLinkageChanged = true;
    return { ...sc, parentUsageOriginalIndex: next };
  });
  if (soundLinkageChanged) {
    useSoundscapeStore.setState({ soundConfigs: remappedSoundConfigs }, false);
  }

  // Scene shown in the DAW / 3D scene.
  const ui = useUIStore.getState();
  const nextSoundParent = remapNullableIndex(ui.activeSoundParentIndex, mapIndex);
  if (nextSoundParent !== ui.activeSoundParentIndex) {
    useUIStore.setState({ activeSoundParentIndex: nextSoundParent }, false);
  }

  // Sidebar wizard selection and advance history.
  const flow = useCardFlowStore.getState();
  useCardFlowStore.setState({
    activeContextOriginalIndex: remapNullableIndex(flow.activeContextOriginalIndex, mapIndex),
    activeUsageOriginalIndex: remapNullableIndex(flow.activeUsageOriginalIndex, mapIndex),
    contextAdvanced: remapIndexSet(flow.contextAdvanced, mapIndex),
    usageAdvanced: remapIndexSet(flow.usageAdvanced, mapIndex),
    contextToUsageMap: remapIndexKeyedMap(flow.contextToUsageMap, mapIndex, (usages) =>
      usages.map(mapIndex).filter((i): i is number => i !== null),
    ),
    // Values are sound config indices — only the usage keys follow the cards.
    usageToSoundMap: remapIndexKeyedMap(flow.usageToSoundMap, mapIndex),
  });

  // Drawn areas (text cards). DrawnArea carries its own cardIndex too.
  const areas = useAreaDrawingStore.getState();
  const nextDrawingIndex = remapNullableIndex(areas.drawingCardIndex, mapIndex);
  useAreaDrawingStore.setState({
    drawnAreas: remapIndexKeyedMap(areas.drawnAreas, mapIndex, (area, cardIndex) =>
      area.cardIndex === cardIndex ? area : { ...area, cardIndex },
    ),
    areaVisualStates: remapIndexKeyedMap(areas.areaVisualStates, mapIndex),
    drawingCardIndex: nextDrawingIndex,
    isDrawing: areas.isDrawing && nextDrawingIndex !== null,
    version: areas.version + 1,
  });

  // Viewer preview / expanded text card.
  const preview = useAnalysisPreviewStore.getState();
  const nextPreviewIndex = remapNullableIndex(preview.cardIndex, mapIndex);
  if (preview.cardIndex !== null && nextPreviewIndex === null) {
    preview.clearPreview();
  } else if (nextPreviewIndex !== preview.cardIndex) {
    useAnalysisPreviewStore.setState({ cardIndex: nextPreviewIndex }, false);
  }
  const nextExpanded = remapNullableIndex(preview.expandedTextCardIndex, mapIndex);
  if (nextExpanded !== preview.expandedTextCardIndex) {
    useAnalysisPreviewStore.setState({ expandedTextCardIndex: nextExpanded }, false);
  }

  // Simple-mode scene runs (keyed by usage card index).
  useSceneWorkflowStore.getState().remapUsageIndices(mapIndex);
}
