/**
 * HRTF Loader Utility
 *
 * Loads and processes HRTF data for JSAmbisonics binaural decoder.
 * Supports JSON format exported from SOFA files.
 *
 * ⚠️ IMPORTANT LIMITATION:
 * This utility currently loads raw SOFA HRTF data (binaural IRs), but JSAmbisonics
 * requires pre-processed ambisonic decoding filters with specific channel layouts.
 *
 * Current implementation:
 * - Parses SOFA JSON files successfully
 * - Extracts binaural HRTFs (2-channel stereo IRs per position)
 * - Creates AudioBuffer from parsed data
 *
 * What's missing:
 * - Virtual speaker selection algorithm
 * - Ambisonic decoding matrix computation
 * - HRTF interpolation for selected speakers
 * - Proper channel count: (order+1)^2 instead of 2
 *
 * For proper HRTF decoding, use JSAmbisonics built-in utilities:
 * - HRIRloader_local: Processes SOFA files with Python
 * - HRIRloader_ircam: Loads pre-processed IRCAM SOFA files
 * See: https://github.com/polarch/JSAmbisonics#integration-with-sofa-hrtfs
 *
 * Current status: Infrastructure only - auto-loading disabled in BinauralDecoder
 */

import { HRTF } from '@/lib/constants';
import { createResampledAudioBuffer } from './resample-buffer';

/**
 * SOFA JSON structure (simplified)
 */
interface SOFAData {
  name: string;
  leaves: Array<{
    name: string;
    type: string;
    shape: number[];
    data: any;
    attributes?: Array<{
      name: string;
      value: any;
    }>;
  }>;
}

/**
 * Parsed HRTF dataset
 */
interface ParsedHRTF {
  sampleRate: number;
  irData: number[][][]; // [position][channel][sample]
  sourcePositions: number[][]; // [position][azimuth, elevation, distance]
  numPositions: number;
  numChannels: number;
  irLength: number;
}

/**
 * Load HRTF from JSON file
 *
 * @param path - Path to HRTF JSON file (relative to public directory)
 * @returns Parsed HRTF dataset
 */
