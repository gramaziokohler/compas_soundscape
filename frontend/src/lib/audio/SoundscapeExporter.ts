/**
 * SoundscapeExporter
 *
 * Exports the full soundscape as a multi-format WAV file.
 * Uses OfflineAudioContext for faster-than-real-time rendering.
 *
 * Supported export formats:
 * - mono:     1-channel (W channel from ambisonic mix) with single-channel limiter
 * - binaural: 2-channel HRTF binaural with linked-stereo limiter
 * - foa:      4-channel 1st order raw ambisonics (no limiter)
 * - toa:      16-channel 3rd order raw ambisonics (no limiter)
 *
 * Supported audio modes:
 * - Anechoic:     JSAmbisonics monoEncoder → ambisonic mix → format decoder
 * - AmbisonicIR:  JSAmbisonics convolver (IR) → ambisonic mix → format decoder
 * - Resonance:    Google Resonance Audio scene → format output tap
 *
 * All exports use 24-bit PCM WAV encoding.
 */

import type { TimelineSound, Position, Position3D, Orientation, AmbisonicOrder, IterationLink } from '@/types/audio';
import { AudioMode } from '@/types/audio';
import { cartesianToSpherical } from './utils/ambisonic-utils';
import { BinauralDecoder } from './decoders/BinauralDecoder';
import { HRTF } from '@/utils/constants';

// ============================================================================
// Public Types
// ============================================================================

export type ExportFormat = 'mono' | 'binaural' | 'foa' | 'toa';

export interface SoundscapeExportConfig {
  mode: AudioMode;
  ambisonicOrder: AmbisonicOrder;
  sampleRate: number;

  /** Target export format */
  exportFormat: ExportFormat;

  /** Decoded audio buffers keyed by soundId, with 3D positions */
  sourceRegistry: Map<string, { buffer: AudioBuffer; position: Position }>;

  /** Listener pose at the time of export (snapshot) */
  listenerPosition: Position;
  listenerOrientation: Orientation;

  /**
   * Optional global listener forward direction from UI advanced settings.
   * Used for raw ambisonic export (FOA/TOA) to apply the same orientation
   * that is used when entering first-person mode.
   */
  globalListenerOrientation?: Position3D;

  /** Processed global IR buffer (AmbisonicIR mode with manual IR) */
  irBuffer?: AudioBuffer | null;

  /** Per-source processed IR buffers (simulation / pyroomacoustics mode) */
  perSourceIRBuffers?: Map<string, AudioBuffer>;

  /**
   * Original channel count of the IR before any mono/stereo→FOA conversion.
   * Used for AmbisonicIR mode to distinguish genuine multi-channel IRs.
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

  /** Audio trim settings per sound (start/end as fraction 0-1 of buffer duration) */
  soundTrims?: Record<string, { start: number; end: number }>;

  /** Per-iteration variant/entity links (for resolving variant buffers per iteration) */
  iterationLinks?: Record<string, IterationLink>;

  // ── Resonance Audio specific ──

  /** Room dimensions for Resonance mode { width, height, depth } */
  roomDimensions?: { width: number; height: number; depth: number } | null;

  /** Room materials for Resonance mode { left, right, front, back, down, up } */
  roomMaterials?: Record<string, string> | null;

  /** Offset to translate world-space positions to Resonance room origin */
  roomCenterOffset?: { x: number; y: number; z: number } | null;

  /** Speed of sound in m/s (for Resonance mode) */
  speedOfSound?: number;
}

export type ExportProgressCallback = (fraction: number) => void;

// ============================================================================
// Format descriptor helpers
// ============================================================================

interface FormatDescriptor {
  channels: number;
  order: AmbisonicOrder;
  label: string;
  /** Whether we apply a post-render linked limiter */
  usePostLimiter: boolean;
  /** Whether we output raw ambisonic channels (vs decoded) */
  rawAmbisonic: boolean;
}

