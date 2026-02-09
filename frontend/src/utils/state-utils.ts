/**
 * Sound State Utilities
 * 
 * Utility functions for managing sound states across the application.
 * Extracted to reduce code duplication and centralize sound state logic.
 */

import { SOUND_STATE_DEFAULT } from "@/utils/constants";
import type { SoundState } from "@/types";

/**
 * Get the current state of a sound with fallback to default
 * 
 * @param soundId - Unique identifier for the sound
 * @param states - Record of sound IDs to their states
 * @returns The sound state or 'stopped' if not found
 */
export function getSoundState(
  soundId: string,
  states: Record<string, SoundState>
): SoundState {
  return states[soundId] || SOUND_STATE_DEFAULT;
}

/**
 * Check if any sound is currently playing
 * 
 * @param states - Record of sound IDs to their states
 * @returns True if at least one sound is playing
 */
export function isAnySoundPlaying(
  states: Record<string, SoundState>
): boolean {
  return Object.values(states).some(state => state === 'playing');
}

/**
 * Check if any sound is currently paused
 * 
 * @param states - Record of sound IDs to their states
 * @returns True if at least one sound is paused
 */
export function isAnySoundPaused(
  states: Record<string, SoundState>
): boolean {
  return Object.values(states).some(state => state === 'paused');
}

/**
 * Check if all sounds are stopped
 * 
 * @param states - Record of sound IDs to their states
 * @returns True if all sounds are stopped or undefined
 */
export function areAllSoundsStopped(
  states: Record<string, SoundState>
): boolean {
  return Object.values(states).every(state => state === 'stopped' || state === undefined);
}

/**
 * Get all sound IDs that are currently playing
 * 
 * @param states - Record of sound IDs to their states
 * @returns Array of sound IDs that are playing
 */
export function getPlayingSoundIds(
  states: Record<string, SoundState>
): string[] {
  return Object.entries(states)
    .filter(([_, state]) => state === 'playing')
    .map(([id, _]) => id);
}

/**
 * Get count of sounds in each state
 * 
 * @param states - Record of sound IDs to their states
 * @returns Object with counts for each state
 */
export function getSoundStateCounts(
  states: Record<string, SoundState>
): { playing: number; paused: number; stopped: number } {
  const counts = { playing: 0, paused: 0, stopped: 0 };
  
  Object.values(states).forEach(state => {
    if (state === 'playing') counts.playing++;
    else if (state === 'paused') counts.paused++;
    else if (state === 'stopped') counts.stopped++;
  });
  
  return counts;
}
