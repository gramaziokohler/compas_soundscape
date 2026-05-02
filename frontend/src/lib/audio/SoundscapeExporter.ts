/**
 * SoundscapeExporter
 *
 * Exports the full soundscape (with spatial audio) as a stereo WAV file.
 * Uses OfflineAudioContext for faster-than-real-time rendering.
 *
 * Supported modes:
 * - Anechoic:     JSAmbisonics monoEncoder → binaural decoder (HRTF)
 * - AmbisonicIR:  JSAmbisonics convolver (IR) → binaural decoder (HRTF)
 * - Other:        Simple stereo dry mix (no spatial processing)
 *
 * The rendered audio matches "Play All" output including IR convolutions,
 * binaural decoding, limiter, listener orientation, and mute/solo state.
 */

import type { TimelineSound, Position, Position3D, Orientation, AmbisonicOrder } from '@/types/audio';
import { AudioMode } from '@/types/audio';
import { cartesianToSpherical } from './utils/ambisonic-utils';
import { BinauralDecoder } from './decoders/BinauralDecoder';
import { AUDIO_CONTROL } from '@/utils/constants';

/**
 * When true AND in AmbisonicIR mode with multi-channel IR (>2 channels),
 * export the raw ambisonic convolution output (e.g. 4-ch FOA, 9-ch SOA)
 * WITHOUT binaural decoding. The result is a multi-channel WAV file.
 * Set to false to get a binaural stereo render instead.
 */
const EXPORT_RAW_AMBISONIC = true;

// Lazy-load ambisonics (already cached in the browser session)
let ambisonics: any = null;
async function loadAmbisonics(): Promise<any> {
  if (!ambisonics && typeof window !== 'undefined') {
    ambisonics = await import('ambisonics');
  }
  return ambisonics;
}

// ============================================================================
// Public Types
// ============================================================================

export interface SoundscapeExportConfig {
  mode: AudioMode;
  ambisonicOrder: AmbisonicOrder;
  sampleRate: number;

  /** Decoded audio buffers keyed by soundId, with 3D positions */
  sourceRegistry: Map<string, { buffer: AudioBuffer; position: Position }>;

  /** Listener pose at the time of export (snapshot) */
  listenerPosition: Position;
  listenerOrientation: Orientation;

  /**
   * Optional global listener forward direction from UI advanced settings.
   * Used for raw ambisonic export (4/9/16ch) to apply the same orientation
   * that is used when entering first-person mode.
   */
  globalListenerOrientation?: Position3D;

  /** Processed global IR buffer (AmbisonicIR mode with manual IR) */
  irBuffer?: AudioBuffer | null;

  /** Per-source processed IR buffers (simulation / pyroomacoustics mode) */
  perSourceIRBuffers?: Map<string, AudioBuffer>;

  /**
   * Original channel count of the IR before any mono/stereo→FOA conversion.
   * Used to decide whether to export raw ambisonic channels or binaural stereo.
   */
  originalIRChannelCount?: number;

  /** Active simulation card display name (included in exported filename when set) */
  simulationName?: string | null;

  /** Linear gain per sound (0–10). Defaults to 1.0 if not present. */
  soundGains: Map<string, number>;

  /** Muted sound IDs */
  mutedSounds: Set<string>;

  /** ID of the soloed sound (null = no solo) */
  soloedSound?: string | null;
}

export type ExportProgressCallback = (fraction: number) => void;

// ============================================================================
// Main Export Entry Point
// ============================================================================

/**
 * Render the soundscape offline and download it as a stereo WAV file.
 *
 * @param sounds  Timeline sounds with scheduled timestamps
 * @param durationMs  Total timeline duration in milliseconds
 * @param config  Audio configuration from AudioOrchestrator + mix state
 * @param onProgress  Optional progress callback (0 → 1)
 */
