/**
 * HRIR Loader for IRCAM SOFA Files
 *
 * Processes IRCAM-formatted SOFA JSON files to generate ambisonic decoding filters.
 * Based on JSAmbisonics HRIRloader_ircam implementation.
 *
 * Workflow:
 * 1. Load IRCAM SOFA JSON file
 * 2. Select virtual speaker positions based on ambisonic order
 * 3. Find nearest measured HRTFs to virtual speaker positions
 * 4. Extract and arrange HRTFs into multi-channel AudioBuffer
 * 5. Output: (order+1)^2 channels of binaural filters
 *
 * Virtual Speaker Layouts:
 * - FOA (order 1): 4 speakers in tetrahedral arrangement
 * - SOA (order 2): 9 speakers (cube + center)
 * - TOA (order 3): 16 speakers (dodecahedron vertices)
 *
 * Reference: https://github.com/polarch/JSAmbisonics/blob/master/src/hrir-loader_ircam.js
 */

import { HRTF } from '@/lib/constants';

/**
 * IRCAM SOFA JSON structure
 */
interface IRCAMSOFAData {
  name: string;
  attributes?: Array<{
    name: string;
    attributes?: any[];
  }>;
  leaves: Array<{
    name: string;
    type: string;
    attributes?: Array<{
      name: string;
      value: any;
    }>;
    shape: number[];
    data: any;
  }>;
}

/**
 * Spherical coordinate (from SOFA SourcePosition)
 */
interface SphericalCoord {
  azimuth: number;   // degrees
  elevation: number; // degrees
  distance: number;  // meters
}

/**
 * Virtual speaker position for ambisonic decoding
 */
interface VirtualSpeaker {
  azimuth: number;   // degrees
  elevation: number; // degrees
}

/**
 * Parsed HRIR data from IRCAM SOFA
 */
interface ParsedHRIR {
  sampleRate: number;
  irLength: number;
  sourcePositions: SphericalCoord[];
  leftIRs: Float32Array[];   // One IR per source position
  rightIRs: Float32Array[];  // One IR per source position
}

/**
 * Virtual speaker layouts for different ambisonic orders
 * Based on optimal t-designs for spherical sampling
 */
const VIRTUAL_SPEAKER_LAYOUTS: Record<1 | 2 | 3, VirtualSpeaker[]> = {
  // FOA: Tetrahedral arrangement (4 speakers)
  1: [
    { azimuth: 0, elevation: 0 },
    { azimuth: 90, elevation: 0 },
    { azimuth: 180, elevation: 0 },
    { azimuth: 270, elevation: 0 },
  ],

  // SOA: Cube + center (9 speakers)
  2: [
    { azimuth: 0, elevation: 0 },
    { azimuth: 90, elevation: 0 },
    { azimuth: 180, elevation: 0 },
    { azimuth: 270, elevation: 0 },
    { azimuth: 45, elevation: 35 },
    { azimuth: 135, elevation: 35 },
    { azimuth: 225, elevation: 35 },
    { azimuth: 315, elevation: 35 },
    { azimuth: 0, elevation: 90 },
  ],

  // TOA: Dodecahedron vertices (16 speakers)
  3: [
    { azimuth: 0, elevation: 0 },
    { azimuth: 90, elevation: 0 },
    { azimuth: 180, elevation: 0 },
    { azimuth: 270, elevation: 0 },
    { azimuth: 45, elevation: 35 },
    { azimuth: 135, elevation: 35 },
    { azimuth: 225, elevation: 35 },
    { azimuth: 315, elevation: 35 },
    { azimuth: 45, elevation: -35 },
    { azimuth: 135, elevation: -35 },
    { azimuth: 225, elevation: -35 },
    { azimuth: 315, elevation: -35 },
    { azimuth: 0, elevation: 90 },
    { azimuth: 90, elevation: 45 },
    { azimuth: 180, elevation: 45 },
    { azimuth: 270, elevation: 45 },
  ],
};

/**
 * Load IRCAM SOFA JSON file
 */
export async function loadIRCAMSOFA(path: string): Promise<IRCAMSOFAData> {
  console.log(`[HRIRloader_ircam] Loading IRCAM SOFA from: ${path}`);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), HRTF.FETCH_TIMEOUT_MS);

    const response = await fetch(path, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const jsonData: IRCAMSOFAData = await response.json();
    console.log(`[HRIRloader_ircam] Loaded IRCAM SOFA file: ${jsonData.name}`);

    return jsonData;
  } catch (error) {
    console.error('[HRIRloader_ircam] Failed to load IRCAM SOFA:', error);
    throw new Error(`Failed to load IRCAM SOFA from ${path}: ${error}`);
  }
}

/**
 * Parse IRCAM SOFA data structure
 */