export async function loadHRTFJSON(path: string = HRTF.DEFAULT_HRTF_PATH): Promise<ParsedHRTF> {
  console.log(`[HRTF Loader] Loading HRTF from: ${path}`);

  try {
    // Fetch with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), HRTF.FETCH_TIMEOUT_MS);

    const response = await fetch(path, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const jsonData: SOFAData = await response.json();
    console.log(`[HRTF Loader] Loaded SOFA file: ${jsonData.name}`);

    // Extract HRTF data from SOFA structure
    const parsed = parseSOFAData(jsonData);

    console.log(`[HRTF Loader] Parsed HRTF: ${parsed.numPositions} positions, ` +
                `${parsed.numChannels} channels, ${parsed.irLength} samples @ ${parsed.sampleRate} Hz`);

    return parsed;
  } catch (error) {
    console.error('[HRTF Loader] Failed to load HRTF:', error);
    throw new Error(`Failed to load HRTF from ${path}: ${error}`);
  }
}

/**
 * Parse SOFA JSON data structure
 *
 * Extracts sample rate, IR data, and source positions from SOFA leaves
 */
function parseSOFAData(sofaData: SOFAData): ParsedHRTF {
  const leaves = sofaData.leaves;

  // Find IR data
  const irLeaf = leaves.find(leaf => leaf.name === 'Data.IR');
  if (!irLeaf || !irLeaf.data) {
    throw new Error('Data.IR not found in SOFA file');
  }

  // Find sample rate
  const sampleRateLeaf = leaves.find(leaf => leaf.name === 'Data.SamplingRate');
  if (!sampleRateLeaf || !sampleRateLeaf.data) {
    throw new Error('Data.SamplingRate not found in SOFA file');
  }

  // Find source positions
  const sourcePositionLeaf = leaves.find(leaf => leaf.name === 'SourcePosition');
  if (!sourcePositionLeaf || !sourcePositionLeaf.data) {
    throw new Error('SourcePosition not found in SOFA file');
  }

  // Extract values
  const irData = irLeaf.data as number[][][]; // [position][channel][sample]
  const sampleRate = sampleRateLeaf.data[0] as number;
  const sourcePositions = sourcePositionLeaf.data as number[][];

  // Validate shape
  const [numPositions, numChannels, irLength] = irLeaf.shape;

  if (irData.length !== numPositions) {
    throw new Error(`IR data length mismatch: expected ${numPositions}, got ${irData.length}`);
  }

  if (numChannels !== 2) {
    console.warn(`[HRTF Loader] Expected 2 channels (stereo), got ${numChannels}`);
  }

  return {
    sampleRate,
    irData,
    sourcePositions,
    numPositions,
    numChannels,
    irLength,
  };
}

/**
 * Convert parsed HRTF data to AudioBuffer
 *
 * Creates a multi-channel AudioBuffer suitable for JSAmbisonics.
 * The exact format depends on the ambisonic order and virtual speaker layout.
 *
 * For now, this creates a simple stereo buffer with the first position's IRs.
 * A more sophisticated implementation would:
 * - Select optimal virtual speaker positions based on ambisonic order
 * - Interleave multiple HRTF positions for different ambisonic channels
 *
 * Automatically resamples HRTF data to match the AudioContext sample rate,
 * which is required for ConvolverNode compatibility.
 *
 * @param audioContext - Web Audio API context
 * @param hrtfData - Parsed HRTF dataset
 * @returns Promise resolving to AudioBuffer containing HRTF data (resampled to context rate)
 */
export async function createHRTFAudioBuffer(
  audioContext: AudioContext,
  hrtfData: ParsedHRTF
): Promise<AudioBuffer> {
  const { sampleRate, irData, numChannels, irLength } = hrtfData;

  // For now, use the first position (front-facing, 0° azimuth, 0° elevation)
  // TODO: Implement proper virtual speaker selection for ambisonic decoding
  const firstPositionIR = irData[0];

  if (!firstPositionIR || firstPositionIR.length !== numChannels) {
    throw new Error('Invalid IR data for first position');
  }

  // Create Float32Arrays for each channel
  const channelData: Float32Array[] = [];
  for (let channel = 0; channel < numChannels; channel++) {
    const irChannelData = firstPositionIR[channel];
    const float32Data = new Float32Array(irLength);

    for (let sample = 0; sample < irLength; sample++) {
      float32Data[sample] = irChannelData[sample];
    }
    channelData.push(float32Data);
  }

  console.log(`[HRTF Loader] Creating AudioBuffer: ${numChannels} channels, ${irLength} samples @ ${sampleRate} Hz`);

  // Use resampling utility to create buffer at correct sample rate
  const buffer = await createResampledAudioBuffer(audioContext, channelData, sampleRate);

  // Only mention resampling if it actually occurred
  if (sampleRate !== audioContext.sampleRate) {
    console.log(`[HRTF Loader] Resampled to ${buffer.sampleRate} Hz (${buffer.length} samples)`);
  } else {
    console.log(`[HRTF Loader] Created AudioBuffer: ${buffer.numberOfChannels} channels, ${buffer.length} samples @ ${buffer.sampleRate} Hz`);
  }

  return buffer;
}

/**
 * Load HRTF and convert to AudioBuffer in one step
 *
 * Convenience function that loads HRTF JSON and creates an AudioBuffer.
 *
 * @param audioContext - Web Audio API context
 * @param path - Path to HRTF JSON file (defaults to HRTF.DEFAULT_HRTF_PATH)
 * @returns AudioBuffer containing HRTF data
 */
export async function loadHRTFAudioBuffer(
  audioContext: AudioContext,
  path: string = HRTF.DEFAULT_HRTF_PATH
): Promise<AudioBuffer> {
  const hrtfData = await loadHRTFJSON(path);
  return await createHRTFAudioBuffer(audioContext, hrtfData);
}

/**
 * Load HRTF with retry logic
 *
 * Attempts to load HRTF with exponential backoff retry on failure.
 *
 * @param audioContext - Web Audio API context
 * @param path - Path to HRTF JSON file
 * @param maxRetries - Maximum number of retry attempts (defaults to HRTF.RETRY_ATTEMPTS)
 * @returns AudioBuffer containing HRTF data
 */
export async function loadHRTFWithRetry(
  audioContext: AudioContext,
  path: string = HRTF.DEFAULT_HRTF_PATH,
  maxRetries: number = HRTF.RETRY_ATTEMPTS
): Promise<AudioBuffer> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const buffer = await loadHRTFAudioBuffer(audioContext, path);
      if (attempt > 0) {
        console.log(`[HRTF Loader] Successfully loaded HRTF on attempt ${attempt + 1}`);
      }
      return buffer;
    } catch (error) {
      lastError = error as Error;
      console.warn(`[HRTF Loader] Attempt ${attempt + 1} failed:`, error);

      // Wait before retry (exponential backoff: 1s, 2s, 4s, ...)
      if (attempt < maxRetries - 1) {
        const delayMs = Math.pow(2, attempt) * 1000;
        console.log(`[HRTF Loader] Retrying in ${delayMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  throw new Error(
    `Failed to load HRTF after ${maxRetries} attempts: ${lastError?.message}`
  );
}
