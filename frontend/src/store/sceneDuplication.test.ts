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
  useAudioControlsStore,
  useSoundscapeStore,
} from '@/store';
import { apiService } from '@/services/api';
import type { AnalysisConfig, SoundEvent, SoundGenerationConfig } from '@/types';
import { parseSoundCopyIndex } from '@/lib/audio/utils/variant-sound-id';
import { duplicateSoundScene } from '@/utils/duplicateSoundScene';

const scenario = {
  type: 'scenario',
  display_name: 'Office',
  scenarioId: 'scn-1',
  orchestrateId: 'orc-1',
} as unknown as AnalysisConfig;
const textScene = { type: 'text', display_name: 'Park' } as unknown as AnalysisConfig;

const sound = (id: string, parent: number, extra: Partial<SoundGenerationConfig> = {}) =>
  ({ config_id: id, prompt: id, display_name: id, parentUsageOriginalIndex: parent, ...extra }) as unknown as SoundGenerationConfig;
const event = (id: string, configId: string, promptIndex: number, url: string) =>
  ({ id, config_id: configId, prompt_index: promptIndex, url, position: [1, 2, 3] }) as unknown as SoundEvent;

/** Minimal in-memory localStorage (vitest runs in Node; persisted stores write to it). */
function stubLocalStorage() {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v); },
    removeItem: (k: string) => { data.delete(k); },
  });
}

beforeEach(() => {
  stubLocalStorage();
  vi.useFakeTimers();
  vi.spyOn(apiService, 'duplicateScenario').mockResolvedValue({ scenario_id: 'scn-2' });
  useAnalysisStore.setState({ analysisConfigs: [scenario, textScene], analysisResults: [], activeAnalysisTab: 0 });
  const events = [
    event('generated_A1_0', 'A1', 0, '/a1-0.wav'),
    event('generated_A1_1', 'A1', 0, '/a1-1.wav'),
    // Speech line of card 1 (cardIndex * 10000 + line).
    event('tts_A2_0_Kore', 'A2', 10000, '/a2.wav'),
    event('generated_B1_0', 'B1', 2, '/b1.wav'),
  ];
  useSoundscapeStore.setState({
    soundConfigs: [
      sound('A1', 0, {
        scenarioSource: { scenarioId: 'scn-1', entryId: 'e1' } as SoundGenerationConfig['scenarioSource'],
      }),
      sound('A2', 0),
      sound('B1', 1),
    ],
    soundscapeData: events,
    generatedSounds: events,
  });
  useAudioControlsStore.setState({
    selectedVariants: { 0: 1 },
    soundVolumes: { generated_A1_0: -12 },
    iterationTrims: { 'generated_A1_0-1': { start: 0.1, end: 0.9 } },
  });
  clearUndoHistory();
});

afterEach(() => {
  vi.runAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('duplicateSoundScene', () => {
  it('copies the scene, its sounds and DAW state under fresh ids', async () => {
    const copyIndex = await duplicateSoundScene(0);
    vi.runAllTimers();
    expect(copyIndex).toBe(1);

    const configs = useAnalysisStore.getState().analysisConfigs as Array<AnalysisConfig & Record<string, unknown>>;
    expect(configs.map((c) => c.display_name)).toEqual(['Office', 'Office (copy)', 'Park']);
    expect(configs[1].scenarioId).toBe('scn-2');
    expect(configs[1].orchestrateId).not.toBe('orc-1');

    const { soundConfigs, generatedSounds } = useSoundscapeStore.getState();
    // Source kept, later scene shifted, copies appended.
    expect(soundConfigs.map((c) => c.parentUsageOriginalIndex)).toEqual([0, 0, 2, 1, 1]);
    const [c1, c2] = soundConfigs.slice(3);
    expect(c1.config_id).not.toBe('A1');
    expect(c2.config_id).not.toBe('A2');
    expect(c1.scenarioSource?.scenarioId).toBe('scn-2');
    expect(soundConfigs[0].scenarioSource?.scenarioId).toBe('scn-1');

    const copies = (generatedSounds as SoundEvent[]).slice(4);
    expect(copies.map((e) => e.prompt_index)).toEqual([3, 3, 40000]);
    expect(copies.map((e) => (e as unknown as { url: string }).url)).toEqual(['/a1-0.wav', '/a1-1.wav', '/a2.wav']);
    expect(copies.map((e) => parseSoundCopyIndex(e.id))).toEqual([0, 1, 0]);
    expect(copies[0].id).toBe(`generated_${c1.config_id}_0`);
    expect(copies[2].id).toBe(`tts_${c2.config_id}_0_Kore`);

    const audio = useAudioControlsStore.getState();
    expect(audio.selectedVariants[3]).toBe(1);
    expect(audio.soundVolumes[copies[0].id]).toBe(-12);
    expect(audio.iterationTrims[`${copies[0].id}-1`]).toEqual({ start: 0.1, end: 0.9 });
  });

  it('undoes as one step', async () => {
    await duplicateSoundScene(0);
    vi.runAllTimers();
    globalUndo();
    vi.runAllTimers();
    expect(useAnalysisStore.getState().analysisConfigs).toHaveLength(2);
    expect(useSoundscapeStore.getState().soundConfigs.map((c) => c.config_id)).toEqual(['A1', 'A2', 'B1']);
    expect(useSoundscapeStore.getState().soundConfigs[2].parentUsageOriginalIndex).toBe(1);
  });

  it('copies nothing when the scenario clone fails', async () => {
    vi.spyOn(apiService, 'duplicateScenario').mockRejectedValue(new Error('404'));
    expect(await duplicateSoundScene(0)).toBeNull();
    expect(useAnalysisStore.getState().analysisConfigs).toHaveLength(2);
    expect(useSoundscapeStore.getState().soundConfigs).toHaveLength(3);
  });
});
