/**
 * Sound Grouping Utilities
 *
 * Helper functions for organizing and grouping sound events.
 * Extracted from ThreeScene.tsx to centralize grouping logic.
 */

import type { SoundEvent } from "@/types";

/**
 * Group sound events by their prompt index.
 *
 * Used to organize sounds that were generated from the same prompt
 * into groups for variant selection.
 *
 * @param sounds - Array of sound events
 * @returns Object mapping prompt index to array of sounds
 *
 * @example
 * ```typescript
 * const sounds = [
 *   { promptIndex: 0, ... },
 *   { promptIndex: 0, ... }, // variant
 *   { promptIndex: 1, ... },
 * ];
 * const grouped = groupSoundsByPromptIndex(sounds);
 * // Result: { 0: [sound1, sound2], 1: [sound3] }
 * ```
 */
export function groupSoundsByPromptIndex(
  sounds: SoundEvent[]
): Record<number, SoundEvent[]> {
  return sounds.reduce((acc, sound) => {
    const idx = sound.prompt_index ?? 0;
    if (!acc[idx]) {
      acc[idx] = [];
    }
    acc[idx].push(sound);
    return acc;
  }, {} as Record<number, SoundEvent[]>);
}

/**
 * Get all unique prompt indices from sound events.
 *
 * @param sounds - Array of sound events
 * @returns Sorted array of unique prompt indices
 */
export function getUniquePromptIndices(sounds: SoundEvent[]): number[] {
  const indices = new Set<number>();
  sounds.forEach(sound => {
    indices.add(sound.prompt_index ?? 0);
  });
  return Array.from(indices).sort((a, b) => a - b);
}

/**
 * Get all variants for a specific prompt index.
 *
 * @param sounds - Array of sound events
 * @param promptIndex - The prompt index to filter by
 * @returns Array of sounds matching the prompt index
 */
export function getVariantsForPrompt(
  sounds: SoundEvent[],
  promptIndex: number
): SoundEvent[] {
  return sounds.filter(sound => (sound.prompt_index ?? 0) === promptIndex);
}

/**
 * Count total number of unique prompts.
 *
 * @param sounds - Array of sound events
 * @returns Number of unique prompt indices
 */
export function countUniquePrompts(sounds: SoundEvent[]): number {
  return getUniquePromptIndices(sounds).length;
}