export async function exportSoundscapeToWav(
  sounds: TimelineSound[],
  durationMs: number,
  config: SoundscapeExportConfig,
  onProgress?: ExportProgressCallback
): Promise<void> {
  onProgress?.(0.02);

  // Determine which sounds are audible (mute / solo filter)
  const activeSounds = sounds.filter((s) => {
    if (config.soloedSound) return s.id === config.soloedSound;
    return !config.mutedSounds.has(s.id);
  });

  if (activeSounds.length === 0) {
    throw new Error('No active sounds to export');
  }

  // Pre-load the ambisonics library (shared module, already in memory)
  await loadAmbisonics();
  onProgress?.(0.05);

  const durationSecsVal = durationMs / 1000;
  const { sampleRate, mode, ambisonicOrder } = config;
  const totalSamples = Math.ceil(durationSecsVal * sampleRate);
  const numAmbiChannels = (ambisonicOrder + 1) ** 2; // 4 for FOA, 9 for SOA, 16 for TOA

  // Determine if we export raw ambisonic channels (bypass binaural decoder).
  //
  // `originalIRChannelCount` is the channel count *before* AmbisonicIRMode's
  // internal mono/stereo→FOA conversion, so it correctly distinguishes:
  //   - Genuine FOA/SOA/TOA IRs (4/9/16 ch) → useRawAmbisonic = true
  //   - Mono or stereo IRs upconverted to FOA → useRawAmbisonic = false
  // In simulation mode irBuffer is null; originalIRChannelCount covers that case.
  const effectiveIRChannels = config.originalIRChannelCount ?? config.irBuffer?.numberOfChannels ?? 0;
  const useRawAmbisonic =
    EXPORT_RAW_AMBISONIC &&
    mode === AudioMode.AMBISONIC_IR &&
    effectiveIRChannels > 2;

  // Channel count: raw ambisonic → N channels, otherwise stereo
  const outputChannels = useRawAmbisonic ? numAmbiChannels : 2;

  // OfflineAudioContext with the appropriate channel count
  const offlineCtx = new OfflineAudioContext(outputChannels, totalSamples, sampleRate);

  // For raw ambisonic export, configure the destination to preserve all channels
  // and bypass the limiter (DynamicsCompressorNode is spec-constrained to 2 channels)
  if (useRawAmbisonic) {
    offlineCtx.destination.channelCount = outputChannels;
    offlineCtx.destination.channelCountMode = 'explicit';
    offlineCtx.destination.channelInterpretation = 'discrete';
  }

  // Limiter — matches the real-time AudioOrchestrator signal chain
  // NOTE: Only used for stereo paths. DynamicsCompressorNode is hardcoded to
  // max 2 channels by the Web Audio spec, so it cannot be used for N-channel output.
  let limiter: DynamicsCompressorNode | null = null;
  if (!useRawAmbisonic) {
    limiter = offlineCtx.createDynamicsCompressor();
    limiter.threshold.value = AUDIO_CONTROL.LIMITER.THRESHOLD_DB;
    limiter.knee.value      = AUDIO_CONTROL.LIMITER.KNEE_DB;
    limiter.ratio.value     = AUDIO_CONTROL.LIMITER.RATIO;
    limiter.attack.value    = AUDIO_CONTROL.LIMITER.ATTACK_SEC;
    limiter.release.value   = AUDIO_CONTROL.LIMITER.RELEASE_SEC;
    limiter.connect(offlineCtx.destination);
  }

  onProgress?.(0.08);

  // Build mode-specific audio graph
  if (mode === AudioMode.ANECHOIC) {
    await buildAnechoicGraph(offlineCtx, activeSounds, config, limiter!, onProgress);
  } else if (mode === AudioMode.AMBISONIC_IR) {
    if (useRawAmbisonic) {
      // Raw ambisonic export — skip binaural decoder AND limiter, write N-channel WAV
      await buildRawAmbisonicIRGraph(offlineCtx, activeSounds, config, offlineCtx.destination, onProgress);
    } else {
      await buildAmbisonicIRGraph(offlineCtx, activeSounds, config, limiter!, onProgress);
    }
  } else {
    // Resonance Audio or unknown modes: simple stereo dry mix
    await buildSimpleMixGraph(offlineCtx, activeSounds, config, limiter!, onProgress);
  }

  onProgress?.(0.65);

  // Offline render (faster than real-time — typically 10–100×)
  const renderedBuffer = await offlineCtx.startRendering();

  onProgress?.(0.92);

  // Encode to 16-bit WAV (stereo or multi-channel) and trigger browser download
  const wavBlob = audioBufferToWavBlob(renderedBuffer);
  const durationLabel = Math.round(durationSecsVal);
  const modeLabel = getModeLabel(mode);
  const channelSuffix = useRawAmbisonic ? `_${numAmbiChannels}ch` : '';
  const simSuffix = config.simulationName
    ? `_${config.simulationName.replace(/[^a-zA-Z0-9_\-]/g, '_')}`
    : '';
  downloadBlob(wavBlob, `soundscape_${modeLabel}${channelSuffix}${simSuffix}_${durationLabel}s.wav`);

  onProgress?.(1.0);
}

