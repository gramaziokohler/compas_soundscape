/**
 * Store barrel — re-exports all Zustand stores.
 * Import from '@/store' throughout the app.
 *
 * To add a new temporal store to global undo/redo:
 *   1. Create the store with the `temporal` middleware, passing
 *      `{ partialize: myStoreUndo.partialize, equality: myStoreUndo.equality, limit: UNDO_HISTORY_LIMIT }`.
 *   2. Export the undo spec (partialize + optional equality / apply) from the store file.
 *   3. Add one line here: registerTemporalStore('myStore', useMyStore, myStoreUndo)
 *
 * See undoRedoRegistry.ts for the undo model and .cursor/rules/zustand-stores.mdc
 * for what is (and is not) undoable.
 */

import { useAcousticMaterialStore, acousticMaterialUndo } from './acousticMaterialStore';
import { useGridListenersStore, gridListenersUndo } from './gridListenersStore';
import { useAudioControlsStore, audioControlsUndo } from './audioControlsStore';
import { useReceiversStore, receiversUndo } from './receiversStore';
import {
  useAcousticsSimulationStore,
  acousticsSimulationUndo,
} from './acousticsSimulationStore';
import { usePyroomAcousticsStore } from './pyroomAcousticsStore';
import { useSoundscapeStore, soundscapeUndo, configValidationError, orchestrateInputsSignature, applyRecoveredOrchestrateResult, resumeOrchestrateJob } from './soundscapeStore';
import { useTextGenerationStore } from './textGenerationStore';
import { useAnalysisStore, analysisUndo, applyRecoveredLlmResult, resumeLlmJob } from './analysisStore';
import { useSEDStore, sedUndo } from './sedStore';
import { useModalImpactStore } from './modalImpactStore';
import { useAreaDrawingStore, areaDrawingUndo } from './areaDrawingStore';
import { useSoundFxStore, soundFxUndo } from './soundFxStore';
import { useUIStore, uiUndo } from './uiStore';
import { useAcousticLayerStore, acousticLayerUndo } from './acousticLayerStore';
import { useCardFlowStore, cardFlowUndo } from './cardFlowStore';
import { useSpeckleStore, speckleUndo } from './speckleStore';
import { registerTemporalStore } from './undoRedoRegistry';

// ── Register all temporal stores ─────────────────────────────────────────────
registerTemporalStore('acousticMaterial', useAcousticMaterialStore, acousticMaterialUndo);
registerTemporalStore('audioControls', useAudioControlsStore, audioControlsUndo);
registerTemporalStore('receivers', useReceiversStore, receiversUndo);
registerTemporalStore('acousticsSimulation', useAcousticsSimulationStore, acousticsSimulationUndo);
registerTemporalStore('soundscape', useSoundscapeStore, soundscapeUndo);
registerTemporalStore('analysis', useAnalysisStore, analysisUndo);
registerTemporalStore('sed', useSEDStore, sedUndo);
registerTemporalStore('areaDrawing', useAreaDrawingStore, areaDrawingUndo);
registerTemporalStore('gridListeners', useGridListenersStore, gridListenersUndo);
registerTemporalStore('soundFx', useSoundFxStore, soundFxUndo);
registerTemporalStore('ui', useUIStore, uiUndo);
registerTemporalStore('acousticLayer', useAcousticLayerStore, acousticLayerUndo);
registerTemporalStore('cardFlow', useCardFlowStore, cardFlowUndo);
registerTemporalStore('speckle', useSpeckleStore, speckleUndo);

// ── Re-exports ────────────────────────────────────────────────────────────────
export { useAcousticMaterialStore };
export type { AcousticMaterialStoreState } from './acousticMaterialStore';

export { useAudioControlsStore };
export type { AudioControlsStoreState } from './audioControlsStore';

// Non-temporal stores
export { useShareConfigStore, selectShareConfig, pruneShareConfig, linkKey, linkMemberCount, EMPTY_SHARE_CONFIG } from './shareConfigStore';
export type { ShareConfigStoreState } from './shareConfigStore';
export { useShareViewStore, selectIsShareView } from './shareViewStore';
export type { ShareViewStoreState } from './shareViewStore';

export { usePositionClipboardStore } from './positionClipboardStore';
export type { PositionClipboardState } from './positionClipboardStore';

export { useErrorsStore, notifyError, notifyAuthError, notifySectionError } from './errorsStore';
export type { ErrorsStoreState, ErrorNotification, ErrorNotificationAction } from './errorsStore';

export { useRightSidebarStore } from './rightSidebarStore';
export type { RightSidebarStoreState } from './rightSidebarStore';

export { useAcousticLayerStore };
export type { AcousticLayerState } from './acousticLayerStore';
export { resolveSimulationLayerName, resolveSimulationGeometryObjectIds, toBackendGeometryIds } from './acousticLayerStore';
export {
  captureAcousticSelectionSnapshot,
  restoreAcousticSelectionSnapshot,
  discardAcousticSelectionSnapshot,
  getAcousticSelectionForSave,
  restoreAcousticSelection,
} from './acousticLayerStore';

export { useUIStore };
export { selectHasSaveTarget } from './uiStore';
export type { UIStoreState, SidebarNavCommand } from './uiStore';

