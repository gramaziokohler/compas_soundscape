/**
 * StereoIRMode - Phase 4 Implementation (2.2)
 *
 * Stereo impulse response convolution with dual interpretation modes.
 * 
 * Interpretation Modes:
 * 1. BINAURAL MODE:
 *    - Direct stereo playback (pre-spatialized for headphones)
 *    - Source → ConvolverNode (stereo IR) → Stereo Output
 *    - No encoding, IR already contains HRTF information
 * 
 * 2. SPEAKER MODE (L/R Room Response):
 *    - L/R split with independent ambisonic encoding at ±30°
 *    - Source → ConvolverNode (stereo IR) → ChannelSplitter (L, R)
 *    - L signal → GainNode (-3dB) → Encoder (azimuth +30°) → [Left stream]
 *    - R signal → GainNode (-3dB) → Encoder (azimuth -30°) → [Right stream]
 *    - Sum: [Left stream] + [Right stream] + [other sources] → Binaural Decoder → Output
 *
 * Speaker Mode Pipeline (per source):
 *   1. Dry Source → ConvolverNode (stereo IR)
 *   2. ConvolverNode → ChannelSplitter (L, R)
 *   3. L channel → GainNode (-3dB) → Ambisonic Encoder (azimuth +30°, elevation 0°)
 *   4. R channel → GainNode (-3dB) → Ambisonic Encoder (azimuth -30°, elevation 0°)
 *   5. L encoder + R encoder → Ambisonic Channel Merger (sum with other sources)
 *   6. Merged Ambisonic → Binaural Decoder (with rotation) → Stereo Output
 *
 * Characteristics:
 * - 3 DOF: Head rotation only (receiver mode required, position LOCKED)
 * - Per-source stereo IR convolution
 * - Speaker mode: L/R positioned at standard ±30° stereo angles
 * - -3dB gain compensation per channel to prevent clipping
 * - HRTF-based binaural decoding with head tracking (speaker mode)
 * - Physically accurate: Stereo image stable in world space with head rotation
 *
 * Implementation:
 * - Uses JSAmbisonics monoEncoder for L/R channel encoding
 * - Uses BinauralDecoder for HRTF convolution (speaker mode only)
 * - Supports FOA (1st order), SOA (2nd order), and TOA (3rd order) ambisonic encoding
 * - Each source has independent convolver + dual JSAmbisonics encoders (speaker mode)
 * - Real-time interpretation mode switching
 */

import type { IAudioMode } from '../core/interfaces/IAudioMode';
import type { Position, Orientation, AmbisonicOrder } from '@/types/audio';
import { AudioMode } from '@/types/audio';
import { BinauralDecoder } from '../decoders/BinauralDecoder';
import { STEREO_SPEAKER, AUDIO_CONTROL, AMBISONIC } from '@/lib/constants';
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
 * Stereo interpretation mode type
 */
type StereoInterpretation = 'binaural' | 'speaker';

/**
 * Per-source audio chain for stereo IR convolution
 * Different chains for binaural vs speaker mode
 */
interface SourceChain {
  sourceId: string;
  audioBuffer: AudioBuffer;
  bufferSource: AudioBufferSourceNode | null;

  // Volume and mute control
  gainNode: GainNode;
  muteGainNode: GainNode;

  // Convolution (shared between modes)
  convolver: ConvolverNode;
  sourceIRBuffer: AudioBuffer | null; // Per-source IR buffer (for simulation mode)

  // Binaural mode (direct stereo output)
  binauralGain?: GainNode;

  // Speaker mode (L/R split + encoding)
  splitter?: ChannelSplitterNode;
  leftGain?: GainNode;
  rightGain?: GainNode;
  leftEncoder?: any; // ambisonics.monoEncoder
  rightEncoder?: any; // ambisonics.monoEncoder

  // Source state
  position: Position;
  isPlaying: boolean;
  isMuted: boolean;
}

export class StereoIRMode implements IAudioMode {
  private audioContext: AudioContext | null = null;
  private enabled: boolean = false;
  private irBuffer: AudioBuffer | null = null;
  
  // Interpretation mode: binaural (direct stereo) or speaker (L/R encoding)
  private interpretationMode: StereoInterpretation = 'binaural';
  
  // Ambisonic configuration (speaker mode only)
  private ambisonicOrder: AmbisonicOrder = 1; // Default to FOA
  private numAmbisonicChannels: number = 4; // FOA = 4 channels
  
  // Binaural decoder (speaker mode only)
  private binauralDecoder: BinauralDecoder | null = null;
  
