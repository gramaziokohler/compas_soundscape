/**
 * MonoIRMode - Phase 3 Implementation (2.1)
 *
 * Mono impulse response convolution with ambisonic encoding and binaural decoding.
 *
 * Pipeline:
 * For each source:
 *   1. Dry Source → ConvolverNode (mono IR)
 *   2. ConvolverNode → GainNode (wet signal)
 *   3. GainNode → JSAmbisonics monoEncoder (position-based, FOA/SOA/TOA)
 *   4. Encoder → [Ambisonic Channel Merger]
 *
 * All sources summed:
 *   5. Merged Ambisonic → Binaural Decoder (with rotation) → Stereo Output
 *
 * Characteristics:
 * - 3 DOF: Head rotation only (receiver mode required, position LOCKED)
 * - Per-source mono IR convolution
 * - Position-based ambisonic encoding (wet signal appears from source direction)
 * - HRTF-based binaural decoding with head tracking
 * - Physically accurate: Reverb spatially encoded based on source positions
 *
 * Implementation:
 * - Uses JSAmbisonics monoEncoder for accurate spherical harmonics
 * - Uses BinauralDecoder for HRTF convolution and scene rotation
 * - Supports FOA (1st order), SOA (2nd order), and TOA (3rd order) ambisonic encoding
 * - Each source has independent convolver + encoder
 * - Real-time position updates affect encoder gains
 */

import type { IAudioMode } from '../core/interfaces/IAudioMode';
import type { Position, Orientation, AmbisonicOrder } from '@/types/audio';
import { AudioMode } from '@/types/audio';
import { BinauralDecoder } from '../decoders/BinauralDecoder';
import { cartesianToSpherical } from '../ambisonic-core';
import { AUDIO_CONTROL, AMBISONIC } from '@/lib/constants';
import { processImpulseResponse } from '../ir-utils';

// Lazy load ambisonics to avoid SSR issues (window is not defined)
let ambisonics: any = null;
async function loadAmbisonics() {
  if (!ambisonics && typeof window !== 'undefined') {
    ambisonics = await import('ambisonics');
  }
  return ambisonics;
}

/**
 * Per-source audio chain for mono IR convolution + ambisonic encoding
 */
interface SourceChain {
  sourceId: string;
  audioBuffer: AudioBuffer;
  bufferSource: AudioBufferSourceNode | null;

  // Volume and mute control
  gainNode: GainNode;
  muteGainNode: GainNode;

  // Convolution chain
  convolver: ConvolverNode;
  wetGain: GainNode;

  // JSAmbisonics encoder
  encoder: any; // ambisonics.monoEncoder

  // Source state
  position: Position;
  isPlaying: boolean;
  isMuted: boolean;
}

export class MonoIRMode implements IAudioMode {
  private audioContext: AudioContext | null = null;
  private enabled: boolean = false;
  private irBuffer: AudioBuffer | null = null;

  // Ambisonic configuration
  private ambisonicOrder: AmbisonicOrder = 1; // Default to FOA
  private numAmbisonicChannels: number = 4; // FOA = 4 channels

  // Binaural decoder (HRTF-based with head tracking)
  private binauralDecoder: BinauralDecoder | null = null;

  // Ambisonic channel merger (sums all encoded sources)
  private ambisonicMerger: ChannelMergerNode | null = null;

  // Master output gain
  private masterGain: GainNode | null = null;

  // Boost gain (separate from master to avoid setMasterVolume overwriting)
  private boostGain: GainNode | null = null;

  // Per-source chains (convolution + encoding)
  private sourceChains: Map<string, SourceChain> = new Map();

  // Receiver mode lock (position fixed, only rotation allowed)
  private receiverPosition: Position | null = null;

