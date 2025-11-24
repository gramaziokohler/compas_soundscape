/**
 * Mode Selection Utilities
 *
 * Determines appropriate audio mode based on current state.
 * Implements the Phase 3 mode selection rules:
 *
 * Rules:
 * 1. If IR imported && IR selected: Use IR mode (based on channels)
 * 2. If IR imported && no IR selected: Use ANECHOIC
 * 3. If no IR imported: Use NO_IR_RESONANCE or ANECHOIC
 *
 * Channel detection:
 * - 1 channel → MONO_IR
 * - 2 channels → STEREO_IR
 * - 4 channels → AMBISONIC_IR (FOA)
 * - 9 channels → AMBISONIC_IR (SOA)
 * - 16 channels → AMBISONIC_IR (TOA)
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

    switch (irState.channelCount) {
      case 1:
        return {
          mode: AudioMode.MONO_IR,
          ambisonicOrder: 1, // Encoded to FOA after convolution
          requiresReceiver: true,
          dof: '3DOF',
          warnings
        };

      case 2:
        return {
          mode: AudioMode.STEREO_IR,
          ambisonicOrder: 1, // Encoded to FOA (L/R at ±30°)
          requiresReceiver: true,
          dof: '3DOF',
          warnings
        };

      case 4:
        return {
          mode: AudioMode.AMBISONIC_IR,
          ambisonicOrder: 1, // FOA
          requiresReceiver: true,
          dof: '3DOF',
          warnings
        };

      case 9:
        return {
          mode: AudioMode.AMBISONIC_IR,
          ambisonicOrder: 2, // SOA
          requiresReceiver: true,
          dof: '3DOF',
          warnings
        };

      case 16:
        return {
          mode: AudioMode.AMBISONIC_IR,
          ambisonicOrder: 3, // TOA
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
    case AudioMode.MONO_IR:
      return 'Mono IR (3 DOF, convolution + HRTF)';
    case AudioMode.STEREO_IR:
      return 'Stereo IR (3 DOF, L/R convolution + HRTF)';
    case AudioMode.AMBISONIC_IR:
      return 'Ambisonic IR (3 DOF, multichannel convolution + HRTF)';
    default:
      return 'Unknown mode';
  }
}
