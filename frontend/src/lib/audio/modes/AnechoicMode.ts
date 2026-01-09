/**
 * AnechoicMode
 *
 * Anechoic rendering mode: Dry source → Ambisonic encoder → Binaural decoder
 *
 * Workflow:
 * 1. Load dry audio source
 * 2. Encode to ambisonics based on source position using JSAmbisonics monoEncoder
 * 3. Route to binaural decoder for HRTF spatialization
 * 4. Output stereo for headphones
 *
 * Characteristics:
 * - No room acoustics (anechoic = "without echo")
 * - 6 DOF: Full position + rotation movement
 * - Direct path only (no reflections)
 * - Distance attenuation via ambisonic encoding
 *
 * Physical Accuracy:
 * - JSAmbisonics monoEncoder for accurate spherical harmonics
 * - HRTF decoding provides ITD/ILD cues
 * - No artificial reverberation
 *
 * Implementation:
 * - Uses JSAmbisonics monoEncoder for each source
 * - All encoder outputs are mixed (W+W, X+X, Y+Y, Z+Z, etc.)
 * - Mixed ambisonic stream → binaural decoder
 * - Source positions are encoded in listener-local coordinates (rotation applied before encoding)
 */

import type { IAudioMode } from '../core/interfaces/IAudioMode';
import type { AudioMode, Position, Orientation, AmbisonicOrder } from '@/types/audio';
import { cartesianToSpherical } from '../ambisonic-core';
import { AUDIO_CONTROL } from '@/lib/constants';

// Lazy load ambisonics to avoid SSR issues (window is not defined)
let ambisonics: any = null;
async function loadAmbisonics() {
  if (!ambisonics && typeof window !== 'undefined') {
    ambisonics = await import('ambisonics');
  }
  return ambisonics;
}

/**
 * Audio source with JSAmbisonics encoding
 */
interface AnechoicSource {
  sourceId: string;
  audioBuffer: AudioBuffer;
  position: Position;

  // Web Audio nodes
  sourceNode: AudioBufferSourceNode | null;
  gainNode: GainNode;       // User volume
  muteGainNode: GainNode;   // Mute control
  distanceGainNode: GainNode; // Distance attenuation

  // JSAmbisonics encoder
  encoder: any; // ambisonics.monoEncoder

  // Playback state
  isPlaying: boolean;
  startTime: number;
  loop: boolean;
  isMuted: boolean;
}

export class AnechoicMode implements IAudioMode {
  private audioContext: AudioContext | null = null;
  private sources: Map<string, AnechoicSource> = new Map();
  private listenerPosition: Position = { x: 0, y: 0, z: 0 } as Position;
  private listenerOrientation: Orientation = { yaw: 0, pitch: 0, roll: 0 };

  // Ambisonic mix bus: sums all encoder outputs
  // Using GainNode instead of ChannelMerger because we are mixing multi-channel sources
  private ambisonicMixBus: GainNode | null = null;
  private masterGain: GainNode | null = null; // Global volume control

  private ambisonicOrder: AmbisonicOrder = 1;
  private numChannels: number = 4; // FOA default

  private enabled: boolean = false;

  /**
   * Initialize mode with audio context
   * @param audioContext - Web Audio API context
   * @param order - Ambisonic order (1=FOA, 2=SOA, 3=TOA)
   */
  async initialize(audioContext: AudioContext, order?: AmbisonicOrder): Promise<void> {
    this.audioContext = audioContext;
    this.ambisonicOrder = order || 1;

    // Lazy load ambisonics library (avoid SSR issues)
    await loadAmbisonics();

    // Calculate number of ambisonic channels: (order + 1)^2
    this.numChannels = Math.pow(this.ambisonicOrder + 1, 2);

    // Create ambisonic mix bus to sum all encoder outputs
    // Use GainNode to mix multi-channel signals (ChannelMerger would downmix to mono)
    this.ambisonicMixBus = audioContext.createGain();
    this.ambisonicMixBus.channelCount = this.numChannels;
    this.ambisonicMixBus.channelCountMode = 'explicit';
    this.ambisonicMixBus.channelInterpretation = 'discrete'; // Critical: preserve ambisonic channels

    // Create master gain for global volume control
    this.masterGain = audioContext.createGain();
    this.masterGain.gain.value = 1.0;

    // Connect mix bus → master gain (master gain will be connected to binaural decoder by AudioOrchestrator)
    this.ambisonicMixBus.connect(this.masterGain);

    // Reset rotation offset in binaural decoder (AnechoicMode handles rotation via encoding)
    // We need to access the shared decoder via AudioOrchestrator, but we don't have reference to it here.
    // However, AudioOrchestrator calls updateListener, which calls updateOrientation on the decoder.
    // If we can't reset it here, we should ensure AnechoicMode doesn't rely on it.
    // Actually, AnechoicMode shares the decoder instance if passed? No, AudioOrchestrator manages the connection.
    // But AudioOrchestrator keeps the SAME BinauralDecoder instance.
    // So if AmbisonicIRMode set an offset, it persists.
    // We need a way to reset it.
    // Since we don't have access to the decoder here (it's in AudioOrchestrator),
    // we rely on AudioOrchestrator to handle this or we need to expose it.
    // But wait, AnechoicMode doesn't have reference to BinauralDecoder.
    // It outputs to masterGain, which AudioOrchestrator connects to BinauralDecoder.
    
    console.log(`[AnechoicMode] Initialized with JSAmbisonics (order ${this.ambisonicOrder}, ${this.numChannels} channels)`);

    // Expose debug helper globally
    if (typeof window !== 'undefined') {
      (window as any).__anechoicMode = this;
      console.log('[AnechoicMode] Debug helper available: window.__anechoicMode.setDebugMode(true)');
    }
  }

