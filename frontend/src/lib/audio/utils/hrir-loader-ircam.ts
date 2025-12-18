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
import { resampleAudioBuffer } from './resample-buffer';

// Type alias for virtual speaker count lookup
type AmbisonicOrderKey = 'FOA' | 'SOA' | 'TOA';
const ORDER_TO_KEY: Record<1 | 2 | 3, AmbisonicOrderKey> = {
  1: 'FOA',
  2: 'SOA',
  3: 'TOA',
};

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
 *
 * Each layout contains positions ordered by importance - first positions are
 * used when fewer speakers are configured. Layouts support up to:
 * - FOA: 8 speakers (cube vertices)
 * - SOA: 12 speakers (icosahedron-like)
 * - TOA: 26 speakers (Lebedev grid)
 */
const VIRTUAL_SPEAKER_LAYOUTS: Record<1 | 2 | 3, VirtualSpeaker[]> = {
  // FOA: Up to 8 speakers (horizontal quad → cube)
  1: [
    // Horizontal quad (minimum 4)
    { azimuth: 0, elevation: 0 },
    { azimuth: 90, elevation: 0 },
    { azimuth: 180, elevation: 0 },
    { azimuth: 270, elevation: 0 },
    // Add top/bottom for cube (8 total)
    { azimuth: 45, elevation: 35.264 },   // Cube vertex
    { azimuth: 135, elevation: 35.264 },
    { azimuth: 225, elevation: 35.264 },
    { azimuth: 315, elevation: 35.264 },
  ],

  // SOA: Up to 12 speakers (cube + zenith → extended)
  2: [
    // Horizontal quad
    { azimuth: 0, elevation: 0 },
    { azimuth: 90, elevation: 0 },
    { azimuth: 180, elevation: 0 },
    { azimuth: 270, elevation: 0 },
    // Upper hemisphere
    { azimuth: 45, elevation: 35 },
    { azimuth: 135, elevation: 35 },
    { azimuth: 225, elevation: 35 },
    { azimuth: 315, elevation: 35 },
    // Zenith
    { azimuth: 0, elevation: 90 },
    // Lower hemisphere (for 12 speakers)
    { azimuth: 45, elevation: -35 },
    { azimuth: 135, elevation: -35 },
    { azimuth: 225, elevation: -35 },
  ],

  // TOA: Up to 26 speakers (Lebedev-like grid)
  3: [
    // Horizontal quad
    { azimuth: 0, elevation: 0 },
    { azimuth: 90, elevation: 0 },
    { azimuth: 180, elevation: 0 },
    { azimuth: 270, elevation: 0 },
    // Upper mid-elevation
    { azimuth: 45, elevation: 35 },
    { azimuth: 135, elevation: 35 },
    { azimuth: 225, elevation: 35 },
    { azimuth: 315, elevation: 35 },
    // Lower mid-elevation
    { azimuth: 45, elevation: -35 },
    { azimuth: 135, elevation: -35 },
    { azimuth: 225, elevation: -35 },
    { azimuth: 315, elevation: -35 },
    // Poles
    { azimuth: 0, elevation: 90 },
    { azimuth: 0, elevation: -90 },
    // High elevation ring
    { azimuth: 0, elevation: 55 },
    { azimuth: 90, elevation: 55 },
    // Extended for Lebedev (up to 26)
    { azimuth: 180, elevation: 55 },
    { azimuth: 270, elevation: 55 },
    { azimuth: 0, elevation: -55 },
    { azimuth: 90, elevation: -55 },
    { azimuth: 180, elevation: -55 },
    { azimuth: 270, elevation: -55 },
    // Additional diagonal positions
    { azimuth: 45, elevation: 0 },
    { azimuth: 135, elevation: 0 },
    { azimuth: 225, elevation: 0 },
    { azimuth: 315, elevation: 0 },
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
 * Automatically resamples HRIR data to match the AudioContext sample rate,
 * which is required for ConvolverNode compatibility.
 *
 * @param audioContext - Web Audio API context
 * @param sofaData - Parsed IRCAM SOFA data
 * @param order - Ambisonic order (1=FOA, 2=SOA, 3=TOA)
 * @returns Promise resolving to AudioBuffer with (order+1)^2 channels (resampled to context rate)
 */
async function generateAmbisonicFilters(
  audioContext: AudioContext,
  hrir: ParsedHRIR,
  order: 1 | 2 | 3
): Promise<AudioBuffer> {
  // Get configured number of virtual speakers from constants
  const orderKey = ORDER_TO_KEY[order];
  const configuredSpeakers = HRTF.VIRTUAL_SPEAKERS[orderKey];
  const availableLayout = VIRTUAL_SPEAKER_LAYOUTS[order];
  const minRequired = Math.pow(order + 1, 2);

  // Validate configuration
  if (configuredSpeakers < minRequired) {
    console.warn(
      `[HRIRloader_ircam] Configured ${configuredSpeakers} speakers for ${orderKey}, ` +
      `but minimum ${minRequired} required. Using ${minRequired}.`
    );
  }

  // Use configured count, but don't exceed available layout positions
  const numSpeakers = Math.min(configuredSpeakers, availableLayout.length);
  const virtualSpeakers = availableLayout.slice(0, numSpeakers);

  // Create multi-channel AudioBuffer: 2 channels per speaker (L/R)
  // Total channels = numSpeakers * 2
  const totalChannels = numSpeakers * 2;

  // Create buffer using OfflineAudioContext at source sample rate
  // (we'll resample it later to match the AudioContext rate)
  const tempContext = new OfflineAudioContext(
    totalChannels,
    hrir.irLength,
    hrir.sampleRate
  );

  const buffer = tempContext.createBuffer(
    totalChannels,
    hrir.irLength,
    hrir.sampleRate
  );

  console.log(`[HRIRloader_ircam] Creating ${totalChannels}-channel decoding buffer (${numSpeakers} virtual speakers) @ ${hrir.sampleRate} Hz`);

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

  console.log(`[HRIRloader_ircam] Generated ambisonic decoding filters: ${totalChannels} channels, ${hrir.irLength} samples @ ${hrir.sampleRate} Hz`);

  // Resample to match the AudioContext sample rate (required for ConvolverNode)
  const resampledBuffer = await resampleAudioBuffer(buffer, audioContext.sampleRate);

  // Only log resampling if it actually occurred
  if (hrir.sampleRate !== audioContext.sampleRate) {
    console.log(`[HRIRloader_ircam] Resampled to ${resampledBuffer.sampleRate} Hz (${resampledBuffer.length} samples)`);
  }

  return resampledBuffer;
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

  // Generate ambisonic decoding filters (includes resampling to context rate)
  const decodingBuffer = await generateAmbisonicFilters(audioContext, hrir, order);

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
