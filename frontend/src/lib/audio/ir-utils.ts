import { IMPULSE_RESPONSE, AMBISONIC } from '@/lib/constants';
import type { IRFormat } from '@/types/audio';

/**
 * Impulse Response Utilities
 *
 * Consolidated utilities for impulse response handling:
 * - Format detection (mono/binaural/FOA/TOA)
 * - Sample rate conversion
 * - Channel normalization
 * - Convolver setup
 * - Metadata extraction
 */

/* ========================================
 * IR FORMAT DETECTION
 * ======================================== */

/**
 * Detect IR format from audio buffer channel count
 * @param buffer - AudioBuffer to detect format from
 * @returns IRFormat type
 */
export function detectIRFormat(buffer: AudioBuffer): IRFormat {
  const channels = buffer.numberOfChannels;

  switch (channels) {
    case 1:
      return 'mono';
    case 2:
      return 'binaural';
    case 4:
      return 'foa';
    case 16:
      return 'toa';
    default:
      throw new Error(
        `Unsupported IR channel count: ${channels}. ` +
        `Supported: 1 (mono), 2 (binaural), 4 (FOA), 16 (TOA)`
      );
  }
}

/**
 * Get DOF description for IR format
 * @param format - IR format
 * @returns Human-readable DOF description
 */
export function getDOFDescription(format: IRFormat): string {
  switch (format) {
    case 'mono':
      return '6 DOF for sources, 0 DOF for IR (head-locked)';
    case 'binaural':
    case 'foa':
    case 'toa':
      return '3 DOF rotation (static position at receiver)';
  }
}

/**
 * Get UI notice message for IR format
 * @param format - IR format
 * @param isActive - Whether IR is currently active
 * @returns User-friendly status message
 */
export function getUINotice(format: IRFormat, isActive: boolean): string | null {
  if (!isActive) {
    const formatName = getFormatDisplayName(format);
    return `${formatName} IR loaded but inactive (not in receiver mode)`;
  }

  switch (format) {
    case 'mono':
      return 'Mono IR active: Head-locked mode (no rotation affects IR)';
    case 'binaural':
      return 'Binaural (2ch) IR active: 3DoF rotation enabled (static position)';
    case 'foa':
      return 'FOA (4ch) IR active: 3DoF rotation enabled (static position)';
    case 'toa':
      return 'TOA (16ch) IR active: 3DoF rotation enabled (static position)';
  }
}

/**
 * Get human-readable format display name
 * @param format - IR format
 * @returns Display name
 */
export function getFormatDisplayName(format: IRFormat): string {
  switch (format) {
    case 'mono':
      return 'Mono';
    case 'binaural':
      return 'Binaural (2ch)';
    case 'foa':
      return 'FOA (4ch)';
    case 'toa':
      return 'TOA (16ch)';
  }
}

/* ========================================
 * IR PROCESSING
 * ======================================== */

/**
 * Diagnose ambisonic IR normalization scheme by analyzing channel RMS levels
 * Helps detect if IR is SN3D, N3D, or FuMa format
 */
function diagnoseAmbisonicNormalization(buffer: AudioBuffer, numChannels: number): void {
  // Calculate RMS for each channel
  const rmsLevels: number[] = [];
  for (let ch = 0; ch < numChannels; ch++) {
    const data = buffer.getChannelData(ch);
    let sumSquares = 0;
    for (let i = 0; i < data.length; i++) {
      sumSquares += data[i] * data[i];
    }
    rmsLevels[ch] = Math.sqrt(sumSquares / data.length);
  }

  // Calculate ratios relative to W channel
  const wRMS = rmsLevels[0];
  const ratios = rmsLevels.map(rms => wRMS > 0 ? rms / wRMS : 0);

  console.log('[IR Diagnostics] Channel RMS levels:', rmsLevels.map(r => r.toFixed(6)));
  console.log('[IR Diagnostics] Ratios (relative to W):', ratios.map(r => r.toFixed(3)));

  // Expected ratios for different normalization schemes (FOA)
  const expectedSN3D = 1 / Math.sqrt(3); // 0.577
  const expectedN3D = 1.0; // 1.0
  const expectedFuMa = Math.sqrt(2); // 1.414 (W is scaled by 1/√2)

  if (numChannels === 4) {
    // Average directional channel ratio
    const avgDirectional = (ratios[1] + ratios[2] + ratios[3]) / 3;

    console.log(`[IR Diagnostics] Average X/Y/Z ratio: ${avgDirectional.toFixed(3)}`);
    console.log(`[IR Diagnostics] Expected for SN3D: ${expectedSN3D.toFixed(3)}`);
    console.log(`[IR Diagnostics] Expected for N3D: ${expectedN3D.toFixed(3)}`);
    console.log(`[IR Diagnostics] Expected for FuMa: ${expectedFuMa.toFixed(3)}`);

    // Determine likely format
    const distSN3D = Math.abs(avgDirectional - expectedSN3D);
    const distN3D = Math.abs(avgDirectional - expectedN3D);
    const distFuMa = Math.abs(avgDirectional - expectedFuMa);

    if (distSN3D < 0.15) {
      console.log('[IR Diagnostics] ✅ IR appears to be SN3D format (conversion needed)');
    } else if (distN3D < 0.15) {
      console.log('[IR Diagnostics] ⚠️ IR appears to be N3D format (conversion NOT needed!)');
      console.log('[IR Diagnostics] ⚠️ Disable conversion by setting convertSN3DtoN3D=false');
    } else if (distFuMa < 0.2) {
      console.log('[IR Diagnostics] ⚠️ IR appears to be FuMa format (needs FuMa→N3D conversion)');
    } else {
      console.log('[IR Diagnostics] ⚠️ IR format unclear - directional channels may be very weak');
      console.log('[IR Diagnostics] ⚠️ This IR may have poor spatial content for localization');
    }
  }
}