function getFormatDescriptor(format: ExportFormat): FormatDescriptor {
  switch (format) {
    case 'mono':     return { channels: 1, order: 1, label: 'mono',     usePostLimiter: true,  rawAmbisonic: false };
    case 'binaural': return { channels: 2, order: 3, label: 'binaural', usePostLimiter: true,  rawAmbisonic: false };
    case 'foa':      return { channels: 4, order: 1, label: 'foa',      usePostLimiter: false, rawAmbisonic: true  };
    case 'toa':      return { channels: 16, order: 3, label: 'toa',     usePostLimiter: false, rawAmbisonic: true  };
  }
}

// ============================================================================
// Lazy-load libraries
// ============================================================================

let ambisonics: any = null;
async function loadAmbisonics(): Promise<any> {
  if (!ambisonics && typeof window !== 'undefined') {
    ambisonics = await import('ambisonics');
  }
  return ambisonics;
}

let resonanceAudioLib: any = null;
async function loadResonanceAudioLib(): Promise<any> {
  if (!resonanceAudioLib && typeof window !== 'undefined') {
    resonanceAudioLib = await import('resonance-audio');
  }
  return resonanceAudioLib;
}

function getResonanceAudioConstructor(lib: any): any {
  if (lib.default && typeof lib.default.ResonanceAudio === 'function') {
    return lib.default.ResonanceAudio;
  }
  if (typeof lib.default === 'function') {
    return lib.default;
  }
  return lib.ResonanceAudio;
}

// ============================================================================
// Main Export Entry Point
// ============================================================================

export async function exportSoundscapeToWav(
  sounds: TimelineSound[],
  durationMs: number,
  config: SoundscapeExportConfig,
  onProgress?: ExportProgressCallback
): Promise<void> {
  onProgress?.(0.02);

  const activeSounds = sounds.filter((s) => {
    if (config.soloedSound) return s.id === config.soloedSound;
    return !config.mutedSounds.has(s.id);
  });

  if (activeSounds.length === 0) {
    throw new Error('No active sounds to export');
  }

  await loadAmbisonics();
  onProgress?.(0.05);

  const fmt = getFormatDescriptor(config.exportFormat);
  const durationSecsVal = durationMs / 1000;
  const { sampleRate, mode } = config;
  const totalSamples = Math.ceil(durationSecsVal * sampleRate);

  const offlineCtx = new OfflineAudioContext(fmt.channels, totalSamples, sampleRate);

  // Configure destination for multi-channel raw ambisonic output
  if (fmt.rawAmbisonic && fmt.channels > 2) {
    offlineCtx.destination.channelCount = fmt.channels;
    offlineCtx.destination.channelCountMode = 'explicit';
    offlineCtx.destination.channelInterpretation = 'discrete';
  }

  const destinationNode: AudioNode = offlineCtx.destination;

  onProgress?.(0.08);

  // Dispatch by audio mode
  if (mode === AudioMode.NO_IR_RESONANCE) {
    await buildResonanceGraph(offlineCtx, activeSounds, config, fmt, destinationNode, onProgress);
  } else if (mode === AudioMode.ANECHOIC) {
    await buildAnechoicGraph(offlineCtx, activeSounds, config, fmt, destinationNode, onProgress);
  } else if (mode === AudioMode.AMBISONIC_IR) {
    await buildAmbisonicIRGraph(offlineCtx, activeSounds, config, fmt, destinationNode, onProgress);
  } else {
    await buildSimpleMixGraph(offlineCtx, activeSounds, config, fmt, destinationNode, onProgress);
  }

  onProgress?.(0.65);

  const renderedBuffer = await offlineCtx.startRendering();

  onProgress?.(0.85);

  // Post-render linked limiter for mono / binaural
  let finalBuffer = renderedBuffer;
  if (fmt.usePostLimiter) {
    finalBuffer = applyLinkedLimiter(renderedBuffer);
  }

  onProgress?.(0.92);

  const wavBlob = audioBufferToWavBlob24(finalBuffer);
  const durationLabel = Math.round(durationSecsVal);
  const modeLabel = getModeLabel(mode);
  const simSuffix = config.simulationName
    ? `_${config.simulationName.replace(/[^a-zA-Z0-9_\-]/g, '_')}`
    : '';
  downloadBlob(wavBlob, `soundscape_${modeLabel}_${fmt.label}${simSuffix}_${durationLabel}s.wav`);

  onProgress?.(1.0);
}