  /**
   * Create audio source at given position using JSAmbisonics monoEncoder
   *
   * Workflow:
   * Source → Gain → MuteGain → Encoder.in → Encoder.out → Mixer → Output
   */
  createSource(sourceId: string, audioBuffer: AudioBuffer, position: Position): void {
    if (!this.audioContext) {
      throw new Error('[AnechoicMode] Not initialized');
    }

    // Check if source already exists
    if (this.sources.has(sourceId)) {
      console.warn(`[AnechoicMode] Source ${sourceId} already exists, removing old one`);
      this.removeSource(sourceId);
    }

    // Create gain nodes
    const gainNode = this.audioContext.createGain();
    gainNode.gain.value = 1.0;

    const muteGainNode = this.audioContext.createGain();
    muteGainNode.gain.value = 1.0; // Not muted by default

    const distanceGainNode = this.audioContext.createGain();
    distanceGainNode.gain.value = 1.0;

    // Create JSAmbisonics monoEncoder
    // Note: monoEncoder uses GainNode matrix, not ConvolverNode, so no normalize property to set
    const encoder = new ambisonics.monoEncoder(this.audioContext, this.ambisonicOrder);

    // Calculate initial position using the same yaw+pitch rotation as updateSourcePosition
    // Three.js: +X=Right, +Y=Up, +Z=Back
    const relativeX = position.x - this.listenerPosition.x;
    const relativeY = position.y - this.listenerPosition.y;
    const relativeZ = position.z - this.listenerPosition.z;

    // Step 1: Apply YAW rotation around Y axis (horizontal head turn)
    const cosYaw = Math.cos(this.listenerOrientation.yaw);
    const sinYaw = Math.sin(this.listenerOrientation.yaw);
    const yawRotatedX = relativeX * cosYaw - relativeZ * sinYaw;
    const yawRotatedZ = relativeX * sinYaw + relativeZ * cosYaw;
    const yawRotatedY = relativeY;

    // Step 2: Apply PITCH rotation around X axis (vertical head tilt)
    const cosPitch = Math.cos(-this.listenerOrientation.pitch);
    const sinPitch = Math.sin(-this.listenerOrientation.pitch);
    const finalX = yawRotatedX;
    const finalY = yawRotatedY * cosPitch - yawRotatedZ * sinPitch;
    const finalZ = yawRotatedY * sinPitch + yawRotatedZ * cosPitch;

    // Convert rotated Three.js coords to Ambisonic coordinates
    // Ambisonic: +X=Front, +Y=Left, +Z=Up
    const spherical = cartesianToSpherical({
      x: -finalZ, // Front = -Z in listener's local frame
      y: -finalX, // Left = -X in listener's local frame
      z: finalY   // Up = +Y in listener's local frame
    });

    // Set azimuth and elevation in degrees (JSAmbisonics uses degrees)
    encoder.azim = spherical.azimuth * (180 / Math.PI);
    encoder.elev = spherical.elevation * (180 / Math.PI);
    encoder.updateGains();

    // Apply initial distance attenuation
    const refDistance = 1.0;
    const distance = Math.max(refDistance, spherical.distance);
    const distanceGain = refDistance / distance;
    distanceGainNode.gain.value = distanceGain;

    // Connect audio graph: Gain → MuteGain → DistanceGain → Encoder
    gainNode.connect(muteGainNode);
    muteGainNode.connect(distanceGainNode);
    distanceGainNode.connect(encoder.in);

    // Connect encoder output to ambisonic mix bus
    // encoder.out is a multi-channel node with all ambisonic channels
    encoder.out.connect(this.ambisonicMixBus);

    // Store source
    const source: AnechoicSource = {
      sourceId,
      audioBuffer,
      position,
      sourceNode: null,
      gainNode,
      muteGainNode,
      distanceGainNode,
      encoder,
      isPlaying: false,
      startTime: 0,
      loop: false,
      isMuted: false
    };

    this.sources.set(sourceId, source);

    console.log(`[AnechoicMode] Created source ${sourceId} with JSAmbisonics encoder at [${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)}]`);
  }