// ============================================================================
// Anechoic Mode Graph
// JSAmbisonics monoEncoder per source → mix bus → BinauralDecoder → limiter
// ============================================================================

async function buildAnechoicGraph(
  offlineCtx: OfflineAudioContext,
  sounds: TimelineSound[],
  config: SoundscapeExportConfig,
  limiter: DynamicsCompressorNode,
  onProgress?: ExportProgressCallback
): Promise<void> {
  const { ambisonicOrder, sourceRegistry, listenerPosition, listenerOrientation, soundGains } = config;
  const numChannels = (ambisonicOrder + 1) ** 2;

  // Ambisonic mix bus: sums all encoder outputs
  const mixBus = offlineCtx.createGain();
  mixBus.channelCount = numChannels;
  mixBus.channelCountMode = 'explicit';
  mixBus.channelInterpretation = 'discrete';

  // Binaural decoder: JSAmbisonics-based, compatible with OfflineAudioContext
  const binDecoder = new BinauralDecoder();
  // OfflineAudioContext is a BaseAudioContext — BinauralDecoder only uses BaseAudioContext APIs
  await binDecoder.initialize(offlineCtx as unknown as AudioContext, ambisonicOrder);
  // Anechoic mode bakes orientation into the encoder — no decoder rotation needed
  binDecoder.updateOrientation({ yaw: 0, pitch: 0, roll: 0 });

  // Connect: mixBus → binaural decoder → limiter
  mixBus.connect(binDecoder.getInputNode());
  binDecoder.getOutputNode().connect(limiter);

  onProgress?.(0.25);

  // Pre-compute listener rotation matrices once (same for all sources)
  const cosYaw   = Math.cos(listenerOrientation.yaw);
  const sinYaw   = Math.sin(listenerOrientation.yaw);
  const cosPitch = Math.cos(listenerOrientation.pitch);
  const sinPitch = Math.sin(listenerOrientation.pitch);

  for (const sound of sounds) {
    const sourceInfo = sourceRegistry.get(sound.id);
    if (!sourceInfo) {
      console.warn(`[SoundscapeExporter] Sound "${sound.id}" not in source registry — skipping`);
      continue;
    }

    // User volume gain
    const gainNode = offlineCtx.createGain();
    gainNode.gain.value = soundGains.get(sound.id) ?? 1.0;

    // Distance attenuation (inverse-square, same as AnechoicMode)
    const distNode = offlineCtx.createGain();
    const rel = {
      x: sourceInfo.position.x - listenerPosition.x,
      y: sourceInfo.position.y - listenerPosition.y,
      z: sourceInfo.position.z - listenerPosition.z,
    };

    // Yaw rotation (Z-UP)
    const localRight   =  rel.x * cosYaw - rel.y * sinYaw;
    const localForward = -rel.x * sinYaw  - rel.y * cosYaw;
    const localUp      =  rel.z;

    // Pitch rotation
    const headForward = localForward * cosPitch + localUp * sinPitch;
    const headRight   = localRight;
    const headUp      = -localForward * sinPitch + localUp * cosPitch;

    // Convert to ambisonics spherical (+X=Front, +Y=Left, +Z=Up)
    const spherical = cartesianToSpherical({ x: headForward, y: -headRight, z: headUp });
    const refDist = 1.0;
    const dist = Math.max(refDist, spherical.distance);
    distNode.gain.value = refDist / dist;

    // JSAmbisonics monoEncoder
    const encoder = new ambisonics.monoEncoder(offlineCtx, ambisonicOrder);
    encoder.azim = -spherical.azimuth * (180 / Math.PI); // negate for JSAmbisonics convention
    encoder.elev =  spherical.elevation * (180 / Math.PI);
    encoder.updateGains();

    // Graph: BufferSource → gain → dist → encoder.in → encoder.out → mixBus
    gainNode.connect(distNode);
    distNode.connect(encoder.in);
    encoder.out.connect(mixBus);

    // Schedule each timeline iteration
    scheduleIterations(offlineCtx, sourceInfo.buffer, sound.scheduledIterations, gainNode, durationSecs(offlineCtx));
  }
}