// ============================================================================
// Anechoic Mode Graph
// monoEncoder per source → ambisonic mix bus → format decoder
// ============================================================================

async function buildAnechoicGraph(
  offlineCtx: OfflineAudioContext,
  sounds: TimelineSound[],
  config: SoundscapeExportConfig,
  fmt: FormatDescriptor,
  destinationNode: AudioNode,
  onProgress?: ExportProgressCallback
): Promise<void> {
  const { sourceRegistry, listenerPosition, listenerOrientation, soundGains, ambisonicOrder } = config;
  const encodeOrder: AmbisonicOrder = fmt.rawAmbisonic ? fmt.order : ambisonicOrder;
  const numChannels = (encodeOrder + 1) ** 2;

  const mixBus = offlineCtx.createGain();
  mixBus.channelCount = numChannels;
  mixBus.channelCountMode = 'explicit';
  mixBus.channelInterpretation = 'discrete';

  // Format-specific output stage
  if (fmt.rawAmbisonic) {
    // Use a sceneRotator at identity to match the BinauralDecoder's exact
    // input node (ChannelSplitter → rotation matrix → ChannelMerger).
    // This ensures the raw ambisonic data is bit-identical to what the
    // binDecoder receives, preserving the same spatial orientation.
    const rotator = new ambisonics.sceneRotator(offlineCtx, encodeOrder);
    rotator.yaw = 0;
    rotator.pitch = 0;
    rotator.roll = 0;
    rotator.updateRotMtx();

    mixBus.connect(rotator.in);
    rotator.out.connect(destinationNode);
  } else if (fmt.label === 'binaural') {
    const binDecoder = new BinauralDecoder();
    await binDecoder.initialize(offlineCtx as unknown as AudioContext, encodeOrder);
    binDecoder.updateOrientation({ yaw: 0, pitch: 0, roll: 0 });
    try {
      await binDecoder.loadHRTFs(HRTF.DEFAULT_HRTF_PATH);
    } catch {
      console.warn('[SoundscapeExporter] HRTFs unavailable, using cardioid fallback');
    }
    mixBus.connect(binDecoder.getInputNode());
    binDecoder.getOutputNode().connect(destinationNode);
  } else {
    // Mono: extract W channel (channel 0)
    setupMonoWExtract(offlineCtx, mixBus, numChannels, destinationNode);
  }

  onProgress?.(0.25);

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

    const gainNode = offlineCtx.createGain();
    gainNode.gain.value = soundGains.get(sound.id) ?? 1.0;

    const distNode = offlineCtx.createGain();
    const rel = {
      x: sourceInfo.position.x - listenerPosition.x,
      y: sourceInfo.position.y - listenerPosition.y,
      z: sourceInfo.position.z - listenerPosition.z,
    };

    const localRight   =  rel.x * cosYaw - rel.y * sinYaw;
    const localForward = -rel.x * sinYaw  - rel.y * cosYaw;
    const localUp      =  rel.z;

    const headForward = localForward * cosPitch + localUp * sinPitch;
    const headRight   = localRight;
    const headUp      = -localForward * sinPitch + localUp * cosPitch;

    const spherical = cartesianToSpherical({ x: headForward, y: -headRight, z: headUp });
    const refDist = 1.0;
    const dist = Math.max(refDist, spherical.distance);
    distNode.gain.value = refDist / dist;

    const encoder = new ambisonics.monoEncoder(offlineCtx, encodeOrder);
    encoder.azim = -spherical.azimuth * (180 / Math.PI);
    encoder.elev = spherical.elevation * (180 / Math.PI);
    encoder.updateGains();

    gainNode.connect(distNode);
    distNode.connect(encoder.in);
    encoder.out.connect(mixBus);

    scheduleIterations(offlineCtx, resolveIterationBuffers(sound, sourceRegistry, config.iterationLinks), sound.scheduledIterations, gainNode, durationSecs(offlineCtx), config.soundTrims?.[sound.id]);
  }
}

// ============================================================================
// AmbisonicIR Mode Graph
// convolver per source → ambisonic mix bus → format decoder
// ============================================================================