  /**
   * Initialize mono IR mode
   */
  async initialize(audioContext: AudioContext): Promise<void> {
    this.audioContext = audioContext;

    // Lazy load ambisonics library (avoid SSR issues)
    await loadAmbisonics();

    // Create binaural decoder (FOA by default)
    this.binauralDecoder = new BinauralDecoder();
    await this.binauralDecoder.initialize(audioContext, this.ambisonicOrder);

    // Create ambisonic merger (sums all encoded sources)
    this.numAmbisonicChannels = Math.pow(this.ambisonicOrder + 1, 2);
    this.ambisonicMerger = audioContext.createChannelMerger(this.numAmbisonicChannels);

    // Create master gain (user-controlled volume)
    this.masterGain = audioContext.createGain();
    this.masterGain.gain.value = AUDIO_CONTROL.DEFAULTS.UNITY_GAIN;

    // Create boost gain (fixed compensation, not affected by setMasterVolume)
    this.boostGain = audioContext.createGain();
    this.boostGain.gain.value = AMBISONIC.MONO_IR_BOOST;

    // Connect pipeline: Merger → Binaural Decoder → Boost Gain → Master Gain → Destination
    this.ambisonicMerger.connect(this.binauralDecoder.getInputNode());
    this.binauralDecoder.getOutputNode().connect(this.boostGain);
    this.boostGain.connect(this.masterGain);
    this.masterGain.connect(audioContext.destination);

    console.log(`[MonoIRMode] Initialized with JSAmbisonics (order ${this.ambisonicOrder}, ${this.numAmbisonicChannels} channels, boost: ${AMBISONIC.MONO_IR_BOOST}x)`);
  }

  /**
   * Set mono impulse response buffer
   */
  setImpulseResponse(irBuffer: AudioBuffer): void {
    if (!this.audioContext) {
      throw new Error('[MonoIRMode] Cannot set IR - not initialized');
    }

    if (irBuffer.numberOfChannels !== 1) {
      throw new Error(`[MonoIRMode] Expected mono IR, got ${irBuffer.numberOfChannels} channels`);
    }

    // Process IR buffer (resample if needed, normalize)
    const processedBuffer = processImpulseResponse(irBuffer, this.audioContext, true);

    this.irBuffer = processedBuffer;

    // Update all existing convolvers with new IR
    this.sourceChains.forEach((chain) => {
      chain.convolver.buffer = processedBuffer;
    });

    console.log(`[MonoIRMode] IR buffer set (${processedBuffer.length} samples @ ${processedBuffer.sampleRate}Hz)`);
  }

  /**
   * Set ambisonic order (FOA, SOA, or TOA)
   */
  async setAmbisonicOrder(order: AmbisonicOrder): Promise<void> {
    if (order === this.ambisonicOrder || !this.audioContext || !this.binauralDecoder) {
      return;
    }

    console.log(`[MonoIRMode] Switching ambisonic order from ${this.ambisonicOrder} to ${order}`);

    const wasPlaying = this.enabled;
    if (wasPlaying) {
      this.disable();
    }

    // Update order and channel count
    this.ambisonicOrder = order;
    this.numAmbisonicChannels = Math.pow(order + 1, 2);

    // Recreate binaural decoder with new order
    await this.binauralDecoder.setOrder(order);

    // Recreate ambisonic merger with new channel count
    if (this.ambisonicMerger) {
      this.ambisonicMerger.disconnect();
    }
    this.ambisonicMerger = this.audioContext.createChannelMerger(this.numAmbisonicChannels);

    // Reconnect pipeline
    this.ambisonicMerger.connect(this.binauralDecoder.getInputNode());

    // Recreate all source encoders with new order
    const sourceStates = Array.from(this.sourceChains.values()).map(chain => ({
      sourceId: chain.sourceId,
      audioBuffer: chain.audioBuffer,
      position: chain.position,
      isPlaying: chain.isPlaying
    }));

    // Clear old chains
    this.sourceChains.forEach(chain => this.cleanupSourceChain(chain));
    this.sourceChains.clear();

    // Recreate chains
    sourceStates.forEach(state => {
      this.createSource(state.sourceId, state.audioBuffer, state.position);
      if (state.isPlaying && wasPlaying) {
        // Will be restarted when enabled
      }
    });

    if (wasPlaying) {
      this.enable();
    }

    console.log(`[MonoIRMode] Ambisonic order switched to ${order} (${this.numAmbisonicChannels} channels)`);
  }

