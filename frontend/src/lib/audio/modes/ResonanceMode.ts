/**
 * ResonanceMode
 *
 * Resonance Audio mode providing synthetic room acoustics.
 * Uses Google's Resonance Audio library for realistic spatialization with room acoustics.
 *
 * Workflow:
 * - Source → Resonance Source → Resonance Scene (room acoustics) → Output
 * - Dynamic library loading (browser-only)
 * - Configurable room materials and dimensions
 * - High-order ambisonics (up to 3rd order)
 * - HRTF-based binaural rendering
 *
 * Characteristics:
 * - 6 DOF: Full position + rotation movement
 * - Synthetic room acoustics (early reflections + late reverb)
 * - Distance attenuation models
 * - Directivity patterns for sources
 *
 * Note: This is a wrapper around the resonance-audio library.
 * The library is dynamically imported to avoid SSR issues.
 */

import type { IAudioMode } from '../core/interfaces/IAudioMode';
import type { Position, Orientation } from '@/types/audio';
import { AudioMode } from '@/types/audio';
import { AUDIO_CONTROL, DEFAULT_SPEED_OF_SOUND } from '@/utils/constants';

// Dynamic import type
type ResonanceAudioClass = any;

// Default configuration
const DEFAULT_ROOM_DIMENSIONS = { width: 10, height: 3, depth: 10 };
const DEFAULT_ROOM_MATERIALS = {
  left: 'acoustic-ceiling-tiles',
  right: 'brick-bare',
  front: 'brick-bare',
  back: 'brick-bare',
  down: 'parquet-on-concrete',
  up: 'brick-bare'
};
const DEFAULT_AMBISONIC_ORDER = 3;
const DEFAULT_ROLLOFF = 'logarithmic';
const DEFAULT_MIN_DISTANCE = 1;
const DEFAULT_MAX_DISTANCE = 10000;

/**
 * Padding added to each side of the bounding box when computing room dimensions.
 * Ensures sources near the edges are still inside the Resonance Audio room
 * (the library silences room effects when sources are >1m outside).
 */
const ROOM_BOUNDS_PADDING = 2.0;

export class ResonanceMode implements IAudioMode {
  private audioContext: AudioContext | null = null;
  private resonanceAudioScene: any | null = null; // ResonanceAudio scene instance
  private ResonanceAudio: ResonanceAudioClass | null = null; // Class reference
  private masterGain: GainNode | null = null;
  private enabled: boolean = true;
  private speedOfSound: number = DEFAULT_SPEED_OF_SOUND;

  // Track current room properties
  private currentRoomDimensions: any = DEFAULT_ROOM_DIMENSIONS;
  private currentRoomMaterials: any = DEFAULT_ROOM_MATERIALS;

