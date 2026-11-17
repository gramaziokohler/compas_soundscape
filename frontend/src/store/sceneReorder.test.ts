import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The viewer cannot load in Node; the stores only reference its extension classes.
vi.mock('@speckle/viewer', () => ({
  FilteringExtension: class {},
  CameraController: class {},
  SelectionExtension: class {},
  Viewer: class {},
}));
import {
  clearUndoHistory,
  globalUndo,
  useAnalysisStore,
  useCardFlowStore,
  useSceneWorkflowStore,
  useSoundscapeStore,
  useUIStore,
} from '@/store';
import type { AnalysisConfig, AnalysisResult, SoundGenerationConfig } from '@/types';
import type { SceneRun } from '@/types/sceneWorkflow';

// [0] context X, [1] scene A (on X), [2] context Y, [3] scene B (on Y)
const contextX = { type: 'freeform', display_name: 'X' } as unknown as AnalysisConfig;
const sceneA = { type: 'text', display_name: 'A', parentContextOriginalIndex: 0 } as unknown as AnalysisConfig;
const contextY = { type: 'freeform', display_name: 'Y' } as unknown as AnalysisConfig;
const sceneB = { type: 'text', display_name: 'B', parentContextOriginalIndex: 2 } as unknown as AnalysisConfig;

const sound = (id: string, parent: number) =>
  ({ config_id: id, prompt: id, display_name: id, parentUsageOriginalIndex: parent }) as unknown as SoundGenerationConfig;
const run = (usageIndex: number, contextIndex: number) =>
  ({ runId: `run-${usageIndex}`, usageIndex, contextIndex, status: 'error' }) as unknown as SceneRun;

/** Minimal in-memory localStorage (vitest runs in Node; persisted stores write to it). */
function stubLocalStorage() {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v); },
    removeItem: (k: string) => { data.delete(k); },
  });
}

const names = () => useAnalysisStore.getState().analysisConfigs.map((c) => c.display_name);
/** Display name of the scene each sound belongs to. */
const soundOwners = () => {
  const configs = useAnalysisStore.getState().analysisConfigs;
  return useSoundscapeStore.getState().soundConfigs.map((s) => configs[s.parentUsageOriginalIndex ?? -1]?.display_name);
};
/** Display name of each card's parent context. */
const contextOf = (name: string) => {
  const configs = useAnalysisStore.getState().analysisConfigs;
  const card = configs.find((c) => c.display_name === name) as { parentContextOriginalIndex?: number } | undefined;
  return card?.parentContextOriginalIndex !== undefined ? configs[card.parentContextOriginalIndex]?.display_name : undefined;
};

beforeEach(() => {
  stubLocalStorage();
  vi.useFakeTimers();
  useAnalysisStore.setState({
    analysisConfigs: [contextX, sceneA, contextY, sceneB],
    analysisResults: [{ configIndex: 3 } as unknown as AnalysisResult],
    activeAnalysisTab: 3,
  });
  useSoundscapeStore.setState({ soundConfigs: [sound('A1', 1), sound('B1', 3), sound('B2', 3)] });
  useUIStore.setState({ activeSoundParentIndex: 3 });
  useCardFlowStore.setState({ usageToSoundMap: new Map([[1, [0]], [3, [1, 2]]]) });
  useSceneWorkflowStore.setState({ runs: { 3: run(3, 2) } });
  clearUndoHistory();
});

afterEach(() => {
  vi.runAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('handleReorderConfigs', () => {
  it('moves a scene and keeps every index link on the same card', () => {
    useAnalysisStore.getState().handleReorderConfigs(3, 1);
    vi.runAllTimers();

    expect(names()).toEqual(['X', 'B', 'A', 'Y']);
    // Sounds stay with their own scene, scenes with their own context.
    expect(soundOwners()).toEqual(['A', 'B', 'B']);
    expect(contextOf('A')).toBe('X');
    expect(contextOf('B')).toBe('Y');

    // Powered scene, results, active tab, card flow and the scene run follow B.
    expect(useUIStore.getState().activeSoundParentIndex).toBe(1);
    expect(useAnalysisStore.getState().analysisResults[0].configIndex).toBe(1);
    expect(useAnalysisStore.getState().activeAnalysisTab).toBe(1);
    expect(useCardFlowStore.getState().usageToSoundMap.get(1)).toEqual([1, 2]);
    expect(useCardFlowStore.getState().usageToSoundMap.get(2)).toEqual([0]);
    const runs = useSceneWorkflowStore.getState().runs;
    expect(Object.keys(runs)).toEqual(['1']);
    expect(runs[1]).toMatchObject({ usageIndex: 1, contextIndex: 3 });
  });

  it('is a no-op when dropped in place', () => {
    useAnalysisStore.getState().handleReorderConfigs(1, 1);
    expect(names()).toEqual(['X', 'A', 'Y', 'B']);
    expect(soundOwners()).toEqual(['A', 'B', 'B']);
  });

  it('undoes as one step with the links intact', () => {
    useAnalysisStore.getState().handleReorderConfigs(3, 1);
    vi.runAllTimers();
    globalUndo();
    vi.runAllTimers();

    expect(names()).toEqual(['X', 'A', 'Y', 'B']);
    expect(soundOwners()).toEqual(['A', 'B', 'B']);
    expect(contextOf('B')).toBe('Y');
  });
});