  /**
   * Create a new audio source with convolution + JSAmbisonics encoding
   */
  createSource(sourceId: string, audioBuffer: AudioBuffer, position: Position): void {
    if (!this.audioContext || !this.irBuffer) {
      console.error('[MonoIRMode] Cannot create source - not initialized or no IR');
      return;
    }

    // Remove existing chain if any
    if (this.sourceChains.has(sourceId)) {
      this.removeSource(sourceId);
    }

    // Create convolver node
    const convolver = this.audioContext.createConvolver();
    convolver.normalize = false;
    convolver.buffer = this.irBuffer;

    // Create gain nodes for volume and mute control
    const gainNode = this.audioContext.createGain();
    gainNode.gain.value = AUDIO_CONTROL.DEFAULTS.UNITY_GAIN; // Unity gain for physically accurate convolution

    const muteGainNode = this.audioContext.createGain();
    muteGainNode.gain.value = AUDIO_CONTROL.DEFAULTS.UNMUTED_GAIN; // Not muted by default

    // Create wet gain node
    const wetGain = this.audioContext.createGain();
    wetGain.gain.value = AUDIO_CONTROL.DEFAULTS.UNITY_GAIN;

    // Create JSAmbisonics monoEncoder for this source
    const encoder = new ambisonics.monoEncoder(this.audioContext, this.ambisonicOrder);

    // Set initial position (relative to listener, which defaults to origin)
    const listenerPos = this.receiverPosition || { x: 0, y: 0, z: 0 };
    const spherical = cartesianToSpherical({
      x: position.x - listenerPos.x,
      y: position.y - listenerPos.y,
      z: position.z - listenerPos.z
    });

    // Set azimuth and elevation in degrees (JSAmbisonics uses degrees)
    encoder.azim = spherical.azimuth * (180 / Math.PI);
    encoder.elev = spherical.elevation * (180 / Math.PI);
    encoder.updateGains();

    // Connect: Convolver → gainNode → muteGainNode → Wet Gain → Encoder
    convolver.connect(gainNode);
    gainNode.connect(muteGainNode);
    muteGainNode.connect(wetGain);
    wetGain.connect(encoder.in);

    // Connect encoder output to ambisonic mixer
    // encoder.out is a multi-channel node with all ambisonic channels
    encoder.out.connect(this.ambisonicMerger!);

    // Store source chain
    const chain: SourceChain = {
      sourceId,
      audioBuffer,
      bufferSource: null,
      gainNode,
      muteGainNode,
      convolver,
      wetGain,
      encoder,
      position,
      isPlaying: false,
      isMuted: false
    };

    this.sourceChains.set(sourceId, chain);

    console.log(`[MonoIRMode] Created source "${sourceId}" with JSAmbisonics encoder at position (${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)})`);
  }

  /**
   * Update source position (affects ambisonic encoding)
   */
  updateSourcePosition(sourceId: string, position: Position): void {
    const chain = this.sourceChains.get(sourceId);
    if (!chain) {
      console.warn(`[MonoIRMode] Source "${sourceId}" not found for position update`);
      return;
    }

    // Update position
    chain.position = position;

    // Calculate relative position (source - listener)
    const listenerPos = this.receiverPosition || { x: 0, y: 0, z: 0 };
    const spherical = cartesianToSpherical({
      x: position.x - listenerPos.x,
      y: position.y - listenerPos.y,
      z: position.z - listenerPos.z
    });

    // Update JSAmbisonics encoder (degrees)
    chain.encoder.azim = spherical.azimuth * (180 / Math.PI);
    chain.encoder.elev = spherical.elevation * (180 / Math.PI);
    chain.encoder.updateGains();
  }