  // Ambisonic channel merger (speaker mode only)
  private ambisonicMerger: ChannelMergerNode | null = null;
  
  // Master output gain
  private masterGain: GainNode | null = null;

  // Boost gain (separate from master to avoid setMasterVolume overwriting)
  private boostGain: GainNode | null = null;

  // Per-source chains
  private sourceChains: Map<string, SourceChain> = new Map();
  
  // Receiver mode lock (position fixed, only rotation allowed)
  private receiverPosition: Position | null = null;

  /**
   * Initialize stereo IR mode
   */
  async initialize(audioContext: AudioContext): Promise<void> {
    this.audioContext = audioContext;

    // Lazy load ambisonics library (avoid SSR issues)
    await loadAmbisonics();

    // Create master gain (user-controlled volume)
    this.masterGain = audioContext.createGain();
    this.masterGain.gain.value = AUDIO_CONTROL.DEFAULTS.UNITY_GAIN;

    // Create boost gain (fixed compensation, not affected by setMasterVolume)
    this.boostGain = audioContext.createGain();
    this.boostGain.gain.value = AMBISONIC.STEREO_IR_BOOST;

    // Initialize in binaural mode by default: Boost → Master → Destination
    this.boostGain.connect(this.masterGain);
    this.masterGain.connect(audioContext.destination);

    console.log(`[StereoIRMode] Initialized in binaural mode (boost: ${AMBISONIC.STEREO_IR_BOOST}x)`);
  }

  /**
   * Set stereo impulse response buffer
   */
  setImpulseResponse(irBuffer: AudioBuffer): void {
    if (!this.audioContext) {
      throw new Error('[StereoIRMode] Cannot set IR - not initialized');
    }

    if (irBuffer.numberOfChannels !== 2) {
      throw new Error(`[StereoIRMode] Expected stereo IR, got ${irBuffer.numberOfChannels} channels`);
    }
    
    // Process IR buffer (resample if needed, normalize)
    const processedBuffer = processImpulseResponse(irBuffer, this.audioContext, true);
    
    this.irBuffer = processedBuffer;
    
    // Update all existing convolvers with new IR
    this.sourceChains.forEach((chain) => {
      chain.convolver.buffer = processedBuffer;
    });
    
    console.log(`[StereoIRMode] IR buffer set (${processedBuffer.length} samples @ ${processedBuffer.sampleRate}Hz)`);
  }

  /**
   * Set interpretation mode: binaural (direct) or speaker (L/R encoding)
   */
  async setInterpretationMode(mode: StereoInterpretation): Promise<void> {
    if (mode === this.interpretationMode) {
      return;
    }
    
    console.log(`[StereoIRMode] Switching interpretation mode from ${this.interpretationMode} to ${mode}`);
    
    const wasPlaying = this.enabled;
    if (wasPlaying) {
      this.disable();
    }
    
    // Cleanup current mode
    await this.cleanupModeSpecificNodes();
    
    // Switch mode
    this.interpretationMode = mode;
    
    // Setup new mode
    await this.setupModeSpecificNodes();
    
    // Recreate all source chains
    const sourceStates = Array.from(this.sourceChains.values()).map(chain => ({
      sourceId: chain.sourceId,
      audioBuffer: chain.audioBuffer,
      position: chain.position,
      isPlaying: chain.isPlaying
    }));
    
    // Clear old chains
    this.sourceChains.forEach(chain => this.cleanupSourceChain(chain));
    this.sourceChains.clear();
    
    // Recreate chains with new mode
    sourceStates.forEach(state => {
      this.createSource(state.sourceId, state.audioBuffer, state.position);
    });
    
    if (wasPlaying) {
      this.enable();
    }
    
    console.log(`[StereoIRMode] Switched to ${mode} mode`);
  }

