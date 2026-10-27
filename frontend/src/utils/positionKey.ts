import { DIRECTIVITY, SIMULATION_POSITION_MATCH_THRESHOLD } from './constants';
import type { SoundDirectivity } from '@/types/directivity';

/**
 * Compute a deterministic position key by quantizing coordinates to the given precision.
 * Multiple positions within precision/2 of each quantized grid point produce the same key.
 *
 * Example: threshold 0.5 and position [2.3, 1.6, 3.7] produce key "pos_2.5_1.5_3.5"
 */
export function computePositionKey(
  position: [number, number, number],
  precision: number = SIMULATION_POSITION_MATCH_THRESHOLD
): string {
  const quantize = (v: number) => Math.round(v / precision) * precision;
  return `pos_${quantize(position[0]).toFixed(2)}_${quantize(position[1]).toFixed(2)}_${quantize(position[2]).toFixed(2)}`;
}

/**
 * Source keys: omnidirectional sources keep the bare position key; a directional
 * source appends `~d<hash8>` (hash of directivity id + quantised orientation) so
 * co-located sounds with different patterns become separate simulated sources
 * (`pos_1.00_2.00_3.00~d1a2b3c4d`). The backend embeds the key verbatim as
 * `source_id` in IR filenames; `~` is filename- and URL-safe.
 */
const POSITION_KEY_RE = /^pos_(-?\d+(?:\.\d+)?)_(-?\d+(?:\.\d+)?)_(-?\d+(?:\.\d+)?)(?:~d[0-9a-f]{8})?$/;

/** True when the directivity is absent or the omni preset (no key suffix, no pattern). */
export function isOmniDirectivity(directivity?: SoundDirectivity | null): boolean {
  return !directivity || !directivity.id || directivity.id === DIRECTIVITY.OMNI_ID;
}

/** FNV-1a 32-bit hash as 8 hex chars (stable across platforms, no dependency). */
function fnv1a32(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** `~d<hash8>` of a directional source, '' for omni. */
export function directivityKeySuffix(directivity?: SoundDirectivity | null): string {
  if (isOmniDirectivity(directivity)) return '';
  const d = directivity as SoundDirectivity;
  const q = (v: number | undefined) => Math.round((v ?? 0) / DIRECTIVITY.ORIENTATION_QUANT_RAD);
  return `${DIRECTIVITY.KEY_SUFFIX_PREFIX}${fnv1a32(`${d.id}|${q(d.yaw)}|${q(d.pitch)}|${q(d.roll)}`)}`;
}

/** Simulation source key of a sound: position key plus the directivity suffix. */
export function computeSourceKey(
  position: [number, number, number],
  directivity?: SoundDirectivity | null,
  precision: number = SIMULATION_POSITION_MATCH_THRESHOLD
): string {
  return computePositionKey(position, precision) + directivityKeySuffix(directivity);
}

/** The bare position key of a source key (strips a `~d…` suffix). */
export function positionKeyBase(key: string): string {
  const i = key.indexOf(DIRECTIVITY.KEY_SUFFIX_PREFIX);
  return i === -1 ? key : key.slice(0, i);
}

/** True when the source key carries a directivity suffix. */
export function isDirectionalSourceKey(key: string): boolean {
  return key.includes(DIRECTIVITY.KEY_SUFFIX_PREFIX);
}

/**
 * Parse a position key (e.g. "pos_1100.00_850.00_250.00", with or without a
 * `~d…` directivity suffix) back into its quantized [x, y, z] coordinates.
 * Returns null when the string isn't a valid position key (e.g. a real
 * sound/receiver UUID passed through a manual-upload pairing context).
 *
 * These are the exact values the backend embeds as `source_id` in generated IR
 * filenames (`sim_{simId}_src_{posKey}_rcv_{receiverId}.wav`), since the source
 * key is sent verbatim as `source_id` in `source_receiver_pairs`.
 */
export function parsePositionKey(posKey: string): [number, number, number] | null {
  const match = posKey.match(POSITION_KEY_RE);
  if (!match) return null;
  return [parseFloat(match[1]), parseFloat(match[2]), parseFloat(match[3])];
}

/**
 * Check if two positions fall within the same precision grid cell.
 */
export function positionsMatch(
  pos1: [number, number, number],
  pos2: [number, number, number],
  precision: number = SIMULATION_POSITION_MATCH_THRESHOLD
): boolean {
  return computePositionKey(pos1, precision) === computePositionKey(pos2, precision);
}

/** Sound-like input of the grouping helpers (directivity optional). */
export interface GroupableSound {
  id: string;
  position: [number, number, number];
  directivity?: SoundDirectivity | null;
}

/**
 * Group a list of sound-like objects into simulated sources: by spatial position
 * and, when a sound is directional, by its directivity + orientation.
 * Returns the unique source keys with their positions and directivities, and a
 * mapping from each sound's id to its key.
 */
export function groupSoundsByPosition(
  sounds: GroupableSound[],
  precision: number = SIMULATION_POSITION_MATCH_THRESHOLD
): {
  uniquePositions: Map<string, [number, number, number]>;
  soundToPosKey: Map<string, string>;
  sourceDirectivities: Map<string, SoundDirectivity | undefined>;
} {
  const uniquePositions = new Map<string, [number, number, number]>();
  const soundToPosKey = new Map<string, string>();
  const sourceDirectivities = new Map<string, SoundDirectivity | undefined>();

  for (const sound of sounds) {
    if (!sound.position || sound.position.length !== 3) continue;
    const key = computeSourceKey(sound.position, sound.directivity, precision);
    if (!uniquePositions.has(key)) {
      uniquePositions.set(key, sound.position);
      sourceDirectivities.set(key, isOmniDirectivity(sound.directivity) ? undefined : (sound.directivity as SoundDirectivity));
    }
    if (!soundToPosKey.has(sound.id)) {
      soundToPosKey.set(sound.id, key);
    }
  }

  return { uniquePositions, soundToPosKey, sourceDirectivities };
}

/**
 * Collapse multi-variant sound sources to a single representative sound per prompt_index.
 *
 * Variants of one sound source (same `prompt_index`, different `copy_index`) are treated as a
 * SINGLE acoustic source: they share one source position and one sound sphere. The simulation
 * must therefore only ever see ONE sound per prompt — otherwise each variant (which may carry a
 * stale or zero position until the sphere manager places it) becomes its own simulated source.
 *
 * Prefers the currently selected variant; falls back to the first variant of the prompt.
 * Sounds without a `prompt_index` (e.g. restored legacy events) pass through unchanged.
 */
export function collapseVariantsToOne<T extends { prompt_index?: number; copy_index?: number }>(
  sounds: T[],
  selectedVariants: Record<number, number> = {}
): T[] {
  const byPrompt = new Map<number, T[]>();
  const noPrompt: T[] = [];

  for (const s of sounds) {
    if (s.prompt_index === undefined || s.prompt_index === null) {
      noPrompt.push(s);
      continue;
    }
    if (!byPrompt.has(s.prompt_index)) byPrompt.set(s.prompt_index, []);
    byPrompt.get(s.prompt_index)!.push(s);
  }

  const result: T[] = [...noPrompt];
  for (const [pi, variants] of byPrompt) {
    const selectedIdx = selectedVariants[pi];
    result.push(variants.find((v) => v.copy_index === selectedIdx) ?? variants[0]);
  }
  return result;
}