  /**
   * Remove audio source and clean up its chain
   */
  removeSource(sourceId: string): void {
    const chain = this.sourceChains.get(sourceId);
    if (!chain) {
      return;
    }

    // Stop if playing
    if (chain.bufferSource && chain.isPlaying) {
      try {
        chain.bufferSource.stop();
      } catch (error) {
        // Already stopped
      }
    }

    // Cleanup nodes
    this.cleanupSourceChain(chain);

    // Remove from map
    this.sourceChains.delete(sourceId);

    console.log(`[MonoIRMode] Removed source "${sourceId}"`);
  }

  /**
   * Start audio playback for a source
   * @param sourceId - Source identifier
   * @param loop - Whether to loop the audio
   * @param offset - Start playback from this position in seconds (default: 0)
   */
  playSource(sourceId: string, loop: boolean = false, offset: number = 0): void {
    if (!this.audioContext) return;

    const chain = this.sourceChains.get(sourceId);
    if (!chain) {
      console.warn(`[MonoIRMode] Source ${sourceId} not found`);
      return;
    }

    // Stop existing playback if any
    if (chain.bufferSource) {
      try {
        chain.bufferSource.stop();
        chain.bufferSource.disconnect();
      } catch (error) {
        // Ignore errors if already stopped
      }
    }

    // Create new buffer source node
    const bufferSource = this.audioContext.createBufferSource();
    bufferSource.buffer = chain.audioBuffer;
    bufferSource.loop = loop;

    // Connect bufferSource to convolver
    // The rest of the chain is permanent: convolver → gainNode → muteGainNode → wetGain → encoder
    bufferSource.connect(chain.convolver);

    // Start playback from offset position
    bufferSource.start(0, offset);
    chain.bufferSource = bufferSource;
    chain.isPlaying = true;

    // Handle playback end (if not looping)
    bufferSource.onended = () => {
      if (!loop) {
        chain.isPlaying = false;
        chain.bufferSource = null;
      }
    };

    console.log(`[MonoIRMode] Started playback for source ${sourceId} (loop: ${loop}, offset: ${offset}s)`);
  }

  /**
   * Stop audio playback for a source
   */
  stopSource(sourceId: string): void {
    const chain = this.sourceChains.get(sourceId);
    if (!chain || !chain.bufferSource) return;

    try {
      chain.bufferSource.stop();
      chain.bufferSource.disconnect();
    } catch (error) {
      console.warn(`[MonoIRMode] Error stopping source ${sourceId}:`, error);
    }

    chain.bufferSource = null;
    chain.isPlaying = false;

    console.log(`[MonoIRMode] Stopped playback for source ${sourceId}`);
  }

  /**
   * Stop all audio sources immediately
   */
  stopAllSources(): void {
    console.log(`[MonoIRMode] Stopping all ${this.sourceChains.size} sources`);
    this.sourceChains.forEach((_, sourceId) => {
      this.stopSource(sourceId);
    });
  }

  /**
   * Update listener (no-op for MonoIR mode)
   *
   * In MonoIR mode, camera position and orientation have NO effect on audio.
   * The IR convolution output is spatially encoded based on source positions,
   * but there is no head rotation (sceneRotator is not used).
   * This provides a fixed spatial perspective regardless of camera movement.
   */
  updateListener(position: Position, _orientation: Orientation): void {
    // Store initial position on first call (for reference only)
    if (!this.receiverPosition) {
      this.receiverPosition = position.clone();
      console.log(`[MonoIRMode] Receiver position locked at (${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)})`);
    }

    // No orientation updates - MonoIR does not use sceneRotator
    // Camera orbit and head rotation have no effect on the audio
  }

  /**
   * Get output node for connection
   */
  getOutputNode(): AudioNode {
    if (!this.masterGain) {
      throw new Error('[MonoIRMode] Not initialized');
    }
    return this.masterGain;
  }

  /**
   * Check if receiver mode is required (position locked, rotation only)
   */
  requiresReceiverMode(): boolean {
    return true; // 3 DOF - head rotation only
  }

  /**
   * Get current audio mode
   */
  getMode(): AudioMode {
    return AudioMode.MONO_IR;
  }