/**
 * Process impulse response buffer for convolution
 * Handles sample rate conversion, channel matching, and SN3D to N3D normalization
 *
 * @param irBuffer - Original impulse response buffer
 * @param audioContext - Target audio context
 * @param normalize - Whether to normalize the IR
 * @param convertSN3DtoN3D - Whether to convert from SN3D to N3D (default: true for ambisonic IRs)
 * @returns Processed audio buffer ready for convolution
 */
export function processImpulseResponse(
  irBuffer: AudioBuffer,
  audioContext: AudioContext,
  normalize: boolean = true,
  convertSN3DtoN3D: boolean = true
): AudioBuffer {
  const outputChannels = Math.min(irBuffer.numberOfChannels, IMPULSE_RESPONSE.MAX_CHANNELS);
  const targetSampleRate = audioContext.sampleRate;

  // Detect if this is an ambisonic IR (4, 9, or 16 channels)
  const isAmbisonicIR = outputChannels === 4 || outputChannels === 9 || outputChannels === 16;

  // Check if resampling is needed
  const needsResampling = irBuffer.sampleRate !== targetSampleRate;

  // Calculate new buffer length if resampling
  const outputLength = needsResampling
    ? Math.floor(irBuffer.length * (targetSampleRate / irBuffer.sampleRate))
    : irBuffer.length;

  // Create new buffer with context's sample rate
  const processedBuffer = audioContext.createBuffer(
    outputChannels,
    outputLength,
    targetSampleRate
  );

  // Diagnose IR channel balance to detect normalization scheme
  if (isAmbisonicIR) {
    diagnoseAmbisonicNormalization(irBuffer, outputChannels);
  }

  // Get SN3D to N3D conversion factors if needed
  let sn3dToN3dFactors: readonly number[] | null = null;
  if (isAmbisonicIR && convertSN3DtoN3D) {
    if (outputChannels === 4) {
      sn3dToN3dFactors = AMBISONIC.SN3D_TO_N3D.FOA;
    } else if (outputChannels === 9) {
      sn3dToN3dFactors = AMBISONIC.SN3D_TO_N3D.SOA;
    } else if (outputChannels === 16) {
      sn3dToN3dFactors = AMBISONIC.SN3D_TO_N3D.TOA;
    }

    if (sn3dToN3dFactors) {
      console.log('[IR Processing] Applying SN3D to N3D normalization conversion (JSAmbisonics expects N3D)');
      console.log(`[IR Processing] Conversion factors: W=1.0, directional=${sn3dToN3dFactors[1].toFixed(3)}`);
    }
  }

  // Copy and process channels
  for (let channel = 0; channel < outputChannels; channel++) {
    const inputData = irBuffer.getChannelData(channel);
    const outputData = processedBuffer.getChannelData(channel);

    if (needsResampling) {
      // Linear interpolation resampling
      resampleChannel(inputData, outputData, irBuffer.sampleRate, targetSampleRate);
    } else {
      // Direct copy
      outputData.set(inputData);
    }

    // Apply SN3D to N3D conversion BEFORE normalization (to preserve relative channel levels)
    if (sn3dToN3dFactors) {
      const conversionFactor = sn3dToN3dFactors[channel];
      for (let i = 0; i < outputData.length; i++) {
        outputData[i] *= conversionFactor;
      }
    }
  }

  // Apply gain control (different strategies for ambisonic vs non-ambisonic IRs)
  if (normalize) {
    if (isAmbisonicIR && sn3dToN3dFactors) {
      // For ambisonic IRs: Use fixed gain multiplier instead of normalization
      // Normalization can affect localization by altering temporal dynamics
      // Fixed gain preserves channel balance AND temporal characteristics
      const fixedGain = IMPULSE_RESPONSE.AMBISONIC_IR_GAIN_MULTIPLIER;
      for (let channel = 0; channel < outputChannels; channel++) {
        const channelData = processedBuffer.getChannelData(channel);
        for (let i = 0; i < channelData.length; i++) {
          channelData[i] *= fixedGain;
        }
      }
      console.log(`[IR Processing] Applied fixed gain (${fixedGain.toFixed(2)}) - preserves channel balance and temporal dynamics`);
    } else {
      // Per-channel normalization for non-ambisonic IRs
      for (let channel = 0; channel < outputChannels; channel++) {
        normalizeChannel(processedBuffer.getChannelData(channel));
      }
    }
  }

  // Apply fade-in to avoid clicks (first 64 samples) - after all processing
  for (let channel = 0; channel < outputChannels; channel++) {
    applyFadeIn(processedBuffer.getChannelData(channel), IMPULSE_RESPONSE.FADE_IN_SAMPLES);
  }

  return processedBuffer;
}