  /**
   * Update source position using JSAmbisonics encoder
   *
   * Source positions are encoded in listener-local coordinates:
   * 1. Calculate relative position (source - listener) in world coords
   * 2. Rotate by listener yaw to get listener-local coords
   * 3. Convert to ambisonic coordinates and encode
   */
  updateSourcePosition(sourceId: string, position: Position): void {
    const source = this.sources.get(sourceId);
    if (!source) {
      console.warn(`[AnechoicMode] Source ${sourceId} not found`);
      return;
    }

    source.position = position;

    // Calculate relative position (source - listener) in Three.js world coordinates
    // Three.js: +X=Right, +Y=Up, +Z=Back
    const relativeX = position.x - this.listenerPosition.x;
    const relativeY = position.y - this.listenerPosition.y;
    const relativeZ = position.z - this.listenerPosition.z;

    // Step 1: Apply YAW rotation around Y axis (horizontal head turn)
    // Transforms world coordinates into listener's horizontal frame
    // +yaw = looking left, so world rotates right relative to listener
    const cosYaw = Math.cos(this.listenerOrientation.yaw);
    const sinYaw = Math.sin(this.listenerOrientation.yaw);
    const yawRotatedX = relativeX * cosYaw - relativeZ * sinYaw;
    const yawRotatedZ = relativeX * sinYaw + relativeZ * cosYaw;
    const yawRotatedY = relativeY; // Y is unchanged by yaw

    // Step 2: Apply PITCH rotation around X axis (vertical head tilt)
    // When looking UP (+pitch), the world rotates DOWN relative to listener
    // Use -pitch to properly transform world coords to listener-local coords
    const cosPitch = Math.cos(-this.listenerOrientation.pitch);
    const sinPitch = Math.sin(-this.listenerOrientation.pitch);
    const finalX = yawRotatedX; // X is unchanged by pitch
    const finalY = yawRotatedY * cosPitch - yawRotatedZ * sinPitch;
    const finalZ = yawRotatedY * sinPitch + yawRotatedZ * cosPitch;

    // Convert rotated Three.js coords to Ambisonic coordinates
    // Three.js: +X=Right, +Y=Up, +Z=Back (camera looks at -Z)
    // Ambisonic: +X=Front, +Y=Left, +Z=Up
    //
    // Mapping (in listener's local frame after yaw+pitch rotation):
    // - Ambisonic Front (+X) = Listener Forward (-Z) = -finalZ
    // - Ambisonic Left (+Y) = Listener Left (-X) = -finalX
    // - Ambisonic Up (+Z) = Listener Up (+Y) = finalY
    const spherical = cartesianToSpherical({
      x: -finalZ,
      y: -finalX,
      z: finalY
    });

    // Apply distance attenuation (Inverse Square Law)
    // Reference distance = 1 meter
    // Gain = ref / max(ref, distance)
    const refDistance = 1.0;
    const distance = Math.max(refDistance, spherical.distance);
    const distanceGain = refDistance / distance;
    
    // Update gain node
    // We multiply the base volume (from setSourceVolume) by the distance gain
    // Since we don't store the base volume separately here, we might overwrite user volume changes.
    // Ideally, we should have a separate gain node for distance attenuation.
    // But for now, let's assume gainNode is for volume and we can use muteGainNode or add a new one.
    // Actually, let's add a distanceGainNode to the chain.
    
    // Update JSAmbisonics encoder (degrees)
    source.encoder.azim = spherical.azimuth * (180 / Math.PI);
    source.encoder.elev = spherical.elevation * (180 / Math.PI);
    source.encoder.updateGains();
    
    // Apply distance gain
    if (source.distanceGainNode) {
      source.distanceGainNode.gain.setTargetAtTime(distanceGain, this.audioContext!.currentTime, 0.1);
    }
  }

