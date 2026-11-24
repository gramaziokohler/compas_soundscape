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
import type { AnalysisConfig, SoundEvent, SoundGenerationConfig } from '@/types';
import type { SceneEditOp, SceneEditRefMap } from '@/types/sceneEdit';
import { applySceneEditOps } from './apply';
import { buildSceneEditSnapshot } from './snapshot';

const SCENE_SECONDS = 60;

const scenario = {
  type: 'scenario',
  display_name: 'Office',
  scene_id: 'scene-1',
  scenarioId: 'scn-1',
  timelineDurationMs: SCENE_SECONDS * 1000,
  scenarioResult: { scenarios: [{ title: 'Office', events: [{ timestamp: '00:00', description: 'Morning' }] }] },
} as unknown as AnalysisConfig;

const source = (entryId: string, extra: Record<string, unknown> = {}) =>
  ({
    scenarioId: 'scn-1', foleyId: null, speechId: null, entryId, isSpeech: false, copyCount: 1,
    soundName: entryId, description: entryId, category: 'sound event', duration: '00:02',
    timestamps: [], objectsInvolved: [], position: [], character: '', script: '', speechLines: [], ...extra,
  }) as SoundGenerationConfig['scenarioSource'];

const card = (id: string, extra: Partial<SoundGenerationConfig> = {}) =>
  ({
    config_id: id, prompt: id, display_name: id, duration: 2, seed_copies: 1, steps: 8,
    parentUsageOriginalIndex: 0, scenarioSource: source(id), ...extra,
  }) as unknown as SoundGenerationConfig;

const event = (id: string, configId: string, promptIndex: number, extra: Partial<SoundEvent> = {}) =>
  ({ id, config_id: configId, prompt_index: promptIndex, url: `/${id}.wav`, position: [1, 2, 0], volume_dbfs: -20, ...extra }) as unknown as SoundEvent;

const op = (partial: Partial<SceneEditOp> & Pick<SceneEditOp, 'op'>): SceneEditOp => ({
  targets: [], new_ref: '', db: null, delta_db: null, on: null, start: null, end: null, times_s: [],
  delta_s: null, count: null, interval_s: null, seconds: null, position: [],
  preset: '', yaw_deg: null, name: '', prompt: '', category: '', duration_s: null, character: '', lines: [],
  title: '', ...partial,
});

function stubLocalStorage() {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v); },
    removeItem: (k: string) => { data.delete(k); },
  });
}

let refMap: SceneEditRefMap;
let names: Record<string, string>;

function apply(...ops: SceneEditOp[]) {
  return applySceneEditOps(0, ops, refMap, names, SCENE_SECONDS);
}

beforeEach(() => {
  stubLocalStorage();
  vi.useFakeTimers();
  useAnalysisStore.setState({ analysisConfigs: [scenario], analysisResults: [], activeAnalysisTab: 0 });
  const events = [
    event('generated_HUM_0', 'HUM', 0),
    event('generated_STEP_0', 'STEP', 1),
    // One take per speech line.
    event('tts_SOFIA_0_Kore', 'SOFIA', 2),
    event('tts_SOFIA_1_Kore', 'SOFIA', 2),
  ];
  useSoundscapeStore.setState({
    soundConfigs: [
      card('HUM', { category: 'background sound' }),
      card('STEP', {
        category: 'sound event',
        orchestrateMeta: {
          orchestrateId: 'orc-1', entryId: 'STEP', trigger: { type: 'param', expression: ['00:03'], delay: [0] },
          variants: [1], allObjectIds: [], timestamps: ['00:03'],
        },
      }),
      card('SOFIA', {
        type: 'text-to-speech', category: 'speech', voice_name: 'Kore',
        scenarioSource: source('SOFIA', { isSpeech: true, character: 'Sofia', speechLines: ['Hello', 'Bye'] }),
      }),
    ],
    soundscapeData: events,
    generatedSounds: events,
  });
  useAudioControlsStore.setState({ soundVolumes: {}, mutedSounds: new Set(), soloedSounds: new Set() });
  clearUndoHistory();
  const built = buildSceneEditSnapshot(0, 'English');
  if (!built) throw new Error('no snapshot');
  refMap = built.refMap;
  names = Object.fromEntries(built.snapshot.cards.map((c) => [c.ref, c.name]));
});