function resolveIROrder(
  sounds: TimelineSound[],
  sourceRegistry: Map<string, { buffer: AudioBuffer; position: import('@/types/audio').Position }>,
  irBuffer: AudioBuffer | null | undefined,
  perSourceIRBuffers: Map<string, AudioBuffer> | undefined,
): AmbisonicOrder | null {
  for (const sound of sounds) {
    const ir = perSourceIRBuffers?.get(sound.id) ?? irBuffer ?? null;
    if (ir && ir.numberOfChannels > 0) {
      const order = Math.round(Math.sqrt(ir.numberOfChannels)) - 1;
      if (order >= 1 && order <= 3) return order as AmbisonicOrder;
    }
  }
  return null;
}

async function buildAmbisonicIRGraph(
  offlineCtx: OfflineAudioContext,
  sounds: TimelineSound[],
  config: SoundscapeExportConfig,
  fmt: FormatDescriptor,
  destinationNode: AudioNode,
  onProgress?: ExportProgressCallback
): Promise<void> {
  const {
    sourceRegistry,
    listenerOrientation,
    soundGains,
    irBuffer,
    perSourceIRBuffers,
  } = config;

  // Derive the convolver order from the IR channel count, not the export
  // format order.  A FOA IR (4ch) must use an order-1 convolver even when
  // exporting binaural (which would otherwise demand order 3).
  const irOrder = resolveIROrder(sounds, sourceRegistry, irBuffer, perSourceIRBuffers);
  if (irOrder === null) {
    console.warn('[SoundscapeExporter] Could not determine IR order — skipping');
    return;
  }
  const irChannels = (irOrder + 1) ** 2;

  const mixBus = offlineCtx.createGain();
  mixBus.channelCount = irChannels;
  mixBus.channelCountMode = 'explicit';
  mixBus.channelInterpretation = 'discrete';

  // Format-specific output stage
  if (fmt.rawAmbisonic) {
    if (irOrder === fmt.order) {
      setupRawAmbisonicOutput(offlineCtx, mixBus, irOrder, config, destinationNode);
    } else if (irOrder < fmt.order) {
      // Upconvert: route through a sceneRotator at the target order.
      // The first irChannels carry the valid lower-order subset.
      const upRotator = new ambisonics.sceneRotator(offlineCtx, irOrder);
      upRotator.yaw = 0; upRotator.pitch = 0; upRotator.roll = 0;
      upRotator.updateRotMtx();
      mixBus.connect(upRotator.in);

      const padBus = offlineCtx.createGain();
      padBus.channelCount = (fmt.order + 1) ** 2;
      padBus.channelCountMode = 'explicit';
      padBus.channelInterpretation = 'discrete';

      const splitter = offlineCtx.createChannelSplitter(irChannels);
      upRotator.out.connect(splitter);
      for (let c = 0; c < irChannels; c++) {
        splitter.connect(padBus, c, c);
      }
      padBus.connect(destinationNode);
    } else {
      // irOrder > fmt.order: extract first fmt.channels channels
      const downRotator = new ambisonics.sceneRotator(offlineCtx, irOrder);
      downRotator.yaw = 0; downRotator.pitch = 0; downRotator.roll = 0;
      downRotator.updateRotMtx();
      mixBus.connect(downRotator.in);

      const splitter = offlineCtx.createChannelSplitter(irChannels);
      downRotator.out.connect(splitter);
      for (let c = 0; c < fmt.channels; c++) {
        splitter.connect(destinationNode, c, c);
      }
    }
  } else if (fmt.label === 'binaural') {
    const binDecoder = new BinauralDecoder();
    await binDecoder.initialize(offlineCtx as unknown as AudioContext, irOrder);
    binDecoder.setRotationEnabled(true);
    binDecoder.updateOrientation(listenerOrientation);
    try {
      await binDecoder.loadHRTFs(HRTF.DEFAULT_HRTF_PATH);
    } catch {
      console.warn('[SoundscapeExporter] HRTFs unavailable, using cardioid fallback');
    }
    mixBus.connect(binDecoder.getInputNode());
    binDecoder.getOutputNode().connect(destinationNode);
  } else {
    setupMonoWExtract(offlineCtx, mixBus, irChannels, destinationNode);
  }

  onProgress?.(0.25);

  for (const sound of sounds) {
    const sourceInfo = sourceRegistry.get(sound.id);
    if (!sourceInfo) {
      console.warn(`[SoundscapeExporter] Sound "${sound.id}" not in source registry — skipping`);
      continue;
    }

    const sourceIR = perSourceIRBuffers?.get(sound.id) ?? irBuffer ?? null;
    if (!sourceIR) {
      console.warn(`[SoundscapeExporter] No IR buffer for sound "${sound.id}" — skipping`);
      continue;
    }

    const gainNode = offlineCtx.createGain();
    gainNode.gain.value = soundGains.get(sound.id) ?? 1.0;

    const convolver = new ambisonics.convolver(offlineCtx, irOrder);
    convolver.updateFilters(sourceIR);

    gainNode.connect(convolver.in);
    convolver.out.connect(mixBus);

    scheduleIterations(offlineCtx, resolveIterationBuffers(sound, sourceRegistry, config.iterationLinks), sound.scheduledIterations, gainNode, durationSecs(offlineCtx), config.soundTrims?.[sound.id]);
  }
}