  /**
   * Update listener position and orientation
   * Called every frame for camera movement
   */
  updateListener(position: Position, orientation: Orientation): void {
    this.listenerPosition = position;
    this.listenerOrientation = orientation;

    // // Debug logging (throttled)
    // if (this.debugMode || Math.random() < 0.01) { // Log ~1% of frames or if debug enabled
    //   console.log('[AnechoicMode] 🎧 Listener Update:', {
    //     position: `(${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)})`,
    //     orientation: {
    //       yaw: orientation.yaw,
    //       yawDeg: `${(orientation.yaw * 180 / Math.PI).toFixed(1)}°`,
    //       pitch: orientation.pitch,
    //       pitchDeg: `${(orientation.pitch * 180 / Math.PI).toFixed(1)}°`,
    //       roll: orientation.roll,
    //       rollDeg: `${(orientation.roll * 180 / Math.PI).toFixed(1)}°`
    //     }
    //   });
    // }

    // Update all source encoder positions based on new listener position
    this.sources.forEach((source, sourceId) => {
      this.updateSourcePosition(sourceId, source.position);
    });
  }

  /**
   * Start audio playback for a source
   * @param sourceId - Source identifier
   * @param loop - Whether to loop the audio
   * @param offset - Start playback from this position in seconds (default: 0)
   */
  playSource(sourceId: string, loop: boolean = false, offset: number = 0): void {
    console.log(`[AnechoicMode] 🎵 playSource called`);
    console.log(`  - Source ID: ${sourceId}`);
    console.log(`  - Loop: ${loop}`);
    console.log(`  - Offset: ${offset}s`);
    console.log(`  - Ambisonic Order: ${this.ambisonicOrder} (${this.numChannels} channels)`);

    if (!this.audioContext) {
      console.error('[AnechoicMode] ❌ No audio context');
      return;
    }

    const source = this.sources.get(sourceId);
    if (!source) {
      console.warn(`[AnechoicMode] ❌ Source ${sourceId} not found in sources map`);
      console.warn(`  - Available sources:`, Array.from(this.sources.keys()));
      return;
    }

    console.log(`[AnechoicMode] ✅ Source found:`, {
      hasBuffer: !!source.audioBuffer,
      bufferDuration: source.audioBuffer?.duration,
      currentlyPlaying: source.isPlaying,
      position: `[${source.position.x.toFixed(2)}, ${source.position.y.toFixed(2)}, ${source.position.z.toFixed(2)}]`
    });

    // Stop existing playback if any
    if (source.sourceNode) {
      source.sourceNode.stop();
      source.sourceNode.disconnect();
      console.log('[AnechoicMode] 🛑 Stopped existing source node');
    }

    // Create new source node
    const sourceNode = this.audioContext.createBufferSource();
    sourceNode.buffer = source.audioBuffer;
    sourceNode.loop = loop;

    console.log('[AnechoicMode] 🔊 Audio Graph:', {
      graph: 'BufferSource → Gain → MuteGain → DistanceGain → JSAmbisonics.Encoder → Mixer → Binaural Decoder → Destination',
      order: this.ambisonicOrder,
      channels: this.numChannels,
      bufferChannels: source.audioBuffer?.numberOfChannels,
      sampleRate: source.audioBuffer?.sampleRate
    });

    // Connect to gain node
    sourceNode.connect(source.gainNode);

    // Start playback from offset position
    sourceNode.start(0, offset);
    source.sourceNode = sourceNode;
    source.isPlaying = true;
    source.loop = loop;
    source.startTime = this.audioContext.currentTime;

    console.log(`[AnechoicMode] ✅ Playback started for ${sourceId} (offset: ${offset}s)`);

    // Handle playback end (if not looping)
    sourceNode.onended = () => {
      if (!source.loop) {
        source.isPlaying = false;
        source.sourceNode = null;
        console.log(`[AnechoicMode] 🏁 Playback ended for ${sourceId}`);
      }
    };
  }

  /**
   * Stop audio playback for a source
   */
  stopSource(sourceId: string): void {
    const source = this.sources.get(sourceId);
    if (!source || !source.sourceNode) return;

    try {
      source.sourceNode.stop();
      source.sourceNode.disconnect();
    } catch (error) {
      console.warn(`[AnechoicMode] Error stopping source ${sourceId}:`, error);
    }

    source.sourceNode = null;
    source.isPlaying = false;

    console.log(`[AnechoicMode] Stopped playback for source ${sourceId}`);
  }