  /**
   * Enable playback for all sources
   */
  enable(): void {
    if (this.enabled) {
      return;
    }

    this.enabled = true;

    // Start playback for all sources
    this.sourceChains.forEach((chain) => {
      this.startSourcePlayback(chain);
    });

    console.log(`[MonoIRMode] Enabled (${this.sourceChains.size} sources)`);
  }

  /**
   * Disable playback for all sources
   */
  disable(): void {
    if (!this.enabled) {
      return;
    }

    this.enabled = false;

    // Stop playback for all sources
    this.sourceChains.forEach((chain) => {
      this.stopSourcePlayback(chain);
    });

    console.log('[MonoIRMode] Disabled');
  }

  /**
   * Dispose of all resources
   */
  dispose(): void {
    // Stop and cleanup all sources
    this.sourceChains.forEach((chain) => {
      this.cleanupSourceChain(chain);
    });
    this.sourceChains.clear();

    // Disconnect and cleanup nodes
    if (this.ambisonicMerger) {
      this.ambisonicMerger.disconnect();
      this.ambisonicMerger = null;
    }

    if (this.binauralDecoder) {
      this.binauralDecoder.dispose();
      this.binauralDecoder = null;
    }

    if (this.boostGain) {
      this.boostGain.disconnect();
      this.boostGain = null;
    }

    if (this.masterGain) {
      this.masterGain.disconnect();
      this.masterGain = null;
    }

    this.irBuffer = null;
    this.audioContext = null;
    this.receiverPosition = null;

    console.log('[MonoIRMode] Disposed');
  }

  /**
   * Set volume for a specific source
   */
  setSourceVolume(sourceId: string, volume: number): void {
    const chain = this.sourceChains.get(sourceId);
    if (!chain || !this.audioContext) return;

    // Apply volume control with physically accurate scaling
    const clampedVolume = Math.max(
      AUDIO_CONTROL.SOURCE_VOLUME.MIN,
      Math.min(AUDIO_CONTROL.SOURCE_VOLUME.MAX, volume)
    );
    chain.gainNode.gain.setValueAtTime(clampedVolume, this.audioContext.currentTime);
  }

  /**
   * Set mute state for a specific source
   */
  setSourceMute(sourceId: string, muted: boolean): void {
    const chain = this.sourceChains.get(sourceId);
    if (!chain || !this.audioContext) return;

    chain.isMuted = muted;
    const gainValue = muted ? AUDIO_CONTROL.DEFAULTS.MUTED_GAIN : AUDIO_CONTROL.DEFAULTS.UNMUTED_GAIN;
    chain.muteGainNode.gain.setValueAtTime(gainValue, this.audioContext.currentTime);
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
   * Start playback for a source chain
   */
  private startSourcePlayback(chain: SourceChain): void {
    if (!this.audioContext || chain.isPlaying) {
      return;
    }

    // Create buffer source
    const bufferSource = this.audioContext.createBufferSource();
    bufferSource.buffer = chain.audioBuffer;
    bufferSource.loop = true; // Loop for continuous playback

    // Connect to convolver input
    bufferSource.connect(chain.convolver);

    // Start playback
    bufferSource.start(0);

    chain.bufferSource = bufferSource;
    chain.isPlaying = true;
  }

  /**
   * Stop playback for a source chain
   */
  private stopSourcePlayback(chain: SourceChain): void {
    if (!chain.bufferSource || !chain.isPlaying) {
      return;
    }

    try {
      chain.bufferSource.stop();
    } catch (error) {
      // Already stopped
    }

    chain.bufferSource = null;
    chain.isPlaying = false;
  }

  /**
   * Cleanup a source chain (disconnect all nodes)
   */
  private cleanupSourceChain(chain: SourceChain): void {
    // Stop playback
    this.stopSourcePlayback(chain);

    // Disconnect nodes
    try {
      chain.convolver.disconnect();
      chain.gainNode.disconnect();
      chain.muteGainNode.disconnect();
      chain.wetGain.disconnect();

      // Disconnect JSAmbisonics encoder
      if (chain.encoder && chain.encoder.out) {
        chain.encoder.out.disconnect();
      }
    } catch (error) {
      // Already disconnected
    }
  }
}