// ============================================================================
// Resonance Mode Graph
// Google Resonance Audio scene → format output tap
// ============================================================================

async function buildResonanceGraph(
  offlineCtx: OfflineAudioContext,
  sounds: TimelineSound[],
  config: SoundscapeExportConfig,
  fmt: FormatDescriptor,
  destinationNode: AudioNode,
  onProgress?: ExportProgressCallback
): Promise<void> {
  const {
    sourceRegistry,
    listenerPosition,
    listenerOrientation,
    soundGains,
    roomDimensions,
    roomMaterials,
    roomCenterOffset,
  } = config;

  try {
    const lib = await loadResonanceAudioLib();
    const ResonanceAudio = getResonanceAudioConstructor(lib);
    if (!ResonanceAudio) {
      throw new Error('ResonanceAudio constructor not found');
    }

    const dims = roomDimensions ?? { width: 10, height: 3, depth: 10 };
    const mats = roomMaterials ?? {
      left: 'acoustic-ceiling-tiles', right: 'brick-bare', front: 'brick-bare',
      back: 'brick-bare', down: 'parquet-on-concrete', up: 'brick-bare',
    };
    const centerOffset = roomCenterOffset ?? { x: 0, y: 0, z: 0 };

    // Create ResonanceAudio scene with the format's ambisonic order
    const scene = new ResonanceAudio(offlineCtx, {
      ambisonicOrder: fmt.order,
      speedOfSound: config.speedOfSound ?? 343,
    });

    scene.setRoomProperties(dims, mats);

    scene.setListenerPosition(
      listenerPosition.x - centerOffset.x,
      listenerPosition.y - centerOffset.y,
      listenerPosition.z - centerOffset.z,
    );

    const fwd = {
      x:  Math.sin(listenerOrientation.yaw) * Math.cos(listenerOrientation.pitch),
      y: -Math.cos(listenerOrientation.yaw) * Math.cos(listenerOrientation.pitch),
      z:  Math.sin(listenerOrientation.pitch),
    };
    const up = {
      x: Math.sin(listenerOrientation.roll),
      y: 0,
      z: Math.cos(listenerOrientation.roll),
    };
    scene.setListenerOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);

    onProgress?.(0.25);

    // Output tap by format
    if (fmt.rawAmbisonic) {
      const ambiOut = (scene as any).ambisonicOutput as AudioNode;
      if (!ambiOut) throw new Error('ResonanceAudio scene has no ambisonicOutput');
      const outputBus = offlineCtx.createGain();
      outputBus.channelCount = fmt.channels;
      outputBus.channelCountMode = 'explicit';
      outputBus.channelInterpretation = 'discrete';
      ambiOut.connect(outputBus);
      outputBus.connect(destinationNode);
    } else if (fmt.label === 'binaural') {
      scene.output.connect(destinationNode);
    } else {
      // mono: extract W channel
      const ambiOut = (scene as any).ambisonicOutput as AudioNode;
      if (!ambiOut) throw new Error('ResonanceAudio scene has no ambisonicOutput');
      const numCh = (fmt.order + 1) ** 2;
      const splitter = offlineCtx.createChannelSplitter(numCh);
      // ChannelSplitterNode has fixed channelCount=1 per spec — do not set it.
      ambiOut.connect(splitter);
      splitter.connect(destinationNode, 0, 0);
    }

    // Create sources and schedule
    for (const sound of sounds) {
      const sourceInfo = sourceRegistry.get(sound.id);
      if (!sourceInfo) {
        console.warn(`[SoundscapeExporter] Sound "${sound.id}" not in source registry — skipping`);
        continue;
      }

      const resonanceSource = scene.createSource();
      const pos = sourceInfo.position;
      resonanceSource.setPosition(
        pos.x - centerOffset.x,
        pos.y - centerOffset.y,
        pos.z - centerOffset.z,
      );
      // Match real-time ResonanceMode.createSource exactly.
      resonanceSource.setGain(1.0);
      (resonanceSource as any).setRolloff?.('logarithmic');
      (resonanceSource as any).setMinDistance?.(1);
      (resonanceSource as any).setMaxDistance?.(10000);

      const gainNode = offlineCtx.createGain();
      gainNode.gain.value = soundGains.get(sound.id) ?? 1.0;
      gainNode.connect(resonanceSource.input);

      scheduleIterations(offlineCtx, resolveIterationBuffers(sound, sourceRegistry, config.iterationLinks), sound.scheduledIterations, gainNode, durationSecs(offlineCtx), config.soundTrims?.[sound.id]);
    }

    // Omnitone's HOARenderer.initialize() is async (Promise).  Yield to the
    // event loop so it can load HRIRs and connect the room to the output
    // nodes.  Then re-apply listener orientation — the renderer may reset
    // its rotation matrix during initialization, discarding the synchronous
    // setOrientation() call from the constructor.
    await new Promise<void>(r => setTimeout(r, 0));
    scene.setListenerPosition(
      listenerPosition.x - centerOffset.x,
      listenerPosition.y - centerOffset.y,
      listenerPosition.z - centerOffset.z,
    );
    scene.setListenerOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);

    console.log(`[SoundscapeExporter] Resonance graph built (${fmt.label}, order ${fmt.order})`);
  } catch (err) {
    console.warn('[SoundscapeExporter] Resonance export failed, falling back to simple mix:', err);
    await buildSimpleMixGraph(offlineCtx, sounds, config, fmt, destinationNode, onProgress);
  }
}

