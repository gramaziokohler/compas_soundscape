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
 * - Coordinate system: Speckle Z-UP (+X=Right, -Y=Forward, +Z=Up)
 */

import type { IAudioMode } from '../core/interfaces/IAudioMode';
import type { AudioMode, Position, Orientation, AmbisonicOrder } from '@/types/audio';
import { cartesianToSpherical } from '../utils/ambisonic-utils';
import { AUDIO_CONTROL } from '@/utils/constants';

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
  private debug: boolean = false;
  private prevListenerPosition: Position | null = null;

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

    console.log(`[AnechoicMode] Initialized with JSAmbisonics (order ${this.ambisonicOrder}, ${this.numChannels} channels)`);

    if (this.debug && typeof window !== 'undefined') {
      (window as any).__anechoicMode = this;
    }
  }

  /** Maps a source world-space position to ambisonic spherical coordinates relative to listener. */
  private worldSpaceSpherical(sourcePos: Position, listenerPos: Position) {
    // Speckle Z-UP (+X=Right, -Y=Forward, +Z=Up) → Ambisonic Y-UP (+X=Front, +Y=Left, +Z=Up)
    return cartesianToSpherical({
      x: -(sourcePos.y - listenerPos.y),
      y: -(sourcePos.x - listenerPos.x),
      z:   sourcePos.z - listenerPos.z,
    });
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

    const spherical = this.worldSpaceSpherical(position, this.listenerPosition);

    // Negate azimuth: JSAmbisonics monoEncoder internal convention
    encoder.azim = -spherical.azimuth * (180 / Math.PI);
    encoder.elev = spherical.elevation * (180 / Math.PI);
    encoder.updateGains();

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
  }

  /**
   * Update source position using JSAmbisonics encoder
   */
  updateSourcePosition(sourceId: string, position: Position): void {
    const source = this.sources.get(sourceId);
    if (!source) {
      console.warn(`[AnechoicMode] Source ${sourceId} not found`);
      return;
    }

    source.position = position;

    const spherical = this.worldSpaceSpherical(position, this.listenerPosition);

    const refDistance = 1.0;
    const distance = Math.max(refDistance, spherical.distance);
    const distanceGain = refDistance / distance;

    // Negate azimuth: JSAmbisonics monoEncoder internal convention
    source.encoder.azim = -spherical.azimuth * (180 / Math.PI);
    source.encoder.elev = spherical.elevation * (180 / Math.PI);
    source.encoder.updateGains();

    if (source.distanceGainNode) {
      source.distanceGainNode.gain.setTargetAtTime(distanceGain, this.audioContext!.currentTime, 0.1);
    }
  }

  /**
   * Update listener position and orientation
   * Called every frame for camera movement
   */
  private _dbgFrame = 0;

  updateListener(position: Position, orientation: Orientation): void {
    const positionChanged =
      position.x !== this.listenerPosition.x ||
      position.y !== this.listenerPosition.y ||
      position.z !== this.listenerPosition.z;

    // Store plain-object snapshots — caller passes a live THREE.Vector3 mutated each frame
    this.listenerPosition = { x: position.x, y: position.y, z: position.z } as Position;
    this.listenerOrientation = orientation;

    this._dbgFrame++;

    // Re-encode only when listener moves; orientation is handled by OmnitoneDecoder.setRotationMatrix3
    if (positionChanged) {
      this.sources.forEach((source, sourceId) => {
        this.updateSourcePosition(sourceId, source.position);
      });
    }
  }

  /**
   * Start audio playback for a source
   * @param sourceId - Source identifier
   * @param loop - Whether to loop the audio
   * @param offset - Start playback from this position in seconds (default: 0)
   */
  playSource(sourceId: string, loop: boolean = false, offset: number = 0, duration?: number): void {
    if (!this.audioContext) {
      console.error('[AnechoicMode] No audio context');
      return;
    }

    const source = this.sources.get(sourceId);
    if (!source) {
      console.warn(`[AnechoicMode] playSource: source ${sourceId} not found`);
      return;
    }

    if (source.sourceNode) {
      source.sourceNode.stop();
      source.sourceNode.disconnect();
    }

    const sourceNode = this.audioContext.createBufferSource();
    sourceNode.buffer = source.audioBuffer;
    sourceNode.loop = loop;
    sourceNode.connect(source.gainNode);

    if (duration !== undefined && duration > 0) {
      sourceNode.start(0, offset, duration);
    } else {
      sourceNode.start(0, offset);
    }
    source.sourceNode = sourceNode;
    source.isPlaying = true;
    source.loop = loop;
    source.startTime = this.audioContext.currentTime;

    sourceNode.onended = () => {
      if (!source.loop) {
        source.isPlaying = false;
        source.sourceNode = null;
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
  }

  /**
   * Stop all audio sources immediately
   */
  stopAllSources(): void {
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