  /**
   * Offset applied to all positions so that the bounding box center maps to the
   * Resonance Audio room origin.  Resonance Audio always centers its room at (0,0,0),
   * so we translate every world-space position by subtracting this offset.
   */
  private roomCenterOffset: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 };

  // Track Resonance Audio sources
  private resonanceSources: Map<string, {
    source: any; // ResonanceAudio.Source
    buffer: AudioBuffer;
    position: { x: number; y: number; z: number };
    sourceNode: AudioBufferSourceNode | null;
    gainNode: GainNode;
    muteGainNode: GainNode;
    isPlaying: boolean;
    isMuted: boolean;
  }> = new Map();

  /**
   * Load Resonance Audio library dynamically (browser-only)
   */
  private async loadResonanceAudio(): Promise<void> {
    if (this.ResonanceAudio) return; // Already loaded

    if (typeof window === 'undefined') {
      throw new Error('[ResonanceMode] Cannot load in SSR environment');
    }

    try {
      // Dynamic import
      const module: any = await import('resonance-audio');

      if (module.default && typeof module.default.ResonanceAudio === 'function') {
        this.ResonanceAudio = module.default.ResonanceAudio;
      } else if (typeof module.default === 'function') {
        this.ResonanceAudio = module.default;
      } else {
        console.error('[ResonanceMode] Unexpected module structure:', module);
        throw new Error('[ResonanceMode] Cannot find ResonanceAudio constructor');
      }

      console.log('[ResonanceMode] Library loaded successfully');
    } catch (error) {
      console.error('[ResonanceMode] Failed to load library:', error);
      throw error;
    }
  }

  /**
   * Initialize Resonance Audio scene
   */
  async initialize(audioContext: AudioContext, speedOfSound: number = DEFAULT_SPEED_OF_SOUND): Promise<void> {
    this.audioContext = audioContext;
    this.speedOfSound = speedOfSound;

    try {
      console.log('[ResonanceMode] Initializing...');

      // Load library
      await this.loadResonanceAudio();

      if (!this.ResonanceAudio) {
        throw new Error('[ResonanceMode] Library not loaded');
      }

      // Create Resonance Audio scene
      this.resonanceAudioScene = new this.ResonanceAudio(audioContext, {
        ambisonicOrder: DEFAULT_AMBISONIC_ORDER,
        speedOfSound: this.speedOfSound,
      });

      // Set room properties
      this.resonanceAudioScene.setRoomProperties(
        DEFAULT_ROOM_DIMENSIONS,
        DEFAULT_ROOM_MATERIALS
      );

      // Create master gain
      this.masterGain = audioContext.createGain();
      this.masterGain.gain.value = 1.0;

      // Connect: Resonance scene → master gain → destination
      this.resonanceAudioScene.output.connect(this.masterGain);
      this.masterGain.connect(audioContext.destination);

      console.log('[ResonanceMode] Initialized successfully');
      console.log('  - Room dimensions:', DEFAULT_ROOM_DIMENSIONS);
      console.log('  - Ambisonic order:', DEFAULT_AMBISONIC_ORDER);
    } catch (error) {
      console.error('[ResonanceMode] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Create audio source at given position
   */
  createSource(
    sourceId: string,
    audioBuffer: AudioBuffer,
    position: Position
  ): void {
    if (!this.resonanceAudioScene || !this.audioContext) {
      throw new Error('[ResonanceMode] Not initialized');
    }

    // Remove existing source if present
    if (this.resonanceSources.has(sourceId)) {
      this.removeSource(sourceId);
    }

    try {
      // Create Resonance Audio source
      const resonanceSource = this.resonanceAudioScene.createSource();

      // Create gain nodes for volume and mute control
      const gainNode = this.audioContext.createGain();
      gainNode.gain.value = 1.0;

      const muteGainNode = this.audioContext.createGain();
      muteGainNode.gain.value = 1.0; // Not muted by default

      // Configure source properties
      resonanceSource.setRolloff(DEFAULT_ROLLOFF);
      resonanceSource.setMinDistance(DEFAULT_MIN_DISTANCE);
      resonanceSource.setMaxDistance(DEFAULT_MAX_DISTANCE);
      resonanceSource.setGain(1.0);

      // Set initial position (offset by room center so it's relative to room origin)
      resonanceSource.setPosition(
        position.x - this.roomCenterOffset.x,
        position.y - this.roomCenterOffset.y,
        position.z - this.roomCenterOffset.z
      );

      // Store source info
      this.resonanceSources.set(sourceId, {
        source: resonanceSource,
        buffer: audioBuffer,
        position: { x: position.x, y: position.y, z: position.z },
        sourceNode: null,
        gainNode,
        muteGainNode,
        isPlaying: false,
        isMuted: false
      });

      console.log(`[ResonanceMode] Created source: ${sourceId} at (${position.x.toFixed(1)}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)})`);
    } catch (error) {
      console.error(`[ResonanceMode] Error creating source ${sourceId}:`, error);
      throw error;
    }
  }

  /**
   * Play a source
   * @param sourceId - Source identifier
   * @param loop - Whether to loop the audio
   * @param offset - Start playback from this position in seconds (default: 0)
   */
  playSource(sourceId: string, loop: boolean = false, offset: number = 0, duration?: number): void {
    const source = this.resonanceSources.get(sourceId);
    if (!source || !this.audioContext) {
      console.warn(`[ResonanceMode] Cannot play source ${sourceId}`);
      return;
    }

    // Stop if already playing
    if (source.isPlaying && source.sourceNode) {
      source.sourceNode.stop();
      source.sourceNode.disconnect();
      source.sourceNode = null;
    }

    // Create new source node
    const sourceNode = this.audioContext.createBufferSource();
    sourceNode.buffer = source.buffer;
    sourceNode.loop = loop;

    // Connect: sourceNode → gainNode → muteGainNode → Resonance source input
    sourceNode.connect(source.gainNode);
    source.gainNode.connect(source.muteGainNode);
    source.muteGainNode.connect(source.source.input);

    // Set up ended callback
    sourceNode.onended = () => {
      if (!loop) {
        source.isPlaying = false;
        source.sourceNode = null;
      }
    };

    // Start playback from offset position, optionally limited to trim duration
    if (duration !== undefined && duration > 0) {
      sourceNode.start(0, offset, duration);
    } else {
      sourceNode.start(0, offset);
    }
    source.sourceNode = sourceNode;
    source.isPlaying = true;

    console.log(`[ResonanceMode] Playing source: ${sourceId} (loop: ${loop}, offset: ${offset}s, duration: ${duration ?? 'full'}s)`);
  }

  /**
   * Stop a source
   */
  stopSource(sourceId: string): void {
    const source = this.resonanceSources.get(sourceId);
    if (!source || !source.sourceNode) {
      return;
    }

    try {
      source.sourceNode.stop();
      source.sourceNode.disconnect();
    } catch (error) {
      console.debug(`[ResonanceMode] Stop error for ${sourceId}:`, error);
    }

    source.sourceNode = null;
    source.isPlaying = false;
  }

  /**
   * Stop all audio sources immediately
   */
  stopAllSources(): void {
    console.log(`[ResonanceMode] Stopping all ${this.resonanceSources.size} sources`);
    this.resonanceSources.forEach((_, sourceId) => {
      this.stopSource(sourceId);
    });
  }

  /**
   * Update source position
   */
  updateSourcePosition(sourceId: string, position: Position): void {
    const source = this.resonanceSources.get(sourceId);
    if (!source) {
      return;
    }

    source.source.setPosition(
      position.x - this.roomCenterOffset.x,
      position.y - this.roomCenterOffset.y,
      position.z - this.roomCenterOffset.z
    );
    source.position = { x: position.x, y: position.y, z: position.z };
  }

  /**
   * Remove a source
   */
  removeSource(sourceId: string): void {
    const source = this.resonanceSources.get(sourceId);
    if (!source) {
      return;
    }

    // Stop if playing
    this.stopSource(sourceId);

    // Resonance Audio sources don't have explicit cleanup
    // Just remove from tracking
    this.resonanceSources.delete(sourceId);
    console.log(`[ResonanceMode] Removed source: ${sourceId}`);
  }

  /**
   * Update listener position and orientation
   */
  updateListener(position: Position, orientation: Orientation): void {
    if (!this.resonanceAudioScene) {
      return;
    }

    try {
      // Offset by room center so the listener is relative to the room origin
      this.resonanceAudioScene.setListenerPosition(
        position.x - this.roomCenterOffset.x,
        position.y - this.roomCenterOffset.y,
        position.z - this.roomCenterOffset.z
      );

      // Convert Euler angles to forward and up vectors
      // Use positive yaw (matching AnechoicMode's coordinate transformation)
      const forward = {
        x: Math.sin(orientation.yaw) * Math.cos(orientation.pitch),
        y: -Math.cos(orientation.yaw) * Math.cos(orientation.pitch),
        z: Math.sin(orientation.pitch)
      };

      const up = {
        x: Math.sin(orientation.roll),
        y: 0,
        z: Math.cos(orientation.roll)
      };

      this.resonanceAudioScene.setListenerOrientation(
        forward.x, forward.y, forward.z,
        up.x, up.y, up.z
      );
    } catch (error) {
      console.error('[ResonanceMode] Error updating listener:', error);
    }
  }

  /**
   * Get output node (master gain)
   */
  getOutputNode(): AudioNode {
    if (!this.masterGain) {
      throw new Error('[ResonanceMode] Not initialized');
    }
    return this.masterGain;
  }

  /**
   * Get mode type
   */
  getMode(): AudioMode {
    return AudioMode.NO_IR_RESONANCE;
  }

  /**
   * Enable the mode
   */
  enable(): void {
    this.enabled = true;
    if (this.masterGain && this.audioContext) {
      this.masterGain.gain.setValueAtTime(1, this.audioContext.currentTime);
    }
  }

  /**
   * Disable the mode
   */
  disable(): void {
    this.enabled = false;
    if (this.masterGain && this.audioContext) {
      this.masterGain.gain.setValueAtTime(0, this.audioContext.currentTime);
    }
  }

  /**
   * Resonance mode does NOT require receiver mode (6 DOF)
   */
  requiresReceiverMode(): boolean {
    return false;
  }

  /**
   * Set volume for a specific source
   */
  setSourceVolume(sourceId: string, volume: number): void {
    const source = this.resonanceSources.get(sourceId);
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
    const source = this.resonanceSources.get(sourceId);
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
   * Update room properties (optional configuration method)
   */
  setRoomProperties(dimensions: any, materials: any): void {
    if (!this.resonanceAudioScene) {
      console.warn('[ResonanceMode] Cannot set room properties - not initialized');
      return;
    }

    try {
      this.currentRoomDimensions = dimensions;
      this.currentRoomMaterials = materials;
      this.resonanceAudioScene.setRoomProperties(dimensions, materials);
      console.log('[ResonanceMode] Room properties updated:', { dimensions, materials });
    } catch (error) {
      console.error('[ResonanceMode] Error setting room properties:', error);
    }
  }

  /**
   * Set room bounds from the model bounding box.
   *
   * Computes room dimensions (with padding) and a center offset so that all
   * world-space positions are translated to be relative to the Resonance Audio
   * room origin.  Existing sources are repositioned accordingly.
   *
   * @param min - Bounding box min corner [x, y, z]
   * @param max - Bounding box max corner [x, y, z]
   */
  setRoomBounds(
    min: [number, number, number],
    max: [number, number, number]
  ): void {
    if (!this.resonanceAudioScene) {
      console.warn('[ResonanceMode] Cannot set room bounds - not initialized');
      return;
    }

    // Compute center offset
    this.roomCenterOffset = {
      x: (min[0] + max[0]) / 2,
      y: (min[1] + max[1]) / 2,
      z: (min[2] + max[2]) / 2
    };

    // Compute dimensions with padding on each side
    const dimensions = {
      width:  (max[0] - min[0]) + ROOM_BOUNDS_PADDING * 2,
      height: (max[1] - min[1]) + ROOM_BOUNDS_PADDING * 2,
      depth:  (max[2] - min[2]) + ROOM_BOUNDS_PADDING * 2
    };

    // Apply to Resonance Audio scene
    this.currentRoomDimensions = dimensions;
    this.resonanceAudioScene.setRoomProperties(dimensions, this.currentRoomMaterials);

    console.log('[ResonanceMode] Room bounds updated from model bounding box:', {
      min, max,
      center: this.roomCenterOffset,
      dimensions
    });

    // Re-position all existing sources using the new offset
    this.resonanceSources.forEach((source, sourceId) => {
      source.source.setPosition(
        source.position.x - this.roomCenterOffset.x,
        source.position.y - this.roomCenterOffset.y,
        source.position.z - this.roomCenterOffset.z
      );
    });
  }

  /**
   * Get current room dimensions
   */
  getRoomDimensions(): any {
    return { ...this.currentRoomDimensions };
  }

  /**
   * Get current room materials
   */
  getRoomMaterials(): any {
    return { ...this.currentRoomMaterials };
  }

  /**
   * Update speed of sound and reinitialize the Resonance Audio scene.
   * Existing sources are re-registered so live playback is preserved.
   */
  async setSpeedOfSound(c: number): Promise<void> {
    if (!this.audioContext || !this.ResonanceAudio) return;
    this.speedOfSound = c;

    // Snapshot existing sources so we can re-add them after reinit
    const existingSources = Array.from(this.resonanceSources.entries());

    // Disconnect old scene
    if (this.resonanceAudioScene) {
      try { this.resonanceAudioScene.output.disconnect(); } catch { /* ignore */ }
    }

    // Remove all sources from old scene
    existingSources.forEach(([id]) => this.removeSource(id));

    // Create a fresh scene with updated speed of sound
    this.resonanceAudioScene = new this.ResonanceAudio(this.audioContext, {
      ambisonicOrder: DEFAULT_AMBISONIC_ORDER,
      speedOfSound: this.speedOfSound,
    });
    this.resonanceAudioScene.setRoomProperties(this.currentRoomDimensions, this.currentRoomMaterials);
    if (this.masterGain) {
      this.resonanceAudioScene.output.connect(this.masterGain);
    }

    // Re-add sources
    for (const [id, src] of existingSources) {
      await this.addSource(id, src.buffer, src.position);
    }
  }

  /**
   * Dispose of all resources
   */
  dispose(): void {
    console.log('[ResonanceMode] Disposing');

    // Stop and remove all sources
    const sourceIds = Array.from(this.resonanceSources.keys());
    sourceIds.forEach(id => this.removeSource(id));

    // Disconnect master gain
    if (this.masterGain) {
      try {
        this.masterGain.disconnect();
      } catch (error) {
        console.debug('[ResonanceMode] Disconnect error:', error);
      }
      this.masterGain = null;
    }

    this.resonanceSources.clear();
    this.resonanceAudioScene = null;
    this.audioContext = null;
  }
}