/**
 * Resample audio channel using linear interpolation
 * 
 * @param inputData - Source audio samples
 * @param outputData - Destination audio samples (pre-allocated)
 * @param inputRate - Source sample rate
 * @param outputRate - Target sample rate
 */
function resampleChannel(
  inputData: Float32Array,
  outputData: Float32Array,
  inputRate: number,
  outputRate: number
): void {
  const ratio = inputRate / outputRate;
  const inputLength = inputData.length;

  for (let i = 0; i < outputData.length; i++) {
    const sourceIndex = i * ratio;
    const index0 = Math.floor(sourceIndex);
    const index1 = Math.min(index0 + 1, inputLength - 1);
    const fraction = sourceIndex - index0;

    // Linear interpolation
    outputData[i] = inputData[index0] * (1 - fraction) + inputData[index1] * fraction;
  }
}

/**
 * Normalize audio channel to prevent clipping
 * Scales values to safe range with headroom for convolution
 */
function normalizeChannel(channelData: Float32Array): void {
  let maxAmplitude = 0;

  // Find peak amplitude
  for (let i = 0; i < channelData.length; i++) {
    const abs = Math.abs(channelData[i]);
    if (abs > maxAmplitude) {
      maxAmplitude = abs;
    }
  }

  // Always normalize and add headroom for convolution
  // This prevents clipping when multiple convolved sources sum together
  if (maxAmplitude > IMPULSE_RESPONSE.MIN_AMPLITUDE_THRESHOLD) {
    const scale = IMPULSE_RESPONSE.NORMALIZATION_SCALE / maxAmplitude;
    for (let i = 0; i < channelData.length; i++) {
      channelData[i] *= scale;
    }
  }
}

/**
 * Normalize audio buffer globally (same scale for all channels)
 * Critical for ambisonic IRs to preserve relative channel levels
 */
function normalizeGlobal(buffer: AudioBuffer): void {
  let maxAmplitude = 0;

  // Find peak amplitude across ALL channels
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < channelData.length; i++) {
      const abs = Math.abs(channelData[i]);
      if (abs > maxAmplitude) {
        maxAmplitude = abs;
      }
    }
  }

  // Apply same scale to all channels
  if (maxAmplitude > IMPULSE_RESPONSE.MIN_AMPLITUDE_THRESHOLD) {
    const scale = IMPULSE_RESPONSE.NORMALIZATION_SCALE / maxAmplitude;
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const channelData = buffer.getChannelData(channel);
      for (let i = 0; i < channelData.length; i++) {
        channelData[i] *= scale;
      }
    }
  }
}

/**
 * Apply fade-in envelope to prevent clicks
 * Uses linear fade over specified number of samples
 */
function applyFadeIn(channelData: Float32Array, fadeSamples: number): void {
  const actualFade = Math.min(fadeSamples, channelData.length);
  for (let i = 0; i < actualFade; i++) {
    const gain = i / actualFade;
    channelData[i] *= gain;
  }
}

/**
 * Get IR info for display
 */
export function getIRInfo(buffer: AudioBuffer | null): {
  duration: string;
  sampleRate: string;
  channels: string;
  samples: string;
} | null {
  if (!buffer) return null;

  return {
    duration: `${buffer.duration.toFixed(3)}s`,
    sampleRate: `${buffer.sampleRate}Hz`,
    channels: buffer.numberOfChannels === 1 ? "Mono" : buffer.numberOfChannels === 2 ? "Stereo" : `${buffer.numberOfChannels} ch`,
    samples: `${buffer.length.toLocaleString()}`
  };
}
