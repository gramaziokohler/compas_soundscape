/**
 * Foley FX chain types.
 *
 * A chain is an ordered array of instances. Duplicates and empty chains are
 * allowed. Order is the signal order (index 0 is closest to the source).
 */

export const STABLE_AUDIO_FX_TYPES = [
  'stableAudioRestyle',
  'stableAudioInpaint',
  'stableAudioExtend',
] as const;

export type StableAudioFxType = (typeof STABLE_AUDIO_FX_TYPES)[number];
export type StableAudioModeName = 'restyle' | 'inpaint' | 'extend';

/** Stable Audio effects come first in the add menu. */
export const FX_TYPES = [
  ...STABLE_AUDIO_FX_TYPES,
  'eq',
  'clean',
  'gate',
  'saturation',
  'distortion',
  'compressor',
  'limiter',
  'delay',
  'pitch',
  'gain',
] as const;

export type FxType = (typeof FX_TYPES)[number];

export const FX_TYPE_LABELS: Record<FxType, string> = {
  stableAudioRestyle: 'Stable Audio · Restyle',
  stableAudioInpaint: 'Stable Audio · Inpaint',
  stableAudioExtend: 'Stable Audio · Extend',
  eq: 'Equalizer',
  clean: 'HP / LP',
  gate: 'Gate',
  saturation: 'Saturation',
  distortion: 'Distortion',
  compressor: 'Compressor',
  limiter: 'Limiter',
  delay: 'Delay',
  pitch: 'Pitch',
  gain: 'Gain',
};

export function isStableAudioFx(type: FxType): type is StableAudioFxType {
  return (STABLE_AUDIO_FX_TYPES as readonly string[]).includes(type);
}

/** Narrows an instance (and its params) to the Stable Audio variants. */
export function isStableAudioInstance(
  inst: FxInstance,
): inst is Extract<FxInstance, { type: StableAudioFxType }> {
  return isStableAudioFx(inst.type);
}

export function stableAudioModeFor(type: StableAudioFxType): StableAudioModeName {
  switch (type) {
    case 'stableAudioRestyle':
      return 'restyle';
    case 'stableAudioInpaint':
      return 'inpaint';
    case 'stableAudioExtend':
      return 'extend';
  }
}

export type BiquadKind = 'highpass' | 'lowshelf' | 'peaking' | 'highshelf' | 'lowpass';

export interface EqBand {
  type: BiquadKind;
  freq: number;
  gain: number;
  q: number;
  enabled: boolean;
}

export interface EqParams {
  bands: EqBand[];
}

export interface CleanParams {
  highpassHz: number;
  lowpassHz: number;
}

export interface GateParams {
  thresholdDb: number;
  attackMs: number;
  holdMs: number;
  releaseMs: number;
}

export interface DriveParams {
  drive: number;
  toneHz: number;
  mix: number;
}

export interface CompressorParams {
  thresholdDb: number;
  ratio: number;
  attackMs: number;
  releaseMs: number;
  kneeDb: number;
  makeupDb: number;
}

export interface LimiterParams {
  /** Output ceiling in dBFS — peaks above this are pulled down. */
  thresholdDb: number;
  releaseMs: number;
}

export interface DelayParams {
  timeMs: number;
  feedback: number;
  mix: number;
  dampingHz: number;
}

export interface PitchParams {
  semitones: number;
}

export interface GainParams {
  gainDb: number;
}

/**
 * Stable Audio 3 — a SERVER-rendered stage (audio-to-audio restyle, inpainting
 * or continuation). It has no live Web Audio node (the graph treats it as a
 * passthrough) and produces its output when the user presses Generate, which
 * stores the result URL in `renderedUrl`. Save threads that result through the
 * remaining effects.
 */
export interface StableAudioParams {
  prompt: string;
  negativePrompt: string;
  /** 0 = keep the source, 1 = full re-imagining (maps to init_noise_level). */
  strength: number;
  steps: number;
  cfgScale: number;
  /** -1 = random. */
  seed: number;
  /** Inpaint replace-regions as fractions of the clip duration. */
  regions: FxRegion[];
  /** Extend/continuation target length in seconds. Ignored by restyle/inpaint. */
  duration: number;
  durationPaddingSec: number;
  /** URL of the last generated result (server static file). */
  renderedUrl?: string;
  /** Signature of the params+pre-chain that produced `renderedUrl` (staleness check). */
  renderedSignature?: string;
}

export type FxParams =
  | EqParams
  | CleanParams
  | GateParams
  | DriveParams
  | CompressorParams
  | LimiterParams
  | DelayParams
  | PitchParams
  | GainParams
  | StableAudioParams;

export interface FxInstanceBase {
  instanceId: string;
  enabled: boolean;
}

export type FxInstance =
  | (FxInstanceBase & { type: 'eq'; params: EqParams })
  | (FxInstanceBase & { type: 'clean'; params: CleanParams })
  | (FxInstanceBase & { type: 'gate'; params: GateParams })
  | (FxInstanceBase & { type: 'saturation'; params: DriveParams })
  | (FxInstanceBase & { type: 'distortion'; params: DriveParams })
  | (FxInstanceBase & { type: 'compressor'; params: CompressorParams })
  | (FxInstanceBase & { type: 'limiter'; params: LimiterParams })
  | (FxInstanceBase & { type: 'delay'; params: DelayParams })
  | (FxInstanceBase & { type: 'pitch'; params: PitchParams })
  | (FxInstanceBase & { type: 'gain'; params: GainParams })
  | (FxInstanceBase & { type: 'stableAudioRestyle'; params: StableAudioParams })
  | (FxInstanceBase & { type: 'stableAudioInpaint'; params: StableAudioParams })
  | (FxInstanceBase & { type: 'stableAudioExtend'; params: StableAudioParams });

/** Keep-mask regions as fractions of the original clip duration. */
export type FxRegion = { start: number; end: number };

export interface FxChain {
  instances: FxInstance[];
  /** Inclusive keep-mask. Empty / omitted = keep the whole clip. */
  regions?: FxRegion[];
  outputGainDb: number;
}

export function isFxType(value: string): value is FxType {
  return (FX_TYPES as readonly string[]).includes(value);
}

/**
 * Normalize a keep-mask to a sorted, non-overlapping union. Overlapping /
 * touching regions merge into one so playback and render never repeat audio
 * that two regions cover.
 */
export function mergeFxRegions(regions?: FxRegion[]): FxRegion[] {
  if (!regions || regions.length === 0) return [];
  const sorted = regions
    .filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start)
    .map((r) => ({ start: Math.max(0, r.start), end: Math.min(1, r.end) }))
    .sort((a, b) => a.start - b.start);
  const merged: FxRegion[] = [];
  for (const r of sorted) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) {
      last.end = Math.max(last.end, r.end);
    } else {
      merged.push({ ...r });
    }
  }
  return merged;
}