// ============================================================================
// Simple Mix (fallback / unknown modes)
// ============================================================================

async function buildSimpleMixGraph(
  offlineCtx: OfflineAudioContext,
  sounds: TimelineSound[],
  config: SoundscapeExportConfig,
  fmt: FormatDescriptor,
  destinationNode: AudioNode,
  onProgress?: ExportProgressCallback
): Promise<void> {
  const { sourceRegistry, soundGains } = config;

  const masterGain = offlineCtx.createGain();
  masterGain.gain.value = 1.0;
  masterGain.connect(destinationNode);

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

    scheduleIterations(offlineCtx, resolveIterationBuffers(sound, sourceRegistry, config.iterationLinks), sound.scheduledIterations, gainNode, durationSecs(offlineCtx), config.soundTrims?.[sound.id]);
  }
}

// ============================================================================
// Output stage helpers
// ============================================================================

function setupRawAmbisonicOutput(
  offlineCtx: OfflineAudioContext,
  mixBus: GainNode,
  order: AmbisonicOrder,
  config: SoundscapeExportConfig,
  destinationNode: AudioNode,
  overrideOrientation?: Orientation | null,
): void {
  const numChannels = (order + 1) ** 2;
  const outputBus = offlineCtx.createGain();
  outputBus.channelCount = numChannels;
  outputBus.channelCountMode = 'explicit';
  outputBus.channelInterpretation = 'discrete';

  const sceneRotator = new ambisonics.sceneRotator(offlineCtx, order);

  let effectiveOrientation: Orientation;
  if (overrideOrientation !== undefined && overrideOrientation !== null) {
    effectiveOrientation = overrideOrientation;
  } else if (config.globalListenerOrientation) {
    effectiveOrientation = orientationFromForwardVector(config.globalListenerOrientation);
  } else {
    effectiveOrientation = config.listenerOrientation;
  }

  const RAD_TO_DEG = 180 / Math.PI;
  sceneRotator.yaw = -effectiveOrientation.yaw * RAD_TO_DEG;
  sceneRotator.pitch = -effectiveOrientation.pitch * RAD_TO_DEG;
  sceneRotator.roll = 0;
  sceneRotator.updateRotMtx();

  mixBus.connect(sceneRotator.in);
  sceneRotator.out.connect(outputBus);
  outputBus.connect(destinationNode);
}