// ============================================================================
// AmbisonicIR Mode Graph
// JSAmbisonics convolver (IR) per source → BinauralDecoder → boostGain → limiter
// ============================================================================

async function buildAmbisonicIRGraph(
  offlineCtx: OfflineAudioContext,
  sounds: TimelineSound[],
  config: SoundscapeExportConfig,
  limiter: DynamicsCompressorNode,
  onProgress?: ExportProgressCallback
): Promise<void> {
  const {
    ambisonicOrder,
    sourceRegistry,
    listenerOrientation,
    soundGains,
    irBuffer,
    perSourceIRBuffers,
  } = config;

  // Binaural decoder with rotation enabled (IR encodes spatial info, rotation applied to field)
  const binDecoder = new BinauralDecoder();
  await binDecoder.initialize(offlineCtx as unknown as AudioContext, ambisonicOrder);
  binDecoder.setRotationEnabled(true);
  binDecoder.updateOrientation(listenerOrientation);

  // Connect: decoder → limiter (no artificial gain compensation)
  binDecoder.getOutputNode().connect(limiter);

  onProgress?.(0.25);

  for (const sound of sounds) {
    const sourceInfo = sourceRegistry.get(sound.id);
    if (!sourceInfo) {
      console.warn(`[SoundscapeExporter] Sound "${sound.id}" not in source registry — skipping`);
      continue;
    }

    // Choose per-source IR or fall back to global IR
    const sourceIR = perSourceIRBuffers?.get(sound.id) ?? irBuffer ?? null;
    if (!sourceIR) {
      console.warn(`[SoundscapeExporter] No IR buffer for sound "${sound.id}" — skipping`);
      continue;
    }

    // User volume gain
    const gainNode = offlineCtx.createGain();
    gainNode.gain.value = soundGains.get(sound.id) ?? 1.0;

    // JSAmbisonics convolver: handles FOA/SOA/TOA multi-channel convolution
    const convolver = new ambisonics.convolver(offlineCtx, ambisonicOrder);
    convolver.updateFilters(sourceIR);

    // Connect: gain → mute → convolver.in → convolver.out → decoder
    gainNode.connect(convolver.in);
    convolver.out.connect(binDecoder.getInputNode()); // Web Audio sums automatically

    // Schedule each timeline iteration
    scheduleIterations(offlineCtx, sourceInfo.buffer, sound.scheduledIterations, gainNode, durationSecs(offlineCtx));
  }
}

// ============================================================================
// Raw Ambisonic IR Graph (bypass binaural decoder AND limiter)
// JSAmbisonics convolver per source → boostGain → destination (N-channel output)
// ============================================================================

