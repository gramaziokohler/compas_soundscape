import type {
  CleanParams,
  CompressorParams,
  DelayParams,
  DriveParams,
  EqBand,
  EqParams,
  FxChain,
  FxInstance,
  FxType,
  GainParams,
  GateParams,
  LimiterParams,
  NoiseReductionParams,
  PitchParams,
  StableAudioParams,
  TrimSilenceParams,
} from './fx-types';
import { FX_TYPES } from './fx-types';
import {
  SOUND_FX,
  STABLE_AUDIO_DEFAULT_STEPS,
  STABLE_AUDIO_DEFAULT_GUIDANCE,
  STABLE_AUDIO_DEFAULT_STRENGTH,
  STABLE_AUDIO_DEFAULT_DURATION_PADDING_SEC,
} from '@/utils/constants';

export function newFxInstanceId(): string {
  return `fx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function defaultEqBands(): EqBand[] {
  return [
    { type: 'highpass', freq: 40, gain: 0, q: 0.7, enabled: true },
    { type: 'lowshelf', freq: 120, gain: 0, q: 0.7, enabled: true },
    { type: 'peaking', freq: 400, gain: 0, q: 1.0, enabled: true },
    { type: 'peaking', freq: 1500, gain: 0, q: 1.0, enabled: true },
    { type: 'peaking', freq: 5000, gain: 0, q: 1.0, enabled: true },
    { type: 'highshelf', freq: 10000, gain: 0, q: 0.7, enabled: true },
  ];
}

export const FX_DEFAULTS = {
  eq: (): EqParams => ({ bands: defaultEqBands() }),
  clean: (): CleanParams => ({ highpassHz: 20, lowpassHz: 20000 }),
  gate: (): GateParams => ({ thresholdDb: -40, attackMs: 2, holdMs: 40, releaseMs: 80 }),
  saturation: (): DriveParams => ({ drive: 0.25, toneHz: 6000, mix: 0.5 }),
  distortion: (): DriveParams => ({ drive: 0.35, toneHz: 4000, mix: 0.4 }),
  compressor: (): CompressorParams => ({
    thresholdDb: -18,
    ratio: 3,
    attackMs: 8,
    releaseMs: 80,
    kneeDb: 6,
    makeupDb: 0,
  }),
  limiter: (): LimiterParams => ({ thresholdDb: -1, releaseMs: 60 }),
  delay: (): DelayParams => ({ timeMs: 80, feedback: 0.2, mix: 0.18, dampingHz: 3500 }),
  pitch: (): PitchParams => ({ semitones: 0 }),
  gain: (): GainParams => ({ gainDb: 0 }),
  noiseReduction: (): NoiseReductionParams => ({
    reduction: SOUND_FX.NOISE_REDUCTION_DEFAULT,
  }),
  trimSilence: (): TrimSilenceParams => ({}),
  stableAudioRestyle: stableAudioParams,
  stableAudioInpaint: stableAudioParams,
  stableAudioExtend: stableAudioParams,
} as const;

function stableAudioParams(): StableAudioParams {
  return {
    prompt: '',
    negativePrompt: '',
    strength: STABLE_AUDIO_DEFAULT_STRENGTH,
    steps: STABLE_AUDIO_DEFAULT_STEPS,
    guidance: STABLE_AUDIO_DEFAULT_GUIDANCE,
    seed: -1,
    regions: [],
    duration: 0,
    durationPaddingSec: STABLE_AUDIO_DEFAULT_DURATION_PADDING_SEC,
  };
}

export function defaultParamsFor(type: FxType): FxInstance['params'] {
  return FX_DEFAULTS[type]();
}

export function createDefaultInstance(type: FxType): FxInstance {
  const instanceId = newFxInstanceId();
  switch (type) {
    case 'eq':
      return { instanceId, type, enabled: true, params: FX_DEFAULTS.eq() };
    case 'clean':
      return { instanceId, type, enabled: true, params: FX_DEFAULTS.clean() };
    case 'gate':
      return { instanceId, type, enabled: true, params: FX_DEFAULTS.gate() };
    case 'saturation':
      return { instanceId, type, enabled: true, params: FX_DEFAULTS.saturation() };
    case 'distortion':
      return { instanceId, type, enabled: true, params: FX_DEFAULTS.distortion() };
    case 'compressor':
      return { instanceId, type, enabled: true, params: FX_DEFAULTS.compressor() };
    case 'limiter':
      return { instanceId, type, enabled: true, params: FX_DEFAULTS.limiter() };
    case 'delay':
      return { instanceId, type, enabled: true, params: FX_DEFAULTS.delay() };
    case 'pitch':
      return { instanceId, type, enabled: true, params: FX_DEFAULTS.pitch() };
    case 'gain':
      return { instanceId, type, enabled: true, params: FX_DEFAULTS.gain() };
    case 'noiseReduction':
      return { instanceId, type, enabled: true, params: FX_DEFAULTS.noiseReduction() };
    case 'trimSilence':
      return { instanceId, type, enabled: true, params: FX_DEFAULTS.trimSilence() };
    case 'stableAudioRestyle':
    case 'stableAudioInpaint':
    case 'stableAudioExtend':
      return { instanceId, type, enabled: true, params: FX_DEFAULTS[type]() };
  }
}

export function emptyFxChain(): FxChain {
  return { instances: [], regions: [], outputGainDb: 0 };
}

export function cloneFxChain(chain: FxChain): FxChain {
  return {
    instances: chain.instances.map((inst) => ({
      ...inst,
      instanceId: newFxInstanceId(),
      params: structuredClone(inst.params),
    })) as FxChain['instances'],
    regions: chain.regions?.map((r) => ({ ...r })),
    outputGainDb: chain.outputGainDb,
  };
}

/** Deep-clone a chain but keep instance ids (used when restoring from a SoundEvent). */
export function copyFxChain(chain: FxChain): FxChain {
  return sanitizeFxChain(structuredClone(chain));
}

/**
 * Drop instances whose type no longer exists (e.g. a chain saved before the
 * Expander/Transient effects were removed) and backfill any params missing from
 * older saves, so the graph builder never receives an unknown type or NaN param.
 */
export function sanitizeFxChain(chain: FxChain | null | undefined): FxChain {
  if (!chain || typeof chain !== 'object') return emptyFxChain();
  const rawInstances = Array.isArray(chain.instances) ? chain.instances : [];
  const instances = rawInstances
    .filter((inst) => inst && (FX_TYPES as readonly string[]).includes(inst.type))
    .map((inst) => ({
      ...inst,
      params: { ...defaultParamsFor(inst.type), ...(inst.params ?? {}) },
    })) as FxChain['instances'];
  return {
    instances,
    regions: Array.isArray(chain.regions) ? chain.regions.map((r) => ({ ...r })) : undefined,
    outputGainDb: typeof chain.outputGainDb === 'number' ? chain.outputGainDb : 0,
  };
}