function setupMonoWExtract(
  offlineCtx: OfflineAudioContext,
  mixBus: GainNode,
  numChannels: number,
  destinationNode: AudioNode,
): void {
  const splitter = offlineCtx.createChannelSplitter(numChannels);

  mixBus.connect(splitter);
  splitter.connect(destinationNode, 0, 0);
}

// ============================================================================
// Orientation helper
// ============================================================================

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
// Linked-Stereo Limiter (post-render)
// ============================================================================

interface LimiterEnvelope {
  attackTime: number;
  releaseTime: number;
  threshold: number;
}

const DEFAULT_LIMITER: LimiterEnvelope = {
  attackTime: 0.000001,
  releaseTime: 0.100,
  threshold: 0.501,
};

/**
 * Apply a linked-stereo brick-wall limiter to an AudioBuffer.
 *
 * Computes the peak of all channels, derives one gain-reduction coefficient,
 * and applies it to all channels simultaneously, preserving ILD.
 */
function applyLinkedLimiter(
  buffer: AudioBuffer,
  envelope: LimiterEnvelope = DEFAULT_LIMITER,
): AudioBuffer {
  const numChannels = buffer.numberOfChannels;
  const numSamples = buffer.length;
  const sampleRate = buffer.sampleRate;

  if (numChannels < 1 || numChannels > 2) {
    return buffer;
  }

  const channels = Array.from({ length: numChannels }, (_, c) =>
    new Float32Array(buffer.getChannelData(c)),
  );

  const dt = 1 / sampleRate;
  const attackCoeff = Math.exp(-dt / envelope.attackTime);
  const releaseCoeff = Math.exp(-dt / envelope.releaseTime);

  let smoothedGain = 1.0;

  for (let i = 0; i < numSamples; i++) {
    let peak = 0;
    for (let c = 0; c < numChannels; c++) {
      const absVal = Math.abs(channels[c][i]);
      if (absVal > peak) peak = absVal;
    }

    const targetGain = peak > envelope.threshold ? envelope.threshold / peak : 1.0;
    const coeff = targetGain < smoothedGain ? attackCoeff : releaseCoeff;
    smoothedGain = coeff * smoothedGain + (1 - coeff) * targetGain;

    for (let c = 0; c < numChannels; c++) {
      channels[c][i] *= smoothedGain;
    }
  }

  const result = new AudioBuffer({ length: numSamples, sampleRate, numberOfChannels: numChannels });
  for (let c = 0; c < numChannels; c++) {
    result.copyToChannel(channels[c] as Float32Array<ArrayBuffer>, c);
  }

  return result;
}

// ============================================================================
// Scheduling & helpers
// ============================================================================

/**
 * Resolve per-iteration AudioBuffers using iterationLinks to pick the correct
 * variant for each scheduled iteration. Falls back to the primary source buffer.
 */
function resolveIterationBuffers(
  sound: TimelineSound,
  sourceRegistry: Map<string, { buffer: AudioBuffer; position: Position }>,
  iterationLinks?: Record<string, IterationLink>,
): (AudioBuffer | undefined)[] {
  const primaryEntry = sourceRegistry.get(sound.id);
  const fallbackBuffer = primaryEntry?.buffer;
  const buffers: (AudioBuffer | undefined)[] = [];

  const scheduled = sound.scheduledIterations || [];
  const originalIndices = sound.scheduledIterationOriginalIndices || scheduled.map((_, i) => i);

  for (let i = 0; i < scheduled.length; i++) {
    const origIdx = originalIndices[i] ?? i;
    const link = iterationLinks?.[`${sound.id}-${origIdx}`];
    if (link?.variantIndex !== undefined && link.variantIndex > 0) {
      const variantId = resolveVariantId(sound.id, link.variantIndex);
      const variantEntry = sourceRegistry.get(variantId);
      buffers.push(variantEntry?.buffer || fallbackBuffer);
    } else {
      buffers.push(fallbackBuffer);
    }
  }
  return buffers;
}