async function buildRawAmbisonicIRGraph(
  offlineCtx: OfflineAudioContext,
  sounds: TimelineSound[],
  config: SoundscapeExportConfig,
  outputNode: AudioNode,
  onProgress?: ExportProgressCallback
): Promise<void> {
  const {
    ambisonicOrder,
    sourceRegistry,
    soundGains,
    irBuffer,
    perSourceIRBuffers,
    listenerOrientation,
    globalListenerOrientation,
  } = config;
  const numChannels = (ambisonicOrder + 1) ** 2;

  // Pass-through node to preserve all ambisonic channels to destination
  const outputBus = offlineCtx.createGain();
  outputBus.channelCount = numChannels;
  outputBus.channelCountMode = 'explicit';
  outputBus.channelInterpretation = 'discrete';
  outputBus.connect(outputNode);

  // Apply listener rotation before writing raw ambisonic channels so exported
  // FOA/SOA/TOA matches the global listener orientation from Advanced Settings.
  // Use the same JSAmbisonics sign convention correction as BinauralDecoder.
  const sceneRotator = new ambisonics.sceneRotator(offlineCtx, ambisonicOrder);
  sceneRotator.yaw = 0;
  sceneRotator.pitch = 0;
  sceneRotator.roll = 0;

  const orientationForRaw = globalListenerOrientation
    ? orientationFromForwardVector(globalListenerOrientation)
    : listenerOrientation;
  const RAD_TO_DEG = 180 / Math.PI;
  sceneRotator.yaw = -orientationForRaw.yaw * RAD_TO_DEG;
  sceneRotator.pitch = -orientationForRaw.pitch * RAD_TO_DEG;
  sceneRotator.roll = 0;
  sceneRotator.updateRotMtx();

  sceneRotator.out.connect(outputBus);

  onProgress?.(0.25);

  console.log(`[SoundscapeExporter] Raw ambisonic export: ${numChannels} channels (order ${ambisonicOrder}), no binaural decoder`);

  for (const sound of sounds) {
    const sourceInfo = sourceRegistry.get(sound.id);
    if (!sourceInfo) {
      console.warn(`[SoundscapeExporter] Sound "${sound.id}" not in source registry — skipping`);
      continue;
    }

    // Choose per-source IR or fall back to global IR
    const sourceIR = perSourceIRBuffers?.get(sound.id) ?? irBuffer ?? null;
    if (!sourceIR) {
      console.warn(`[SoundscapeExporter] No IR buffer for sound "${sound.id}" — skipping`);
      continue;
    }

    // User volume gain
    const gainNode = offlineCtx.createGain();
    gainNode.gain.value = soundGains.get(sound.id) ?? 1.0;

    // JSAmbisonics convolver: handles FOA/SOA/TOA multi-channel convolution
    const convolver = new ambisonics.convolver(offlineCtx, ambisonicOrder);
    convolver.updateFilters(sourceIR);

    // Connect: gain → convolver.in → convolver.out → sceneRotator → outputBus
    gainNode.connect(convolver.in);
    convolver.out.connect(sceneRotator.in);

    // Schedule each timeline iteration
    scheduleIterations(offlineCtx, sourceInfo.buffer, sound.scheduledIterations, gainNode, durationSecs(offlineCtx));
  }
}

/**
 * Convert a forward vector in Speckle Z-up coordinates to yaw/pitch radians.
 * Matches SpeckleCameraController's orientation convention:
 * - yaw = atan2(-x, -y)
 * - pitch = asin(z)
 */
function orientationFromForwardVector(forward: Position3D): Orientation {
  const mag = Math.hypot(forward.x, forward.y, forward.z);
  if (mag < 1e-6) {
    return { yaw: 0, pitch: 0, roll: 0 };
  }

  const nx = forward.x / mag;
  const ny = forward.y / mag;
  const nz = forward.z / mag;

  return {
    yaw: Math.atan2(-nx, -ny),
    pitch: Math.asin(nz),
    roll: 0,
  };
}