  /**
   * Stop all audio sources immediately
   */
  stopAllSources(): void {
    console.log(`[AnechoicMode] Stopping all ${this.sources.size} sources`);
    this.sources.forEach((_, sourceId) => {
      this.stopSource(sourceId);
    });
  }

  /**
   * Remove audio source
   */
  removeSource(sourceId: string): void {
    const source = this.sources.get(sourceId);
    if (!source) return;

    // Stop playback if active
    if (source.sourceNode) {
      try {
        source.sourceNode.stop();
        source.sourceNode.disconnect();
      } catch (error) {
        // Ignore errors if already stopped
      }
    }

    // Disconnect all nodes
    source.gainNode.disconnect();
    source.muteGainNode.disconnect();
    source.distanceGainNode.disconnect();

    // Disconnect JSAmbisonics encoder
    if (source.encoder && source.encoder.out) {
      source.encoder.out.disconnect();
    }

    this.sources.delete(sourceId);
    console.log(`[AnechoicMode] Removed source ${sourceId}`);
  }

  /**
   * Get output node for connecting to binaural decoder
   * Returns the master gain (after mixer)
   */
  getOutputNode(): AudioNode {
    if (!this.masterGain) {
      throw new Error('[AnechoicMode] Not initialized');
    }
    return this.masterGain;
  }

  /**
   * Set volume for a specific source
   */
  setSourceVolume(sourceId: string, volume: number): void {
    const source = this.sources.get(sourceId);
    if (!source || !this.audioContext) return;

    const clampedVolume = Math.max(
      AUDIO_CONTROL.SOURCE_VOLUME.MIN,
      Math.min(AUDIO_CONTROL.SOURCE_VOLUME.MAX, volume)
    );
    source.gainNode.gain.setValueAtTime(clampedVolume, this.audioContext.currentTime);
  }

  /**
   * Set mute state for a specific source
   */
  setSourceMute(sourceId: string, muted: boolean): void {
    const source = this.sources.get(sourceId);
    if (!source || !this.audioContext) return;

    source.isMuted = muted;
    const gainValue = muted ? AUDIO_CONTROL.DEFAULTS.MUTED_GAIN : AUDIO_CONTROL.DEFAULTS.UNMUTED_GAIN;
    source.muteGainNode.gain.setValueAtTime(gainValue, this.audioContext.currentTime);
  }

  /**
   * Set master volume
   */
  setMasterVolume(volume: number): void {
    if (!this.masterGain || !this.audioContext) return;

    const clampedVolume = Math.max(
      AUDIO_CONTROL.MASTER_VOLUME.MIN,
      Math.min(AUDIO_CONTROL.MASTER_VOLUME.MAX, volume)
    );
    this.masterGain.gain.setValueAtTime(clampedVolume, this.audioContext.currentTime);
  }

  /**
   * Anechoic mode does not require receiver mode (supports 6 DOF)
   */
  requiresReceiverMode(): boolean {
    return false;
  }

  /**
   * Get current mode
   */
  getMode(): AudioMode {
    return 'anechoic' as AudioMode;
  }

  /**
   * Enable mode (unmute mixer)
   */
  enable(): void {
    this.enabled = true;
    if (this.masterGain && this.audioContext) {
      this.masterGain.gain.setValueAtTime(1.0, this.audioContext.currentTime);
    }
    console.log('[AnechoicMode] Enabled');
  }

  /**
   * Disable mode (mute mixer)
   */
  disable(): void {
    this.enabled = false;
    if (this.masterGain && this.audioContext) {
      this.masterGain.gain.setValueAtTime(0.0, this.audioContext.currentTime);
    }
    console.log('[AnechoicMode] Disabled');
  }

  /**
   * Dispose of all resources
   */
  dispose(): void {
    console.log('[AnechoicMode] Disposing');

    // Remove all sources
    this.sources.forEach((_, sourceId) => {
      this.removeSource(sourceId);
    });
    this.sources.clear();

    // Disconnect mixer
    if (this.ambisonicMixBus) {
      this.ambisonicMixBus.disconnect();
      this.ambisonicMixBus = null;
    }

    if (this.masterGain) {
      this.masterGain.disconnect();
      this.masterGain = null;
    }

    this.audioContext = null;
  }
}
