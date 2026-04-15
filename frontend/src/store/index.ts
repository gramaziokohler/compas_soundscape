/**
 * Store barrel — re-exports all Zustand stores.
 * Import from '@/store' throughout the app.
 *
 * To add a new temporal store to global undo/redo:
 *   1. Create the store with the `temporal` middleware.
 *   2. Export `myStorePartialize` from the store file.
 *   3. Add one line here: registerTemporalStore('myStore', useMyStore.temporal,
 *        () => myStorePartialize(useMyStore.getState()))
 */

import { useAcousticMaterialStore, acousticMaterialPartialize } from './acousticMaterialStore';
import { useAudioControlsStore, audioControlsPartialize } from './audioControlsStore';
import { useObjectExplorerStore, objectExplorerPartialize } from './objectExplorerStore';
import { useReceiversStore, receiversPartialize } from './receiversStore';
import { useRoomMaterialsStore, roomMaterialsPartialize } from './roomMaterialsStore';
import {
  useAcousticsSimulationStore,
  acousticsSimulationPartialize,
} from './acousticsSimulationStore';
import { usePyroomAcousticsStore, pyroomAcousticsPartialize } from './pyroomAcousticsStore';
import { useSoundscapeStore, soundscapePartialize } from './soundscapeStore';
import { useTextGenerationStore, textGenerationPartialize } from './textGenerationStore';
import { useAnalysisStore, analysisPartialize } from './analysisStore';
import { useSEDStore, sedPartialize } from './sedStore';
import { useModalImpactStore, modalImpactPartialize } from './modalImpactStore';
import { useAreaDrawingStore, areaDrawingPartialize } from './areaDrawingStore';
import { registerTemporalStore } from './undoRedoRegistry';

// ── Register all temporal stores ─────────────────────────────────────────────
registerTemporalStore(
  'acousticMaterial',
  useAcousticMaterialStore.temporal,
  () => acousticMaterialPartialize(useAcousticMaterialStore.getState()),
);
registerTemporalStore(
  'audioControls',
  useAudioControlsStore.temporal,
  () => audioControlsPartialize(useAudioControlsStore.getState()),
);
registerTemporalStore(
  'objectExplorer',
  useObjectExplorerStore.temporal,
  () => objectExplorerPartialize(useObjectExplorerStore.getState()),
);
registerTemporalStore(
  'receivers',
  useReceiversStore.temporal,
  () => receiversPartialize(useReceiversStore.getState()),
);
registerTemporalStore(
  'roomMaterials',
  useRoomMaterialsStore.temporal,
  () => roomMaterialsPartialize(useRoomMaterialsStore.getState()),
);
registerTemporalStore(
  'acousticsSimulation',
  useAcousticsSimulationStore.temporal,
  () => acousticsSimulationPartialize(useAcousticsSimulationStore.getState()),
);
registerTemporalStore(
  'pyroomAcoustics',
  usePyroomAcousticsStore.temporal,
  () => pyroomAcousticsPartialize(usePyroomAcousticsStore.getState()),
);
registerTemporalStore(
  'soundscape',
  useSoundscapeStore.temporal,
  () => soundscapePartialize(useSoundscapeStore.getState()),
);
registerTemporalStore(
  'textGeneration',
  useTextGenerationStore.temporal,
  () => textGenerationPartialize(useTextGenerationStore.getState()),
);
registerTemporalStore(
  'analysis',
  useAnalysisStore.temporal,
  () => analysisPartialize(useAnalysisStore.getState()),
);
registerTemporalStore(
  'sed',
  useSEDStore.temporal,
  () => sedPartialize(useSEDStore.getState()),
);
registerTemporalStore(
  'modalImpact',
  useModalImpactStore.temporal,
  () => modalImpactPartialize(useModalImpactStore.getState()),
);
registerTemporalStore(
  'areaDrawing',
  useAreaDrawingStore.temporal,
  () => areaDrawingPartialize(useAreaDrawingStore.getState()),
);

// ── Re-exports ────────────────────────────────────────────────────────────────
export { useAcousticMaterialStore };
export type { AcousticMaterialStoreState } from './acousticMaterialStore';

export { useAudioControlsStore };
export type { AudioControlsStoreState } from './audioControlsStore';

// Non-temporal stores
export { useErrorsStore } from './errorsStore';
export type { ErrorsStoreState, ErrorNotification } from './errorsStore';

export { useRightSidebarStore } from './rightSidebarStore';
export type { RightSidebarStoreState } from './rightSidebarStore';

export { useUIStore } from './uiStore';
export type { UIStoreState } from './uiStore';

export { useFileUploadStore } from './fileUploadStore';
export type { FileUploadStoreState } from './fileUploadStore';

export { useSpeckleStore } from './speckleStore';
export type { SpeckleStoreState } from './speckleStore';

export { useAreaDrawingStore } from './areaDrawingStore';
export type { AreaDrawingStoreState } from './areaDrawingStore';

// Temporal stores
export { useObjectExplorerStore };
export type { ObjectExplorerStoreState } from './objectExplorerStore';

export { useReceiversStore };
export type { ReceiversStoreState } from './receiversStore';

export { useRoomMaterialsStore };
export type { RoomMaterialsStoreState } from './roomMaterialsStore';

export { useAcousticsSimulationStore };
export type { AcousticsSimulationStoreState } from './acousticsSimulationStore';

export { usePyroomAcousticsStore };
export type {
  PyroomAcousticsStoreState,
  PyroomInstanceState,
  PyroomMaterial,
  PyroomSimulationSettings,
} from './pyroomAcousticsStore';

export { useSoundscapeStore };
export type { SoundscapeStoreState } from './soundscapeStore';

export { useTextGenerationStore };
export type { TextGenerationStoreState } from './textGenerationStore';

export { useAnalysisStore };
export type { AnalysisStoreState } from './analysisStore';

export { useSEDStore };
export type { SEDStoreState } from './sedStore';

export { useModalImpactStore };
export type { ModalImpactStoreState } from './modalImpactStore';

export {
  registerTemporalStore,
  globalUndo,
  globalRedo,
  canUndo,
  canRedo,
  pauseStore,
  commitStore,
  subscribeUndoRedo,
  getUndoRedoSnapshot,
} from './undoRedoRegistry';