// ============================================================================
// Simple Stereo Mix (Resonance or other modes)
// No spatial processing — straight mix to stereo destination
// ============================================================================

async function buildSimpleMixGraph(
  offlineCtx: OfflineAudioContext,
  sounds: TimelineSound[],
  config: SoundscapeExportConfig,
  limiter: DynamicsCompressorNode,
  onProgress?: ExportProgressCallback
): Promise<void> {
  const { sourceRegistry, soundGains } = config;

  const masterGain = offlineCtx.createGain();
  masterGain.gain.value = 1.0;
  masterGain.connect(limiter);

  onProgress?.(0.25);

  for (const sound of sounds) {
    const sourceInfo = sourceRegistry.get(sound.id);
    if (!sourceInfo) {
      console.warn(`[SoundscapeExporter] Sound "${sound.id}" not in source registry — skipping`);
      continue;
    }

    const gainNode = offlineCtx.createGain();
    gainNode.gain.value = soundGains.get(sound.id) ?? 1.0;
    gainNode.connect(masterGain);

    scheduleIterations(offlineCtx, sourceInfo.buffer, sound.scheduledIterations, gainNode, durationSecs(offlineCtx));
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Schedule each timeline iteration as a one-shot AudioBufferSourceNode.
 */
function scheduleIterations(
  offlineCtx: OfflineAudioContext,
  buffer: AudioBuffer,
  timestampsMs: number[],
  destination: AudioNode,
  maxDurationSecs: number
): void {
  for (const tsMs of timestampsMs) {
    const startSec = tsMs / 1000;
    if (startSec >= maxDurationSecs) continue; // Outside timeline window

    const src = offlineCtx.createBufferSource();
    src.buffer = buffer;
    src.connect(destination);
    src.start(startSec);
  }
}

/** Return the OfflineAudioContext duration in seconds */
function durationSecs(ctx: OfflineAudioContext): number {
  return ctx.length / ctx.sampleRate;
}

/** Human-readable mode label for the filename */
function getModeLabel(mode: AudioMode): string {
  switch (mode) {
    case AudioMode.ANECHOIC:        return 'anechoic';
    case AudioMode.AMBISONIC_IR:    return 'ir';
    case AudioMode.NO_IR_RESONANCE: return 'resonance';
    default:                        return 'mix';
  }
}

// ============================================================================
// WAV Encoding (16-bit PCM, supports multi-channel)
// ============================================================================

/**
 * Encode an AudioBuffer to a 16-bit WAV Blob.
 * Preserves the buffer's channel count (stereo, FOA 4-ch, SOA 9-ch, etc.).
 */
function audioBufferToWavBlob(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const { sampleRate, length: numSamples } = buffer;
  const bytesPerSample = 2; // 16-bit
  const dataByteLength = numChannels * numSamples * bytesPerSample;
  const headerByteLength = 44;
  const arrayBuffer = new ArrayBuffer(headerByteLength + dataByteLength);
  const view = new DataView(arrayBuffer);

  // RIFF / WAVE header
  writeStr(view, 0,  'RIFF');
  view.setUint32(4,  headerByteLength + dataByteLength - 8, true);
  writeStr(view, 8,  'WAVE');
  writeStr(view, 12, 'fmt ');
  view.setUint32(16, 16, true);                                     // fmt chunk size
  view.setUint16(20, 1,  true);                                     // PCM = 1
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true); // byte rate
  view.setUint16(32, numChannels * bytesPerSample, true);           // block align
  view.setUint16(34, 16, true);                                     // bits per sample
  writeStr(view, 36, 'data');
  view.setUint32(40, dataByteLength, true);

  // Interleaved sample data (ch0, ch1, …, chN, ch0, ch1, …)
  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) {
    channels.push(buffer.getChannelData(c));
  }

  let offset = headerByteLength;
  for (let i = 0; i < numSamples; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

function writeStr(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

/** Trigger a browser file download for the given blob */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