  /**
   * Set ambisonic order (speaker mode only)
   */
  async setAmbisonicOrder(order: AmbisonicOrder): Promise<void> {
    if (this.interpretationMode !== 'speaker') {
      console.warn('[StereoIRMode] Ambisonic order only applies to speaker mode');
      return;
    }
    
    if (order === this.ambisonicOrder || !this.audioContext) {
      return;
    }
    
    console.log(`[StereoIRMode] Switching ambisonic order from ${this.ambisonicOrder} to ${order}`);
    
    const wasPlaying = this.enabled;
    if (wasPlaying) {
      this.disable();
    }
    
    // Update order and channel count
    this.ambisonicOrder = order;
    this.numAmbisonicChannels = Math.pow(order + 1, 2);
    
    // Recreate binaural decoder with new order
    if (this.binauralDecoder) {
      await this.binauralDecoder.setOrder(order);
    }
    
    // Recreate ambisonic merger with new channel count
    if (this.ambisonicMerger) {
      this.ambisonicMerger.disconnect();
    }
    this.ambisonicMerger = this.audioContext.createChannelMerger(this.numAmbisonicChannels);
    
    // Reconnect pipeline
    if (this.binauralDecoder && this.masterGain) {
      this.ambisonicMerger.connect(this.binauralDecoder.getInputNode());
    }
    
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
    });
    
    if (wasPlaying) {
      this.enable();
    }
    
    console.log(`[StereoIRMode] Ambisonic order switched to ${order} (${this.numAmbisonicChannels} channels)`);
  }

  /**
   * Setup mode-specific nodes (decoder, merger, etc.)
   */
  private async setupModeSpecificNodes(): Promise<void> {
    if (!this.audioContext || !this.masterGain) {
      return;
    }
    
    if (this.interpretationMode === 'speaker') {
      // Create binaural decoder
      this.binauralDecoder = new BinauralDecoder();
      await this.binauralDecoder.initialize(this.audioContext, this.ambisonicOrder);
      
      // Create ambisonic merger
      this.numAmbisonicChannels = Math.pow(this.ambisonicOrder + 1, 2);
      this.ambisonicMerger = this.audioContext.createChannelMerger(this.numAmbisonicChannels);
      
      // Connect pipeline: Merger → Decoder → Boost Gain → Master Gain → Destination
      this.ambisonicMerger.connect(this.binauralDecoder.getInputNode());
      this.binauralDecoder.getOutputNode().connect(this.boostGain!);
      
      console.log(`[StereoIRMode] Speaker mode pipeline created (${this.ambisonicOrder === 1 ? 'FOA' : 'TOA'})`);
    } else {
      // Binaural mode: master gain already connected to destination
      console.log('[StereoIRMode] Binaural mode (direct stereo output)');
    }
  }

  /**
   * Cleanup mode-specific nodes
   */
  private async cleanupModeSpecificNodes(): Promise<void> {
    if (this.ambisonicMerger) {
      this.ambisonicMerger.disconnect();
      this.ambisonicMerger = null;
    }
    
    if (this.binauralDecoder) {
      this.binauralDecoder.dispose();
      this.binauralDecoder = null;
    }
  }

  /**
   * Create a new audio source with stereo convolution
   */
  createSource(sourceId: string, audioBuffer: AudioBuffer, position: Position): void {
    if (!this.audioContext) {
      console.error('[StereoIRMode] Cannot create source - not initialized');
      return;
    }

    // Remove existing chain if any
    if (this.sourceChains.has(sourceId)) {
      this.removeSource(sourceId);
    }

    // Create volume and mute gain nodes
    const gainNode = this.audioContext.createGain();
    gainNode.gain.value = 1.0; // Unity gain for physically accurate convolution

    const muteGainNode = this.audioContext.createGain();
    muteGainNode.gain.value = 1.0; // Unmuted by default

    // Create convolver node (stereo)
    const convolver = this.audioContext.createConvolver();
    convolver.normalize = false;

    // Set IR buffer if available (global IR mode)
    // In simulation mode, IR will be set per-source via setSourceImpulseResponse()
    if (this.irBuffer) {
      convolver.buffer = this.irBuffer;
    }
    
    // Connect: Convolver → GainNode → MuteGainNode
    convolver.connect(gainNode);
    gainNode.connect(muteGainNode);
    
    const chain: SourceChain = {
      sourceId,
      audioBuffer,
      bufferSource: null,
      gainNode,
      muteGainNode,
      convolver,
      sourceIRBuffer: null, // No per-source IR yet (will be set in simulation mode)
      position,
      isPlaying: false,
      isMuted: false
    };
    
    if (this.interpretationMode === 'binaural') {
      // Binaural mode: simple gain → output
      const binauralGain = this.audioContext.createGain();
      binauralGain.gain.value = 1.0;
      
      chain.binauralGain = binauralGain;
      
      // Connect: MuteGainNode → Binaural Gain → Boost Gain → Master Gain
      muteGainNode.connect(binauralGain);
      binauralGain.connect(this.boostGain!);
      
    } else {
      // Speaker mode: L/R split + dual encoding
      
      // Create channel splitter (L, R)
      const splitter = this.audioContext.createChannelSplitter(2);
      
      // Create gain nodes with -3dB compensation
      const leftGain = this.audioContext.createGain();
      const rightGain = this.audioContext.createGain();
      leftGain.gain.value = STEREO_SPEAKER.LR_GAIN_COMPENSATION_LINEAR;
      rightGain.gain.value = STEREO_SPEAKER.LR_GAIN_COMPENSATION_LINEAR;

      // Create JSAmbisonics monoEncoder for left channel (azimuth +30°, elevation 0°)
      const leftEncoder = new ambisonics.monoEncoder(this.audioContext, this.ambisonicOrder);
      leftEncoder.azim = STEREO_SPEAKER.LEFT_AZIMUTH_DEG; // 30° left
      leftEncoder.elev = 0; // Horizontal plane
      leftEncoder.updateGains();

      // Create JSAmbisonics monoEncoder for right channel (azimuth -30°, elevation 0°)
      const rightEncoder = new ambisonics.monoEncoder(this.audioContext, this.ambisonicOrder);
      rightEncoder.azim = STEREO_SPEAKER.RIGHT_AZIMUTH_DEG; // -30° (30° right)
      rightEncoder.elev = 0; // Horizontal plane
      rightEncoder.updateGains();

      // Store in chain
      chain.splitter = splitter;
      chain.leftGain = leftGain;
      chain.rightGain = rightGain;
      chain.leftEncoder = leftEncoder;
      chain.rightEncoder = rightEncoder;

      // Connect: MuteGainNode → Splitter
      muteGainNode.connect(splitter);

      // Connect L channel: Splitter[0] → Left Gain → Left Encoder → Merger
      splitter.connect(leftGain, 0);
      leftGain.connect(leftEncoder.in);
      for (let ch = 0; ch < this.numAmbisonicChannels; ch++) {
        leftEncoder.out.connect(this.ambisonicMerger!, ch, ch);
      }

      // Connect R channel: Splitter[1] → Right Gain → Right Encoder → Merger
      splitter.connect(rightGain, 1);
      rightGain.connect(rightEncoder.in);
      for (let ch = 0; ch < this.numAmbisonicChannels; ch++) {
        rightEncoder.out.connect(this.ambisonicMerger!, ch, ch);
      }
    }
    
    this.sourceChains.set(sourceId, chain);
    
    console.log(`[StereoIRMode] Created source "${sourceId}" in ${this.interpretationMode} mode`);
  }

  /**
   * Set impulse response for a specific source (simulation mode)
   * Allows per-source IR assignment for source-receiver pair workflows
   */
  setSourceImpulseResponse(sourceId: string, irBuffer: AudioBuffer): void {
    const chain = this.sourceChains.get(sourceId);
    if (!chain) {
      console.warn(`[StereoIRMode] Source "${sourceId}" not found for IR update`);
      return;
    }

    if (!this.audioContext) {
      console.error('[StereoIRMode] Cannot set source IR - not initialized');
      return;
    }

    // Validate channel count
    if (irBuffer.numberOfChannels !== 2) {
      console.error(`[StereoIRMode] Expected stereo IR for source "${sourceId}", got ${irBuffer.numberOfChannels} channels`);
      return;
    }

    // Process IR buffer (resample if needed, normalize)
    const processedBuffer = processImpulseResponse(irBuffer, this.audioContext, true);

    // Update convolver with new IR
    chain.convolver.buffer = processedBuffer;
    chain.sourceIRBuffer = processedBuffer;

    console.log(`[StereoIRMode] ✅ Updated IR for source "${sourceId}" (${processedBuffer.length} samples @ ${processedBuffer.sampleRate}Hz)`);
  }

  /**
   * Update source position
   * Note: In stereo IR mode, source position doesn't affect spatial encoding
   * L/R channels are always at fixed ±30° positions
   */
  updateSourcePosition(sourceId: string, position: Position): void {
    const chain = this.sourceChains.get(sourceId);
    if (!chain) {
      console.warn(`[StereoIRMode] Source "${sourceId}" not found for position update`);
      return;
    }
    
    // Update stored position
    chain.position = position;
    
    // Note: L/R virtual speaker positions remain fixed at ±30°
    // No encoder updates needed
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

    console.log(`[StereoIRMode] Removed source "${sourceId}"`);
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
      console.warn(`[StereoIRMode] Source ${sourceId} not found`);
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

    // Connect based on interpretation mode
    if (this.interpretationMode === 'binaural') {
      // Binaural mode: bufferSource → convolver → splitter → [L/R outputs]
      bufferSource.connect(chain.convolver);
    } else {
      // Speaker mode: bufferSource → convolver → merger → encoder
      bufferSource.connect(chain.convolver);
    }

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

    console.log(`[StereoIRMode] Started playback for source ${sourceId} (loop: ${loop}, offset: ${offset}s)`);
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
      console.warn(`[StereoIRMode] Error stopping source ${sourceId}:`, error);
    }

    chain.bufferSource = null;
    chain.isPlaying = false;

    console.log(`[StereoIRMode] Stopped playback for source ${sourceId}`);
  }

  /**
   * Stop all audio sources immediately
   */
  stopAllSources(): void {
    console.log(`[StereoIRMode] Stopping all ${this.sourceChains.size} sources`);
    this.sourceChains.forEach((_, sourceId) => {
      this.stopSource(sourceId);
    });
  }

  /**
   * Find the closest sound source position to the camera
   * @param cameraPosition - Current camera position
   * @returns Position of closest source, or null if no sources exist
   */
  private findClosestSourcePosition(cameraPosition: Position): Position | null {
    if (this.sourceChains.size === 0) {
      return null;
    }

    let closestPosition: Position | null = null;
    let minDistance = Infinity;

    this.sourceChains.forEach((chain) => {
      const dx = chain.position.x - cameraPosition.x;
      const dy = chain.position.y - cameraPosition.y;
      const dz = chain.position.z - cameraPosition.z;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (distance < minDistance) {
        minDistance = distance;
        closestPosition = chain.position;
      }
    });

    return closestPosition;
  }

  /**
   * Calculate orientation from camera towards a target position
   * @param cameraPosition - Camera position
   * @param targetPosition - Target position to look at
   * @returns Orientation with yaw and pitch towards target
   */
  private calculateOrientationTowards(cameraPosition: Position, targetPosition: Position): Orientation {
    // Calculate direction vector from camera to target
    const dx = targetPosition.x - cameraPosition.x;
    const dy = targetPosition.y - cameraPosition.y;
    const dz = targetPosition.z - cameraPosition.z;

    // Calculate yaw (horizontal rotation around Y-axis)
    // atan2(x, z) gives angle in XZ plane (0 = +Z, π/2 = +X, π = -Z, -π/2 = -X)
    const yaw = Math.atan2(dx, dz);

    // Calculate pitch (vertical rotation around X-axis)
    // atan2(y, horizontal_distance) gives vertical angle
    const horizontalDistance = Math.sqrt(dx * dx + dz * dz);
    const pitch = Math.atan2(dy, horizontalDistance);

    return {
      yaw,
      pitch,
      roll: 0 // No roll for sound orientation
    };
  }

  /**
   * Update listener orientation (rotation only - position is LOCKED in receiver mode)
   * Uses camera orientation for head rotation in the stereo ambisonic field.
   */
  updateListener(position: Position, orientation: Orientation): void {
    // Position is IGNORED in receiver mode (3 DOF - rotation only)
    // Store initial position on first call
    if (!this.receiverPosition) {
      this.receiverPosition = position.clone();
      console.log(`[StereoIRMode] Receiver position locked at (${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)})`);
    }
    
    // Update binaural decoder with camera orientation (head rotation) - speaker mode only
    // The stereo IR contains spatial information, so we rotate the field with head movement
    if (this.interpretationMode === 'speaker' && this.binauralDecoder) {
      this.binauralDecoder.updateOrientation(orientation);
    }
  }

  /**
   * Get output node for connection
   */
  getOutputNode(): AudioNode {
    if (!this.masterGain) {
      throw new Error('[StereoIRMode] Not initialized');
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
    return AudioMode.STEREO_IR;
  }

  /**
   * Get current interpretation mode
   */
  getInterpretationMode(): StereoInterpretation {
    return this.interpretationMode;
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
    
    console.log(`[StereoIRMode] Enabled (${this.sourceChains.size} sources, ${this.interpretationMode} mode)`);
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
    
    console.log('[StereoIRMode] Disabled');
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
    
    // Cleanup mode-specific nodes
    this.cleanupModeSpecificNodes();
    
    // Disconnect and cleanup nodes
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
    
    console.log('[StereoIRMode] Disposed');
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
   * Set mute state for a specific source (stub - to be implemented)
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
      
      if (chain.binauralGain) {
        chain.binauralGain.disconnect();
      }
      
      if (chain.splitter) {
        chain.splitter.disconnect();
      }
      if (chain.leftGain) {
        chain.leftGain.disconnect();
      }
      if (chain.rightGain) {
        chain.rightGain.disconnect();
      }
      if (chain.leftEncoder && chain.leftEncoder.out) {
        chain.leftEncoder.out.disconnect();
      }
      if (chain.rightEncoder && chain.rightEncoder.out) {
        chain.rightEncoder.out.disconnect();
      }
    } catch (error) {
      // Already disconnected
    }
  }
}
