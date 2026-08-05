import { SIMULATION_POSITION_MATCH_THRESHOLD } from './constants';

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
 * Check if two positions fall within the same precision grid cell.
 */
export function positionsMatch(
  pos1: [number, number, number],
  pos2: [number, number, number],
  precision: number = SIMULATION_POSITION_MATCH_THRESHOLD
): boolean {
  return computePositionKey(pos1, precision) === computePositionKey(pos2, precision);
}

/**
 * Group a list of sound-like objects by their spatial position.
 * Returns the set of unique position keys and a mapping from each sound's id to its key.
 */
export function groupSoundsByPosition(
  sounds: Array<{ id: string; position: [number, number, number] }>,
  precision: number = SIMULATION_POSITION_MATCH_THRESHOLD
): {
  uniquePositions: Map<string, [number, number, number]>;
  soundToPosKey: Map<string, string>;
} {
  const uniquePositions = new Map<string, [number, number, number]>();
  const soundToPosKey = new Map<string, string>();

  for (const sound of sounds) {
    if (!sound.position || sound.position.length !== 3) continue;
    const key = computePositionKey(sound.position, precision);
    if (!uniquePositions.has(key)) {
      uniquePositions.set(key, sound.position);
    }
    if (!soundToPosKey.has(sound.id)) {
      soundToPosKey.set(sound.id, key);
    }
  }

  return { uniquePositions, soundToPosKey };
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