/** Build a variant sound ID from primary ID + variant index. */
function resolveVariantId(primarySoundId: string, variantIndex: number): string {
  const parts = primarySoundId.split('_');
  if (parts[0] === 'generated' && parts.length >= 3) {
    const p = [...parts];
    p[p.length - 1] = String(variantIndex);
    return p.join('_');
  }
  if (parts[0] === 'tts' && parts.length >= 4) {
    const p = [...parts];
    p[2] = String(variantIndex);
    return p.join('_');
  }
  return primarySoundId;
}

function scheduleIterations(
  offlineCtx: OfflineAudioContext,
  buffers: (AudioBuffer | undefined)[],
  timestampsMs: number[],
  destination: AudioNode,
  maxDurationSecs: number,
  trim?: { start: number; end: number },
): void {
  const count = Math.min(buffers.length, timestampsMs.length);

  for (let i = 0; i < count; i++) {
    const tsMs = timestampsMs[i];
    const startSec = tsMs / 1000;
    if (startSec >= maxDurationSecs) continue;

    const buffer = buffers[i];
    if (!buffer) continue;

    const bufferDuration = buffer.duration;
    const offset = trim ? trim.start * bufferDuration : 0;
    const duration = trim ? (trim.end - trim.start) * bufferDuration : undefined;

    const src = offlineCtx.createBufferSource();
    src.buffer = buffer;
    src.connect(destination);
    if (duration !== undefined && duration > 0) {
      src.start(startSec, offset, duration);
    } else {
      src.start(startSec, offset);
    }
  }
}

function durationSecs(ctx: OfflineAudioContext): number {
  return ctx.length / ctx.sampleRate;
}

function getModeLabel(mode: AudioMode): string {
  switch (mode) {
    case AudioMode.ANECHOIC:        return 'anechoic';
    case AudioMode.AMBISONIC_IR:    return 'ir';
    case AudioMode.NO_IR_RESONANCE: return 'resonance';
    default:                        return 'mix';
  }
}

// ============================================================================
// 24-bit PCM WAV Encoding
// ============================================================================

function audioBufferToWavBlob24(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const { sampleRate, length: numSamples } = buffer;
  const bytesPerSample = 3;
  const dataByteLength = numChannels * numSamples * bytesPerSample;
  const headerByteLength = 44;
  const arrayBuffer = new ArrayBuffer(headerByteLength + dataByteLength);
  const view = new DataView(arrayBuffer);

  writeStr(view, 0,  'RIFF');
  view.setUint32(4,  headerByteLength + dataByteLength - 8, true);
  writeStr(view, 8,  'WAVE');
  writeStr(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1,  true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
  view.setUint16(32, numChannels * bytesPerSample, true);
  view.setUint16(34, 24, true);
  writeStr(view, 36, 'data');
  view.setUint32(40, dataByteLength, true);

  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) {
    channels.push(buffer.getChannelData(c));
  }

  let offset = headerByteLength;
  for (let i = 0; i < numSamples; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = Math.max(-1, Math.min(1, channels[c][i]));
      setInt24(view, offset, sample);
      offset += bytesPerSample;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

function setInt24(view: DataView, offset: number, value: number): void {
  const clamped = Math.max(-1, Math.min(1, value));
  const intVal = clamped < 0
    ? Math.round(clamped * 0x800000)
    : Math.round(clamped * 0x7FFFFF);
  view.setUint8(offset,     intVal & 0xFF);
  view.setUint8(offset + 1, (intVal >> 8) & 0xFF);
  view.setUint8(offset + 2, (intVal >> 16) & 0xFF);
}

function writeStr(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

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