afterEach(() => {
  vi.runAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('scene edit snapshot', () => {
  it('lists the scene cards with refs, kinds and levels', () => {
    const built = buildSceneEditSnapshot(0, 'English');
    expect(built?.snapshot.cards.map((c) => [c.ref, c.kind, c.name])).toEqual([
      ['S1', 'foley', 'HUM'], ['S2', 'foley', 'STEP'], ['S3', 'speech', 'SOFIA'],
    ]);
    expect(built?.snapshot.cards[2].lines).toEqual(['Hello', 'Bye']);
    expect(built?.snapshot.cards[1].times_s).toEqual([3]);
    expect(built?.snapshot.cards[0].level_db).toBe(-20);
    expect(built?.snapshot.duration_s).toBe(SCENE_SECONDS);
  });
});

describe('applySceneEditOps', () => {
  it('lowers a level relative to the current one on every variant', () => {
    const ctx = apply(op({ op: 'set_level', targets: ['S1'], delta_db: -6 }));
    expect(useAudioControlsStore.getState().soundVolumes.generated_HUM_0).toBe(-26);
    expect(ctx.labels).toHaveLength(1);
    expect(ctx.needsOrchestrate).toBe(false);
  });

  it('mutes whole tracks idempotently', () => {
    apply(op({ op: 'mute', targets: ['S2'] }), op({ op: 'mute', targets: ['S2'] }));
    expect(useAudioControlsStore.getState().mutedSounds.has('generated_STEP_0')).toBe(true);
  });

  it('pins times as absolute trigger expressions and asks for re-orchestration', () => {
    const ctx = apply(op({ op: 'set_times', targets: ['S2'], times_s: [5, 25] }));
    const meta = useSoundscapeStore.getState().soundConfigs[1].orchestrateMeta;
    expect(meta?.trigger).toEqual({ type: 'absolute', expression: ['00:05', '00:25'], delay: [0, 0] });
    expect(meta?.variants).toEqual([1, 1]);
    expect(ctx.needsOrchestrate).toBe(true);
  });

  it('refuses to retime a background bed', () => {
    const ctx = apply(op({ op: 'set_times', targets: ['S1'], times_s: [5] }));
    expect(ctx.labels).toHaveLength(0);
    expect(ctx.warnings[0]).toMatch(/whole scene/);
  });

  it('adds a speaker card that later ops can address by its new ref', () => {
    const ctx = apply(
      op({ op: 'add_speaker', new_ref: 'N1', character: 'Marc', lines: ['Sorry, quick question'], times_s: [25], position: [2, 3, 1.6] }),
      op({ op: 'set_level', targets: ['N1'], db: -24 }),
    );
    const configs = useSoundscapeStore.getState().soundConfigs;
    const added = configs[configs.length - 1];
    expect(added.type).toBe('text-to-speech');
    expect(added.parentUsageOriginalIndex).toBe(0);
    expect(added.scenarioSource?.speechLines).toEqual(['Sorry, quick question']);
    expect(added.timestamps).toEqual(['00:25']);
    expect(added.position).toEqual([2, 3, 1.6]);
    expect(added.dbfs).toBe(-24);
    expect(ctx.regen.generateNew.has(added.config_id as string)).toBe(true);
    expect(ctx.needsOrchestrate).toBe(true);
  });

  it('queues only the extra variants of a generated sound', () => {
    const ctx = apply(op({ op: 'set_variants', targets: ['S2'], count: 3 }));
    expect(ctx.regen.addCopies.get('STEP')).toBe(2);
    expect(useSoundscapeStore.getState().soundConfigs[1].scenarioSource?.copyCount).toBe(3);
  });

  it('regenerates only edited speech lines when the count is unchanged', () => {
    const ctx = apply(op({ op: 'edit_lines', targets: ['S3'], lines: ['Hello', 'Wait—'] }));
    expect(ctx.regen.inPlaceLines.get('SOFIA')).toEqual([1]);
    expect(ctx.regen.force.size).toBe(0);
  });

  it('resolves refs by card identity after an earlier removal in the plan', () => {
    apply(op({ op: 'remove', targets: ['S1'] }), op({ op: 'set_level', targets: ['S2'], db: -30 }));
    const configs = useSoundscapeStore.getState().soundConfigs;
    expect(configs.map((c) => c.config_id)).toEqual(['STEP', 'SOFIA']);
    expect(useAudioControlsStore.getState().soundVolumes.generated_STEP_0).toBe(-30);
  });

  it('is undone in one step', () => {
    apply(
      op({ op: 'set_level', targets: ['S1'], delta_db: -6 }),
      op({ op: 'add_sound', new_ref: 'N1', name: 'Door', prompt: 'door creak', times_s: [10] }),
    );
    expect(useSoundscapeStore.getState().soundConfigs).toHaveLength(4);
    globalUndo();
    expect(useSoundscapeStore.getState().soundConfigs).toHaveLength(3);
    expect(useAudioControlsStore.getState().soundVolumes.generated_HUM_0).toBeUndefined();
  });
});
