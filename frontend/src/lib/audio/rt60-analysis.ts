/**
 * RT60 Analysis Utility - Simple and Robust Approach
 * 
 * Uses a simplified method: Find when energy drops to 1/1000 (-30dB) of peak,
 * then multiply by 2 to estimate RT60. This is extremely reliable and robust
 * to noise floor and early reflections.
 */

import { RT60_ANALYSIS } from '@/lib/constants';

export interface RT60Result {
  rt60Seconds: number;
  isLowQuality: boolean; // True if IR is noisy/short and result might be unreliable
}

/**
 * Calculate RT60 from an AudioBuffer using simple energy decay threshold
 * @param audioBuffer - The impulse response audio buffer
 * @param channelIndex - Channel to analyze (default: 0, first channel)
 * @returns RT60 result with quality flag, or null if calculation fails
 */
export function calculateRT60(
  audioBuffer: AudioBuffer,
  channelIndex: number = 0
): RT60Result | null {
  try {
    const channelData = audioBuffer.getChannelData(channelIndex);
    const sampleRate = audioBuffer.sampleRate;
    
    // Step 1: Find peak energy (not peak amplitude, but peak ENERGY)
    let peakEnergy = 0;
    let peakIndex = 0;
    
    for (let i = 0; i < channelData.length; i++) {
      const energy = channelData[i] * channelData[i];
      if (energy > peakEnergy) {
        peakEnergy = energy;
        peakIndex = i;
      }
    }
    
    if (peakEnergy < RT60_ANALYSIS.MIN_PEAK_THRESHOLD * RT60_ANALYSIS.MIN_PEAK_THRESHOLD) {
      console.warn('RT60: Peak energy too low');
      return null;
    }
    
    // Step 2: Calculate RMS in sliding windows to smooth the decay curve
    const windowSize = Math.floor(sampleRate * 0.01); // 10ms windows
    const rmsValues: number[] = [];
    
    for (let i = peakIndex; i < channelData.length - windowSize; i += windowSize) {
      let sumSquares = 0;
      for (let j = 0; j < windowSize; j++) {
        sumSquares += channelData[i + j] * channelData[i + j];
      }
      const rms = Math.sqrt(sumSquares / windowSize);
      rmsValues.push(rms);
    }
    
    if (rmsValues.length < 10) {
      console.warn('RT60: IR too short for analysis');
      return null;
    }
    
    // Step 3: Find peak RMS (should be near the beginning)
    const peakRMS = Math.max(...rmsValues);
    
    // Step 4: Find where RMS drops to specific thresholds
    // -20dB = 0.1 of peak (energy ratio = 0.01, amplitude ratio = 0.1)
    // -30dB = 0.0316 of peak
    const threshold20dB = peakRMS * 0.1;
    const threshold30dB = peakRMS * 0.0316;
    
    let index20dB = -1;
    let index30dB = -1;
    
    for (let i = 0; i < rmsValues.length; i++) {
      if (index20dB === -1 && rmsValues[i] < threshold20dB) {
        index20dB = i;
      }
      if (index30dB === -1 && rmsValues[i] < threshold30dB) {
        index30dB = i;
        break; // Found both, can stop
      }
    }
    
    // Convert indices to time
    const windowDuration = windowSize / sampleRate;
    const time20dB = index20dB >= 0 ? index20dB * windowDuration : null;
    const time30dB = index30dB >= 0 ? index30dB * windowDuration : null;
    
    console.log('[RT60 Debug] Simple decay analysis:', {
      peakRMS: peakRMS.toFixed(6),
      threshold20dB: threshold20dB.toFixed(6),
      threshold30dB: threshold30dB.toFixed(6),
      time20dB: time20dB?.toFixed(3),
      time30dB: time30dB?.toFixed(3),
      windowSize,
      windowDuration: windowDuration.toFixed(4)
    });
    
    // Step 5: Estimate RT60
    let rt60Seconds: number | null = null;
    let method = '';
    let isLowQuality = false;
    
    // Prefer T30 (more reliable): Time to drop 30dB, multiply by 2
    if (time30dB !== null) {
      rt60Seconds = time30dB * 2;
      method = 'T30 (simple threshold)';
      // Mark as low quality if IR is very short or peak is weak
      isLowQuality = time30dB < 0.2 || peakRMS < 0.01;
    }
    // Fallback to T20: Time to drop 20dB, multiply by 3
    else if (time20dB !== null) {
      rt60Seconds = time20dB * 3;
      method = 'T20 (simple threshold)';
      // T20 fallback indicates lower quality
      isLowQuality = true;
    }
    
    console.log('[RT60] Final result:', {
      rt60Seconds: rt60Seconds?.toFixed(3),
      method,
      isLowQuality
    });
    
    // Sanity check
    if (rt60Seconds === null || rt60Seconds <= 0 || rt60Seconds > 20) {
      console.warn('RT60: Invalid result', rt60Seconds);
      return null;
    }
    
    return { rt60Seconds, isLowQuality };
  } catch (error) {
    console.error('RT60 calculation error:', error);
    return null;
  }
}

/**
 * Format RT60 for display
 * @param result - RT60 result object
 * @returns Formatted string (e.g., "1.23s") or "N/A"
 */
export function formatRT60(result: RT60Result | null): string {
  if (result === null || result === undefined) {
    return 'N/A';
  }
  return `${result.rt60Seconds.toFixed(RT60_ANALYSIS.DECIMAL_PLACES)}s`;
}

/**
 * Get RT60 category description
 * @param result - RT60 result object
 * @returns Human-readable description
 */
export function getRT60Description(result: RT60Result | null): string {
  if (result === null || result === undefined) {
    return 'Unknown';
  }
  
  if (result.rt60Seconds < RT60_ANALYSIS.CATEGORY_DEAD_MAX) {
    return 'Dead/Dry';
  } else if (result.rt60Seconds < RT60_ANALYSIS.CATEGORY_MODERATE_MAX) {
    return 'Moderate';
  } else if (result.rt60Seconds < RT60_ANALYSIS.CATEGORY_REVERBERANT_MAX) {
    return 'Reverberant';
  } else {
    return 'Very Reverberant';
  }
}
