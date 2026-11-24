/**
 * Per-occurrence variation of repeated sound events.
 *
 * Each played occurrence of a sound event gets a small pitch (detune) and level
 * offset so a repeated action (page turns, footsteps, taps) does not sound like
 * one clip retriggered. Values are hash-seeded on (sound id, occurrence index):
 * stable across renders, playback and export, with no stored state needed. The
 * user can scale them per sound (off / subtle / strong) and override or re-roll
 * single occurrences from the DAW clip menu.
 *
 * Speech and background beds are never varied (a pitched voice sounds wrong; a
 * bed is one continuous texture).
 */

import type { ClipVariation, ClipVariationMode, ClipVariationOverride } from '@/types/audio';
import { CLIP_VARIATION } from '@/utils/constants';
import { computeIterationJitter } from './timeline-utils';

export const NO_VARIATION: ClipVariation = { detuneCents: 0, gainDb: 0 };

/** True for categories whose occurrences are varied (sound events only). */
export function isVariedCategory(category: string | undefined): boolean {
  const cat = (category ?? '').toLowerCase().replace(/[\s-]+/g, '_');
  return cat !== 'speech' && cat !== 'background' && cat !== 'background_sound';
}

/** Range multiplier of a per-sound mode. */
export function variationScale(mode: ClipVariationMode | undefined): number {
  const m = mode ?? CLIP_VARIATION.DEFAULT_MODE;
  return CLIP_VARIATION.MODES.find((o) => o.value === m)?.scale ?? 1;
}

/** `iterationVariations` key of one occurrence. */
export function variationKey(soundId: string, iterationIndex: number): string {
  return `${soundId}-${iterationIndex}`;
}

/**
 * Pitch / level offset of one occurrence. `category` gates speech and beds out;
 * an override's explicit values win, its `seed` re-rolls the automatic ones.
 */
export function clipVariation(
  soundId: string,
  iterationIndex: number,
  category: string | undefined,
  mode: ClipVariationMode | undefined,
  override?: ClipVariationOverride,
): ClipVariation {
  if (!isVariedCategory(category)) return NO_VARIATION;
  const scale = variationScale(mode);
  const seed = override?.seed ? `~${override.seed}` : '';
  const autoCents = computeIterationJitter(`${soundId}:pitch${seed}`, iterationIndex, CLIP_VARIATION.DETUNE_CENTS * scale);
  const autoDb = computeIterationJitter(`${soundId}:gain${seed}`, iterationIndex, CLIP_VARIATION.GAIN_DB * scale);
  return {
    detuneCents: Math.round(override?.detuneCents ?? autoCents),
    gainDb: Math.round((override?.gainDb ?? autoDb) * 10) / 10,
  };
}

/** Playback-rate factor of a detune (a detuned voice plays shorter / longer by this). */
export function detuneRate(detuneCents: number): number {
  return Math.pow(2, detuneCents / 1200);
}

/** Linear gain of a dB offset. */
export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

/** Short clip label, e.g. "+32 ct · −1.2 dB" ("" when there is no variation). */
export function formatClipVariation(v: ClipVariation): string {
  if (v.detuneCents === 0 && v.gainDb === 0) return '';
  const sign = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '±');
  return `${sign(v.detuneCents)}${Math.abs(v.detuneCents)} ct · ${sign(v.gainDb)}${Math.abs(v.gainDb).toFixed(1)} dB`;
}