function parseIRCAMSOFA(sofaData: IRCAMSOFAData): ParsedHRIR {
  const leaves = sofaData.leaves;

  // Find sample rate
  const sampleRateLeaf = leaves.find(leaf => leaf.name === 'Data.SamplingRate');
  if (!sampleRateLeaf || !sampleRateLeaf.data) {
    throw new Error('Data.SamplingRate not found in IRCAM SOFA');
  }
  const sampleRate = sampleRateLeaf.data[0] as number;

  // Find IR data
  const irLeaf = leaves.find(leaf => leaf.name === 'Data.IR');
  if (!irLeaf || !irLeaf.data) {
    throw new Error('Data.IR not found in IRCAM SOFA');
  }

  // Find source positions
  const sourcePositionLeaf = leaves.find(leaf => leaf.name === 'SourcePosition');
  if (!sourcePositionLeaf || !sourcePositionLeaf.data) {
    throw new Error('SourcePosition not found in IRCAM SOFA');
  }

  // Parse source positions (spherical coordinates)
  const sourcePositions: SphericalCoord[] = sourcePositionLeaf.data.map((pos: number[]) => ({
    azimuth: pos[0],
    elevation: pos[1],
    distance: pos[2],
  }));

  // Extract IR data: shape is [numPositions, 2 channels (L/R), irLength]
  const irData = irLeaf.data as number[][][];
  const [numPositions, numChannels, irLength] = irLeaf.shape;

  if (numChannels !== 2) {
    throw new Error(`Expected 2 channels (stereo), got ${numChannels}`);
  }

  // Separate left and right IRs
  const leftIRs: Float32Array[] = [];
  const rightIRs: Float32Array[] = [];

  for (let i = 0; i < numPositions; i++) {
    const leftIR = new Float32Array(irLength);
    const rightIR = new Float32Array(irLength);

    for (let sample = 0; sample < irLength; sample++) {
      leftIR[sample] = irData[i][0][sample];
      rightIR[sample] = irData[i][1][sample];
    }

    leftIRs.push(leftIR);
    rightIRs.push(rightIR);
  }

  console.log(`[HRIRloader_ircam] Parsed ${numPositions} positions, ${irLength} samples @ ${sampleRate} Hz`);

  return {
    sampleRate,
    irLength,
    sourcePositions,
    leftIRs,
    rightIRs,
  };
}

/**
 * Calculate angular distance between two spherical coordinates
 * Uses great circle distance formula
 */
function angularDistance(pos1: SphericalCoord | VirtualSpeaker, pos2: SphericalCoord | VirtualSpeaker): number {
  const az1 = pos1.azimuth * Math.PI / 180;
  const el1 = pos1.elevation * Math.PI / 180;
  const az2 = pos2.azimuth * Math.PI / 180;
  const el2 = pos2.elevation * Math.PI / 180;

  // Convert to Cartesian
  const x1 = Math.cos(el1) * Math.cos(az1);
  const y1 = Math.cos(el1) * Math.sin(az1);
  const z1 = Math.sin(el1);

  const x2 = Math.cos(el2) * Math.cos(az2);
  const y2 = Math.cos(el2) * Math.sin(az2);
  const z2 = Math.sin(el2);

  // Dot product gives cosine of angle
  const dotProduct = x1 * x2 + y1 * y2 + z1 * z2;
  const angle = Math.acos(Math.max(-1, Math.min(1, dotProduct))); // Clamp to [-1, 1]

  return angle * 180 / Math.PI; // Return in degrees
}

/**
 * Find nearest measured HRTF position to a virtual speaker
 */
function findNearestHRTF(
  virtualSpeaker: VirtualSpeaker,
  sourcePositions: SphericalCoord[]
): number {
  let minDistance = Infinity;
  let nearestIndex = 0;

  for (let i = 0; i < sourcePositions.length; i++) {
    const distance = angularDistance(virtualSpeaker, sourcePositions[i]);
    if (distance < minDistance) {
      minDistance = distance;
      nearestIndex = i;
    }
  }

  console.log(
    `[HRIRloader_ircam] Virtual speaker (${virtualSpeaker.azimuth}°, ${virtualSpeaker.elevation}°) → ` +
    `Nearest HRTF (${sourcePositions[nearestIndex].azimuth.toFixed(1)}°, ${sourcePositions[nearestIndex].elevation.toFixed(1)}°) ` +
    `[distance: ${minDistance.toFixed(1)}°]`
  );

  return nearestIndex;
}

