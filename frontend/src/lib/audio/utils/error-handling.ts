/**
 * Audio Error Handling
 *
 * Centralized error handling and recovery for audio system.
 * Handles IR load failures, unsupported formats, HRTF failures, etc.
 */

import { AudioMode } from '@/types/audio';
import type { AmbisonicOrder } from '@/types/audio';

/**
 * Audio error types
 */
export enum AudioErrorType {
  IR_LOAD_FAILED = 'ir_load_failed',
  IR_DECODE_FAILED = 'ir_decode_failed',
  UNSUPPORTED_CHANNEL_COUNT = 'unsupported_channel_count',
  HRTF_LOAD_FAILED = 'hrtf_load_failed',
  AMBISONIC_ORDER_UNSUPPORTED = 'ambisonic_order_unsupported',
  MODE_INITIALIZATION_FAILED = 'mode_initialization_failed',
  AUDIO_CONTEXT_FAILED = 'audio_context_failed',
  SOURCE_CREATION_FAILED = 'source_creation_failed',
  DECODER_FAILED = 'decoder_failed'
}

/**
 * Audio error details
 */
export interface AudioError {
  type: AudioErrorType;
  message: string;
  originalError?: Error;
  recoveryAction?: string;
  fallbackMode?: AudioMode;
}

/**
 * Create audio error
 */
export function createAudioError(
  type: AudioErrorType,
  message: string,
  originalError?: Error,
  recoveryAction?: string,
  fallbackMode?: AudioMode
): AudioError {
  return {
    type,
    message,
    originalError,
    recoveryAction,
    fallbackMode
  };
}

/**
 * Handle IR load failure
 */
export function handleIRLoadFailure(error: Error): AudioError {
  // If error already contains detailed message from decoder, use it
  const message = error.message || 'Failed to load impulse response file. Please check the file format and try again.';

  return createAudioError(
    AudioErrorType.IR_LOAD_FAILED,
    message,
    error,
    'Reverting to Anechoic mode',
    AudioMode.ANECHOIC
  );
}

/**
 * Handle IR decode failure
 */
export function handleIRDecodeFailure(error: Error): AudioError {
  return createAudioError(
    AudioErrorType.IR_DECODE_FAILED,
    'Failed to decode impulse response audio data. The file may be corrupted.',
    error,
    'Reverting to Anechoic mode',
    AudioMode.ANECHOIC
  );
}

/**
 * Handle unsupported channel count
 */
export function handleUnsupportedChannelCount(channels: number): AudioError {
  return createAudioError(
    AudioErrorType.UNSUPPORTED_CHANNEL_COUNT,
    `Unsupported channel count: ${channels}. Expected 1 (mono), 2 (stereo), 4 (FOA), 9 (SOA), or 16 (TOA).`,
    undefined,
    'Please provide an IR file with 1, 2, 4, 9, or 16 channels. Falling back to Anechoic mode.',
    AudioMode.ANECHOIC
  );
}

/**
 * Handle HRTF load failure
 */
export function handleHRTFLoadFailure(error: Error): AudioError {
  return createAudioError(
    AudioErrorType.HRTF_LOAD_FAILED,
    'Failed to load HRTF data. Using fallback basic panning.',
    error,
    'Binaural audio will use simplified spatialization',
    undefined // No mode fallback, just degraded quality
  );
}

/**
 * Handle unsupported ambisonic order
 */
export function handleUnsupportedAmbisonicOrder(order: AmbisonicOrder): AudioError {
  const fallbackOrder = order > 1 ? 1 : 1; // Fallback to FOA
  return createAudioError(
    AudioErrorType.AMBISONIC_ORDER_UNSUPPORTED,
    `Browser does not support ambisonic order ${order}. Falling back to order ${fallbackOrder} (FOA).`,
    undefined,
    `Using ${fallbackOrder === 1 ? 'First' : 'Lower'}-order ambisonics`,
    undefined
  );
}

/**
 * Handle mode initialization failure
 */
export function handleModeInitializationFailure(
  mode: AudioMode,
  error: Error
): AudioError {
  return createAudioError(
    AudioErrorType.MODE_INITIALIZATION_FAILED,
    `Failed to initialize ${mode} mode.`,
    error,
    'Reverting to Anechoic mode',
    AudioMode.ANECHOIC
  );
}

/**
 * Handle audio context failure
 */
export function handleAudioContextFailure(error: Error): AudioError {
  return createAudioError(
    AudioErrorType.AUDIO_CONTEXT_FAILED,
    'Failed to create Web Audio context. Your browser may not support spatial audio.',
    error,
    'Please try a different browser or check audio permissions',
    undefined
  );
}

/**
 * Handle source creation failure
 */
export function handleSourceCreationFailure(sourceId: string, error: Error): AudioError {
  return createAudioError(
    AudioErrorType.SOURCE_CREATION_FAILED,
    `Failed to create audio source: ${sourceId}`,
    error,
    'Check audio buffer format and try again',
    undefined
  );
}

/**
 * Handle decoder failure
 */
export function handleDecoderFailure(error: Error): AudioError {
  return createAudioError(
    AudioErrorType.DECODER_FAILED,
    'Binaural decoder initialization failed.',
    error,
    'Using direct stereo output without HRTF',
    undefined
  );
}

/**
 * Format error for user display
 */
export function formatErrorForUser(error: AudioError): string {
  let message = error.message;
  
  if (error.recoveryAction) {
    message += `\n\n${error.recoveryAction}`;
  }
  
  return message;
}

/**
 * Log error with context
 */
export function logAudioError(error: AudioError, context?: string): void {
  const prefix = context ? `[${context}]` : '[AudioError]';
  
  console.error(
    `${prefix} ${error.type}:`,
    error.message,
    error.originalError || ''
  );
  
  if (error.recoveryAction) {
    console.warn(`${prefix} Recovery:`, error.recoveryAction);
  }
  
  if (error.fallbackMode) {
    console.info(`${prefix} Fallback mode:`, error.fallbackMode);
  }
}

/**
 * Error recovery handler
 * Executes recovery action and returns fallback mode if available
 */
export async function recoverFromError(
  error: AudioError,
  onError?: (error: AudioError) => void
): Promise<AudioMode | null> {
  // Log error
  logAudioError(error);
  
  // Notify callback
  if (onError) {
    onError(error);
  }
  
  // Return fallback mode if available
  return error.fallbackMode || null;
}
