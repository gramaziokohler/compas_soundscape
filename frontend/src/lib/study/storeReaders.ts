import {
  useAcousticsSimulationStore,
  useAudioControlsStore,
  useGridListenersStore,
  useReceiversStore,
  useUIStore,
  peekUndoableSnapshots,
} from '@/store';
// Not in the barrel (heavy engine instances); imported directly like page.tsx does.
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import { parseGridPointId } from '@/utils/gridListenerPoints';
import type { AudioOrchestrator } from '@/lib/audio/AudioOrchestrator';
import type { StudyEnvelopeContext } from '@/lib/study/studyLogger';
import type { StudyListeningContext } from '@/lib/study/listeningTracker';
import type { StudyListenerState } from '@/types/study';

/**
 * Read-only getters that turn live app state into study context.
 *
 * This is the ONLY lib/study module that imports `@/store`. It must never be
 * imported by a store file (the logger core stays store-free to avoid an
 * import cycle with the barrel's temporal-store registration); it is used by
 * useStudyLogging and the moment / intent UI only.
 */

/** Listener selection as tracked by page.tsx (FPS state is local React state there). */
export interface StudyListenerSelection {
  fpsActive: boolean;
  activeListenerId: string | null;
}

const RAD_TO_DEG = 180 / Math.PI;
const round = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;

export function readStudyEnvelopeContext(): StudyEnvelopeContext {
  const ui = useUIStore.getState();
  const speckle = ui.globalSpeckleData as { model_id?: string } | null;
  return {
    model_id: speckle?.model_id ?? null,
    version_id: useSpeckleEngineStore.getState().loadedModelVersionId,
    ui_mode: ui.uiMode,
  };
}

/** Kind of a listener id: single receiver, grid point, or unknown. */
export function classifyListenerId(id: string | null): StudyListenerState['kind'] {
  if (!id) return 'free_camera';
  if (useReceiversStore.getState().receivers.some((r) => r.id === id)) return 'receiver';
  return parseGridPointId(id) ? 'grid_point' : 'receiver';
}

/** Where the listener is right now (camera pose = listening pose in both modes). */
export function readStudyListener(selection: StudyListenerSelection): StudyListenerState {
  const inListener = selection.fpsActive && !!selection.activeListenerId;
  const kind = inListener ? classifyListenerId(selection.activeListenerId) : 'free_camera';
  const camera = useSpeckleEngineStore.getState().coordinator?.getCameraController() ?? null;
  let position: StudyListenerState['position'] = null;
  let orientation: StudyListenerState['orientation'] = null;
  if (camera) {
    const p = camera.getCameraPosition();
    position = [round(p.x, 3), round(p.y, 3), round(p.z, 3)];
    const o = camera.getListenerOrientation();
    orientation = {
      yaw: round(o.yaw * RAD_TO_DEG, 1),
      pitch: round(o.pitch * RAD_TO_DEG, 1),
      roll: round(o.roll * RAD_TO_DEG, 1),
    };
  }
  return { kind, id: inListener ? selection.activeListenerId : null, position, orientation };
}

export function readStudyListeningContext(
  orchestrator: AudioOrchestrator | null,
  selection: StudyListenerSelection,
): StudyListeningContext {
  const ui = useUIStore.getState();
  const audio = useAudioControlsStore.getState();
  const sim = useAcousticsSimulationStore.getState();
  const activeIndex = sim.activeSimulationIndex;
  const activeConfig = activeIndex !== null ? sim.simulationConfigs[activeIndex] : undefined;
  const scheduler = useSpeckleEngineStore.getState().playbackScheduler;
  return {
    position_ms: scheduler ? Math.round(scheduler.getPositionMs()) : null,
    playing_source_ids: orchestrator?.getPlayingSourceIds() ?? [],
    listener: readStudyListener(selection),
    render_mode: ui.audioRenderingMode,
    engine_mode: orchestrator ? String(orchestrator.getStatus().currentMode) : null,
    active_simulation: activeIndex !== null ? { index: activeIndex, engine: activeConfig?.type ?? null } : null,
    selected_ir_id: ui.selectedIRId,
    muted: [...audio.mutedSounds],
    soloed: [...audio.soloedSounds],
    master_volume: audio.masterVolume,
  };
}

/**
 * Cheap change fingerprint for snapshots: references of every undoable
 * store's partialized fields, plus the non-undoable fields the save payload
 * also contains. Equal references ⇒ the design state did not change.
 */
export function readStudySnapshotFingerprint(): unknown[] {
  const parts: unknown[] = [];
  for (const [, snapshot] of peekUndoableSnapshots()) {
    if (snapshot && typeof snapshot === 'object') parts.push(...Object.values(snapshot));
    else parts.push(snapshot);
  }
  parts.push(
    useSpeckleEngineStore.getState().loadedModelVersionId,
    useReceiversStore.getState().selectedReceiverId,
    useAcousticsSimulationStore.getState().activeSimulationIndex,
    useGridListenersStore.getState().gridListeners,
    useUIStore.getState().globalSpeckleData,
  );
  return parts;
}
