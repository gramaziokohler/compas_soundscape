/**
 * Mode Selection Utilities
 *
 * Determines appropriate audio mode based on current state.
 * Implements the Phase 3 mode selection rules:
 *
 * Rules:
 * 1. If IR imported && IR selected: Use AMBISONIC_IR (handles all channel counts)
 * 2. If IR imported && no IR selected: Use ANECHOIC
 * 3. If no IR imported: Use NO_IR_RESONANCE or ANECHOIC
 *
 * Channel handling (all routed to AMBISONIC_IR):
 * - 1 channel → Mono IR (converted to FOA W-channel)
 * - 2 channels → Stereo IR (converted to FOA)
 * - 4 channels → FOA (First Order Ambisonics)
 * - 9 channels → SOA (Second Order Ambisonics)
 * - 16 channels → TOA (Third Order Ambisonics)
 */

import { AudioMode } from '@/types/audio';
import type { AmbisonicOrder } from '@/types/audio';

/**
 * IR state for mode selection
 */
export interface IRState {
  isImported: boolean;
  isSelected: boolean;
  channelCount?: number;
  buffer?: AudioBuffer | null;
  filename?: string; // Filename for UI display
}

/**
 * User preferences for No-IR modes
 */
export interface NoIRPreferences {
  preferredMode: 'resonance' | 'anechoic';
  stereoIRInterpretation?: 'binaural' | 'speaker'; // Optional preference for Stereo IR mode
}

/**
 * Mode selection result
 */
export interface ModeSelectionResult {
  mode: AudioMode;
  ambisonicOrder?: AmbisonicOrder;
  requiresReceiver: boolean;
  dof: '3DOF' | '6DOF';
  warnings: string[];
}

/**
 * Determine appropriate audio mode based on current state
 *
 * @param irState - Current IR state (imported, selected, channel count)
 * @param preferences - User preferences for No-IR modes
 * @returns Mode selection result with mode, order, and warnings
 */
export function selectAudioMode(
  irState: IRState,
  preferences: NoIRPreferences
): ModeSelectionResult {
  const warnings: string[] = [];

  // Rule 1: IR imported && IR selected → Use IR mode based on channels
  if (irState.isImported && irState.isSelected) {
    if (!irState.channelCount) {
      warnings.push('IR selected but channel count unknown. Defaulting to ANECHOIC.');
      return createAnechoicResult(warnings);
    }

    // All IR types route to AMBISONIC_IR (handles conversion internally)
    switch (irState.channelCount) {
      case 1:
        // Mono IR → converted to FOA (W channel only)
        return {
          mode: AudioMode.AMBISONIC_IR,
          ambisonicOrder: 1,
          requiresReceiver: true,
          dof: '3DOF',
          warnings
        };

      case 2:
        // Stereo IR → converted to FOA (L/R encoded at ±30°)
        return {
          mode: AudioMode.AMBISONIC_IR,
          ambisonicOrder: 1,
          requiresReceiver: true,
          dof: '3DOF',
          warnings
        };

      case 4:
        // FOA (First Order Ambisonics)
        return {
          mode: AudioMode.AMBISONIC_IR,
          ambisonicOrder: 1,
          requiresReceiver: true,
          dof: '3DOF',
          warnings
        };

      case 9:
        // SOA (Second Order Ambisonics)
        return {
          mode: AudioMode.AMBISONIC_IR,
          ambisonicOrder: 2,
          requiresReceiver: true,
          dof: '3DOF',
          warnings
        };

      case 16:
        // TOA (Third Order Ambisonics)
        return {
          mode: AudioMode.AMBISONIC_IR,
          ambisonicOrder: 3,
          requiresReceiver: true,
          dof: '3DOF',
          warnings
        };

      default:
        warnings.push(
          `Unsupported IR channel count: ${irState.channelCount}. ` +
          `Expected 1 (mono), 2 (stereo), 4 (FOA), 9 (SOA), or 16 (TOA). ` +
          `Falling back to ANECHOIC mode.`
        );
        return createAnechoicResult(warnings);
    }
  }

  // Rule 2: IR imported but not selected → ANECHOIC
  if (irState.isImported && !irState.isSelected) {
    return createAnechoicResult(warnings);
  }

  // Rule 3: No IR imported → Use preference
  return selectNoIRMode(preferences, warnings);
}

/**
 * Create anechoic mode result (default ambisonic order: FOA)
 */
function createAnechoicResult(warnings: string[], order: AmbisonicOrder = 1): ModeSelectionResult {
  return {
    mode: AudioMode.ANECHOIC,
    ambisonicOrder: order,
    requiresReceiver: false,
    dof: '6DOF',
    warnings
  };
}

/**
 * Select No-IR mode based on user preference
 */
function selectNoIRMode(preferences: NoIRPreferences, warnings: string[]): ModeSelectionResult {
  switch (preferences.preferredMode) {
    case 'resonance':
      return {
        mode: AudioMode.NO_IR_RESONANCE,
        requiresReceiver: false,
        dof: '6DOF',
        warnings
      };

    case 'anechoic':
    default:
      return createAnechoicResult(warnings);
  }
}

/**
 * Validate channel count for IR modes
 * Supports: Mono (1), Stereo (2), FOA (4), SOA (9), TOA (16)
 * @returns true if supported, false otherwise
 */
export function isSupportedChannelCount(channels: number): boolean {
  return [1, 2, 4, 9, 16].includes(channels);
}

/**
 * Get ambisonic order from channel count
 * @param channels - Number of channels
 * @returns Ambisonic order (1, 2, or 3) or null if not ambisonic
 */
export function getAmbisonicOrderFromChannels(channels: number): AmbisonicOrder | null {
  switch (channels) {
    case 4:
      return 1; // FOA
    case 9:
      return 2; // SOA
    case 16:
      return 3; // TOA
    default:
      return null;
  }
}

/**
 * Get channel count from ambisonic order
 * @param order - Ambisonic order (1, 2, or 3)
 * @returns Number of channels: (order + 1)^2
 */
export function getChannelsFromAmbisonicOrder(order: AmbisonicOrder): number {
  return Math.pow(order + 1, 2);
}

/**
 * Check if browser supports ambisonic order
 * Checks if Web Audio API can create buffers with required channel count
 * @param audioContext - Web Audio context
 * @param order - Ambisonic order to test
 * @returns true if supported, false otherwise
 */
export function isAmbisonicOrderSupported(
  audioContext: AudioContext,
  order: AmbisonicOrder
): boolean {
  const channels = getChannelsFromAmbisonicOrder(order);
  
  try {
    // Try creating a small buffer with the required channel count
    const testBuffer = audioContext.createBuffer(channels, 1, audioContext.sampleRate);
    return testBuffer.numberOfChannels === channels;
  } catch (error) {
    console.warn(`[ModeSelector] Order ${order} (${channels}ch) not supported:`, error);
    return false;
  }
}

/**
 * Get human-readable mode description
 * @param mode - Audio mode
 * @returns Description string
 */
export function getModeDescription(mode: AudioMode): string {
  switch (mode) {
    case AudioMode.NO_IR_RESONANCE:
      return 'ShoeBox Acoustics (6 DOF, synthetic room)';
    case AudioMode.ANECHOIC:
      return 'No Acoustics (6 DOF, ambisonic + HRTF)';
    case AudioMode.AMBISONIC_IR:
      return 'IR Convolution (3 DOF, mono/stereo/ambisonic + HRTF)';
    default:
      return 'Unknown mode';
  }
}
