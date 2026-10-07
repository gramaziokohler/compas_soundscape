/**
 * Single source of truth for "which trim does this clip play with".
 *
 * A per-clip trim (DAW edge-drag, `iterationTrims`) OVERRIDES the sound-card trim
 * of the variant the clip plays (`soundTrims[variantSoundId]`). Both are fractions
 * (0–1) of the variant's full source buffer. Used by the DAW drawing
 * (timeline-utils), live playback (build-score) and WAV export so what you see,
 * hear and export never diverge.
 */

import type { TrimRange } from '@/types/audio';
import { iterationKey } from './iteration-keys';

export function resolveIterationTrim(
  soundId: string,
  originalIterationIndex: number,
  variantSoundId: string,
  iterationTrims: Record<string, TrimRange> | undefined,
  soundTrims: Record<string, TrimRange> | undefined,
): TrimRange | undefined {
  return iterationTrims?.[iterationKey(soundId, originalIterationIndex)] ?? soundTrims?.[variantSoundId];
}

/** Kept length of a source buffer of `sourceDuration` under `trim` (same unit in, same unit out). */
export function trimmedDuration(sourceDuration: number, trim: TrimRange | undefined): number {
  if (!trim) return sourceDuration;
  const start = Math.max(0, Math.min(1, trim.start ?? 0));
  const end = trim.end > 0 ? Math.min(1, trim.end) : 1;
  return Math.max(0, sourceDuration * (end - start));
}