export {
  useSceneWorkflowStore,
  registerSendToSoundGeneration,
  defaultSceneOptions,
  selectFocusRun,
  selectHasRunningScene,
} from './sceneWorkflowStore';
export type { SceneWorkflowStoreState } from './sceneWorkflowStore';

export { useFileUploadStore } from './fileUploadStore';
export type { FileUploadStoreState } from './fileUploadStore';

export { useSpeckleStore };
export { getAnalysisResultGroups } from './speckleStore';
export type { SpeckleStoreState } from './speckleStore';

export { useCardFlowStore };
export type { CardFlowState } from './cardFlowStore';

export { useAreaDrawingStore };
export type { AreaDrawingStoreState } from './areaDrawingStore';

export { useModelVersionStore, impactKey, bannerKey, findModelVersion, versionLabel } from './modelVersionStore';
export type {
  ModelVersionStoreState,
  ModelVersionBanner,
  ImpactEntry,
  LinkReconciliationItem,
  LinkReconciliationReport,
} from './modelVersionStore';

export { useGridListenersStore };
export type { GridListenersStoreState } from './gridListenersStore';
export { computeGridPoints } from './gridListenersStore';

// Temporal stores
export { useReceiversStore };
export type { ReceiversStoreState } from './receiversStore';

export { useAcousticsSimulationStore };
export type { AcousticsSimulationStoreState } from './acousticsSimulationStore';

export { usePyroomAcousticsStore };
export type {
  PyroomAcousticsStoreState,
  PyroomInstanceState,
  PyroomMaterial,
  PyroomSimulationSettings,
} from './pyroomAcousticsStore';

export {
  useSoundscapeStore,
  configValidationError,
  orchestrateInputsSignature,
  applyRecoveredOrchestrateResult,
  resumeOrchestrateJob,
};
export type { SoundscapeStoreState } from './soundscapeStore';

export { useTextGenerationStore };
export type { TextGenerationStoreState } from './textGenerationStore';

export { useAnalysisStore, applyRecoveredLlmResult, resumeLlmJob };
export type { AnalysisStoreState } from './analysisStore';

export { useSEDStore };
export type { SEDStoreState } from './sedStore';

export { useScenarioPreviewStore } from './scenarioPreviewStore';
export type { ScenarioPreviewStoreState, ScenarioPreviewParcours, ScenarioPreviewStop } from './scenarioPreviewStore';

export { useAnalysisPreviewStore } from './analysisPreviewStore';
export type { AnalysisPreviewStoreState, AnalysisPreviewPoint } from './analysisPreviewStore';

export { useSceneHighlightStore } from './sceneHighlightStore';
export type { SceneHighlightStoreState } from './sceneHighlightStore';

export { useSimulationPreflightStore } from './simulationPreflightStore';
export type { SimulationPreflightStoreState, RunPreflightArgs } from './simulationPreflightStore';

export { usePffdtdVisualsStore } from './pffdtdVisualsStore';
export type {
  PffdtdVisualsStoreState,
  PffdtdVoxelPreviewEntry,
  PffdtdOverlay,
  PffdtdFieldCacheEntry,
  PffdtdFieldView,
  RunVoxelPreviewArgs,
} from './pffdtdVisualsStore';

export { usePffdtdAnimationStore } from './pffdtdAnimationStore';

export { usePffdtdFreeStore } from './pffdtdFreeStore';
export type { PffdtdFreeGridEntry, PffdtdFreeObjectStatus } from './pffdtdFreeStore';
export type { PffdtdAnimationStoreState, PffdtdAnimationJob } from './pffdtdAnimationStore';

export { useModalImpactStore };
export type { ModalImpactStoreState } from './modalImpactStore';

export { useSoundFxStore };
export type { SoundFxStoreState } from './soundFxStore';

export { useWorkspaceStore, selectIsReadOnlyWorkspace, selectHasNewerSave } from './workspaceStore';

export {
  registerTemporalStore,
  UNDO_HISTORY_LIMIT,
  undoEquality,
  clearUndoHistory,
  onUndoHistoryCleared,
  runWithoutUndo,
  rebaseUndoHistory,
  runAsLoad,
  beginUndoInteraction,
  endUndoInteraction,
  installUndoInteractionTracking,
  globalUndo,
  globalRedo,
  canUndo,
  canRedo,
  pauseStore,
  commitStore,
  subscribeUndoRedo,
  getUndoRedoSnapshot,
  setUndoRedoOverride,
  notifyUndoRedoChanged,
  addUndoStepListener,
  peekUndoableSnapshots,
} from './undoRedoRegistry';
export type { UndoRedoOverride, RegisterTemporalStoreOptions, UndoStepNotice } from './undoRedoRegistry';

export {
  useCustomMaterialStore,
  isCustomMaterialId,
  customRecordToMaterial,
  findCustomMaterial,
  customMaterialRecordsFor,
  customMaterialDefinitions,
} from './customMaterialStore';
export type { CustomMaterialStoreState, CustomMaterialDialog } from './customMaterialStore';

export {
  useDirectivityStore,
  isLibraryDirectivityId,
  isAnalyticalDirectivityId,
  omniDirectivity,
  findDirectivity,
  isResolvableDirectivityId,
  directivityLabel,
  directivityRecordsFor,
} from './directivityStore';
export type { DirectivityStoreState, DirectivityDialog } from './directivityStore';

export { useStudyStore } from './studyStore';
export type { StudyStoreState } from './studyStore';
