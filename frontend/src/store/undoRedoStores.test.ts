import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The viewer cannot load in Node; the stores only reference its extension classes.
vi.mock('@speckle/viewer', () => ({
  FilteringExtension: class {},
  CameraController: class {},
  SelectionExtension: class {},
  Viewer: class {},
}));
import {
  useAcousticsSimulationStore,
  useReceiversStore,
  useSoundscapeStore,
  useAudioControlsStore,
  useUIStore,
  useSoundFxStore,
  useAcousticLayerStore,
  useAnalysisStore,
  captureAcousticSelectionSnapshot,
  restoreAcousticSelectionSnapshot,
  discardAcousticSelectionSnapshot,
  beginUndoInteraction,
  endUndoInteraction,
  clearUndoHistory,
  globalUndo,
  globalRedo,
  canUndo,
} from '@/store';

function interact(fn: () => void) {
  beginUndoInteraction();
  fn();
  endUndoInteraction();
  vi.runAllTimers();
}

beforeEach(() => {
  vi.useFakeTimers();
  clearUndoHistory();
  vi.runAllTimers();
});
afterEach(() => {
  vi.runAllTimers();
  vi.useRealTimers();
});

describe('app stores', () => {
  it('sound card add + edit undo in order', () => {
    interact(() => useSoundscapeStore.getState().handleAddConfig('text-to-audio'));
    interact(() => useSoundscapeStore.getState().handleUpdateConfig(0, 'prompt', 'rain'));
    expect(useSoundscapeStore.getState().soundConfigs[0].prompt).toBe('rain');
    globalUndo(); vi.runAllTimers();
    expect(useSoundscapeStore.getState().soundConfigs[0].prompt).toBe('');
    globalUndo(); vi.runAllTimers();
    expect(useSoundscapeStore.getState().soundConfigs).toHaveLength(0);
    globalRedo(); vi.runAllTimers();
    expect(useSoundscapeStore.getState().soundConfigs).toHaveLength(1);
  });

  it('simulation progress never records and survives undo', () => {
    interact(() => useAcousticsSimulationStore.getState().handleAddConfig('pyroomacoustics'));
    interact(() => useAcousticsSimulationStore.getState().handleUpdateSimulationName(0, 'Hall'));
    // Background run results.
    useAcousticsSimulationStore.getState().handleUpdateConfig(0, { isRunning: true, progress: 40 } as never);
    useAcousticsSimulationStore.getState().handleUpdateConfig(0, {
      isRunning: false, progress: 100, state: 'completed', simulationResults: 'RT60', importedIRIds: ['ir1'],
    } as never);
    vi.runAllTimers();
    globalUndo(); vi.runAllTimers();
    const cfg = useAcousticsSimulationStore.getState().simulationConfigs[0] as never as Record<string, unknown>;
    expect(cfg.display_name).not.toBe('Hall');
    expect(cfg.simulationResults).toBe('RT60');
    expect(cfg.state).toBe('completed');
  });

  it('receiver selection is not a step', () => {
    interact(() => useReceiversStore.getState().addReceiver());
    const id = useReceiversStore.getState().receivers[0].id;
    interact(() => useReceiversStore.getState().selectReceiver(id));
    globalUndo(); vi.runAllTimers();
    expect(useReceiversStore.getState().receivers).toHaveLength(0);
    expect(useReceiversStore.getState().selectedReceiverId).toBeNull();
    expect(canUndo()).toBe(false);
  });

  it('global simulation parameters are undoable, display toggles are not', () => {
    const speed = useUIStore.getState().globalSoundSpeed;
    interact(() => useUIStore.getState().setShowGroundGrid(!useUIStore.getState().showGroundGrid));
    expect(canUndo()).toBe(false);
    interact(() => useUIStore.getState().setGlobalSoundSpeed(speed + 10));
    globalUndo(); vi.runAllTimers();
    expect(useUIStore.getState().globalSoundSpeed).toBe(speed);
  });

  it('volume slider drag is one step; output device is not history', () => {
    interact(() => {
      for (let v = 0; v < 10; v++) useAudioControlsStore.getState().handleVolumeChange('s1', v);
    });
    interact(() => useAudioControlsStore.getState().setOutputDeviceId('dev-2'));
    globalUndo(); vi.runAllTimers();
    expect(useAudioControlsStore.getState().soundVolumes.s1).toBeUndefined();
    expect(useAudioControlsStore.getState().outputDeviceId).toBe('dev-2');
  });

  it('opening the FX editor (chain hydration) is not a step, edits are', () => {
    interact(() => useSoundFxStore.getState().ensureChain('snd', null));
    expect(canUndo()).toBe(false);
    interact(() => useSoundFxStore.getState().setOutputGainDb('snd', -6));
    globalUndo(); vi.runAllTimers();
    expect(useSoundFxStore.getState().chains.snd).toBeDefined();
    expect(useSoundFxStore.getState().chains.snd.outputGainDb).not.toBe(-6);
  });

  it('re-assign region: cancel records nothing, confirm records one step', () => {
    const layer = useAcousticLayerStore.getState();
    interact(() => layer.setAcousticSelection({ nodeIds: ['a'], nodeNames: ['A'] }));
    clearUndoHistory();
    // Re-assign → cancel
    interact(() => {
      captureAcousticSelectionSnapshot();
      useAcousticLayerStore.getState().clearAcousticLayer();
    });
    interact(() => restoreAcousticSelectionSnapshot());
    expect(canUndo()).toBe(false);
    // Re-assign → confirm
    interact(() => {
      captureAcousticSelectionSnapshot();
      useAcousticLayerStore.getState().clearAcousticLayer();
    });
    interact(() => {
      useAcousticLayerStore.getState().setAcousticSelection({ nodeIds: ['b'], nodeNames: ['B'] });
      discardAcousticSelectionSnapshot();
    });
    expect(useAcousticLayerStore.getState().selectedAcousticLayerIds).toEqual(['b']);
    globalUndo(); vi.runAllTimers();
    expect(useAcousticLayerStore.getState().selectedAcousticLayerIds).toEqual(['a']);
    expect(canUndo()).toBe(false);
  });

  it('streamed LLM results undo in one step', () => {
    interact(() => useAnalysisStore.getState().handleAddConfig('text'));
    for (let i = 1; i <= 5; i++) {
      useAnalysisStore.setState((st) => ({
        analysisResults: [{ configIndex: 0, prompts: Array.from({ length: i }, (_, k) => ({ id: `p${k}`, text: `t${k}`, selected: true })) }],
      }));
      vi.advanceTimersByTime(300);
    }
    globalUndo(); vi.runAllTimers();
    expect(useAnalysisStore.getState().analysisResults).toHaveLength(0);
    expect(useAnalysisStore.getState().analysisConfigs).toHaveLength(1);
  });
});