/**
 * Generate ambisonic decoding filters from IRCAM SOFA
 *
 * Creates a multi-channel AudioBuffer with (order+1)^2 channels.
 * Each virtual speaker contributes 2 channels (left and right HRTFs).
 * The channel layout is: [L0, R0, L1, R1, L2, R2, ...]
 *
 * @param audioContext - Web Audio API context
 * @param sofaData - Parsed IRCAM SOFA data
 * @param order - Ambisonic order (1=FOA, 2=SOA, 3=TOA)
 * @returns AudioBuffer with (order+1)^2 channels
 */
function generateAmbisonicFilters(
  audioContext: AudioContext,
  hrir: ParsedHRIR,
  order: 1 | 2 | 3
): AudioBuffer {
  const virtualSpeakers = VIRTUAL_SPEAKER_LAYOUTS[order];
  const numSpeakers = virtualSpeakers.length;
  const expectedChannels = Math.pow(order + 1, 2);

  if (numSpeakers !== expectedChannels) {
    throw new Error(
      `Virtual speaker layout mismatch: expected ${expectedChannels} speakers for order ${order}, got ${numSpeakers}`
    );
  }

  // Create multi-channel AudioBuffer: 2 channels per speaker (L/R)
  // Total channels = numSpeakers * 2
  const totalChannels = numSpeakers * 2;
  const buffer = audioContext.createBuffer(
    totalChannels,
    hrir.irLength,
    hrir.sampleRate
  );

  console.log(`[HRIRloader_ircam] Creating ${totalChannels}-channel decoding buffer (${numSpeakers} virtual speakers)`);

  // For each virtual speaker, find nearest HRTF and copy L/R channels
  for (let i = 0; i < numSpeakers; i++) {
    const nearestIndex = findNearestHRTF(virtualSpeakers[i], hrir.sourcePositions);

    // Copy left channel (even channel index)
    const leftChannel = buffer.getChannelData(i * 2);
    leftChannel.set(hrir.leftIRs[nearestIndex]);

    // Copy right channel (odd channel index)
    const rightChannel = buffer.getChannelData(i * 2 + 1);
    rightChannel.set(hrir.rightIRs[nearestIndex]);
  }

  console.log(`[HRIRloader_ircam] Generated ambisonic decoding filters: ${totalChannels} channels, ${hrir.irLength} samples`);

  return buffer;
}

/**
 * Load IRCAM SOFA and generate ambisonic decoding filters
 *
 * Main entry point - loads IRCAM SOFA JSON and generates the multi-channel
 * AudioBuffer required by JSAmbisonics binDecoder.
 *
 * @param audioContext - Web Audio API context
 * @param path - Path to IRCAM SOFA JSON file
 * @param order - Ambisonic order (1=FOA, 2=SOA, 3=TOA)
 * @returns AudioBuffer with (order+1)^2 * 2 channels (L/R pairs for each virtual speaker)
 */
export async function loadIRCAMHRIR(
  audioContext: AudioContext,
  path: string,
  order: 1 | 2 | 3
): Promise<AudioBuffer> {
  console.log(`[HRIRloader_ircam] Loading IRCAM HRIRs for order ${order}`);

  // Load SOFA JSON
  const sofaData = await loadIRCAMSOFA(path);

  // Parse HRIR data
  const hrir = parseIRCAMSOFA(sofaData);

  // Generate ambisonic decoding filters
  const decodingBuffer = generateAmbisonicFilters(audioContext, hrir, order);

  console.log(`[HRIRloader_ircam] Successfully loaded IRCAM HRIRs`);

  return decodingBuffer;
}

/**
 * Load IRCAM HRIR with retry logic
 *
 * Convenience function with automatic retry on failure.
 *
 * @param audioContext - Web Audio API context
 * @param path - Path to IRCAM SOFA JSON file
 * @param order - Ambisonic order (1=FOA, 2=SOA, 3=TOA)
 * @param maxRetries - Maximum retry attempts
 * @returns AudioBuffer with ambisonic decoding filters
 */
export async function loadIRCAMHRIRWithRetry(
  audioContext: AudioContext,
  path: string,
  order: 1 | 2 | 3,
  maxRetries: number = HRTF.RETRY_ATTEMPTS
): Promise<AudioBuffer> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const buffer = await loadIRCAMHRIR(audioContext, path, order);
      if (attempt > 0) {
        console.log(`[HRIRloader_ircam] Successfully loaded on attempt ${attempt + 1}`);
      }
      return buffer;
    } catch (error) {
      lastError = error as Error;
      console.warn(`[HRIRloader_ircam] Attempt ${attempt + 1} failed:`, error);

      // Wait before retry (exponential backoff)
      if (attempt < maxRetries - 1) {
        const delayMs = Math.pow(2, attempt) * 1000;
        console.log(`[HRIRloader_ircam] Retrying in ${delayMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  throw new Error(
    `Failed to load IRCAM HRIR after ${maxRetries} attempts: ${lastError?.message}`
  );
}
