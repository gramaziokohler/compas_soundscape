/**
 * AmbisonicIRMode - Phase 5 Implementation (2.3)
 *
 * Ambisonic impulse response convolution with rotation and binaural decoding.
 *
 * SPARTA MultiConv Approach:
 * - Mono source convolved with each IR channel (no pre-encoding)
 * - IR already contains spatial encoding from room measurement
 * - Output is ambisonic stream (FOA, SOA, or TOA)
 *
 * Pipeline:
 * For each source:
 *   1. Dry Mono Source → JSAmbisonics Multi-channel Convolution
 *      - Uses JSAmbisonics convolver class for all orders (FOA/SOA/TOA)
 *      - Handles multi-channel IR convolution internally
 *   2. Convolution Output → ChannelMerger (sum all sources)
 *   3. Merged Ambisonic → Rotation (JSAmbisonics sceneRotator)
 *   4. Rotated Ambisonic → Binaural Decoder (HRTF-based) → Stereo Output
 *
 * Characteristics:
 * - 3 DOF: Head rotation only (receiver mode required, position LOCKED)
 * - Multi-channel IR convolution (4/9/16 channels)
 * - Order auto-detected from IR channel count: 4=FOA, 9=SOA, 16=TOA
 * - Direct ambisonic field rotation (no re-encoding)
 * - HRTF-based binaural decoding with head tracking
 * - Physically accurate: IR contains spatial information, rotation applied to ambisonic field
 *
 * Implementation:
 * - Uses JSAmbisonics convolver for multi-channel IR convolution
 * - Uses BinauralDecoder for HRTF convolution and rotation
 * - Supports FOA (4-ch), SOA (9-ch), and TOA (16-ch) ambisonic IRs
 * - Per-source convolution (each source has independent JSAmbisonics convolver)
 * - Real-time head rotation via JSAmbisonics sceneRotator
 */

import type { IAudioMode } from '../core/interfaces/IAudioMode';
import type { Position, Orientation, AmbisonicOrder } from '@/types/audio';
import { AudioMode } from '@/types/audio';
import { BinauralDecoder } from '../decoders/BinauralDecoder';
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
 * Per-source audio chain for ambisonic IR convolution using JSAmbisonics
 */
interface SourceChain {
  sourceId: string;
  audioBuffer: AudioBuffer;
  bufferSource: AudioBufferSourceNode | null;

  // Volume and mute control
  gainNode: GainNode;
  muteGainNode: GainNode;

  // JSAmbisonics convolver (handles all orders)
  convolver: any; // ambisonics.convolver

  // Gain node for wet signal control
  wetGain: GainNode;

  // Source state
  position: Position;
  isPlaying: boolean;
  isMuted: boolean;
}

export class AmbisonicIRMode implements IAudioMode {
  private audioContext: AudioContext | null = null;
  private enabled: boolean = false;
  private irBuffer: AudioBuffer | null = null;
  
  // Ambisonic configuration (auto-detected from IR)
  private ambisonicOrder: AmbisonicOrder = 1; // FOA=1, SOA=2, TOA=3
  private numAmbisonicChannels: number = 4; // 4, 9, or 16
  
  // Binaural decoder (includes rotation via sceneRotator)
  private binauralDecoder: BinauralDecoder | null = null;

  // Pipeline initialization counter (for race condition handling)
  private pipelineInitCounter: number = 0;
  
  // Ambisonic mix bus (sums all convolved sources)
  // Using GainNode instead of ChannelMerger because we are mixing multi-channel sources,
  // not merging mono channels into a multi-channel stream.
  private ambisonicMixBus: GainNode | null = null;
  
  // Master output gain
  private masterGain: GainNode | null = null;

  // Boost gain (order-dependent compensation, separate from master)
  private boostGain: GainNode | null = null;

  // Per-source chains
  private sourceChains: Map<string, SourceChain> = new Map();
  
  // Receiver mode lock (position fixed, only rotation allowed)
  private receiverPosition: Position | null = null;

  /**
   * Initialize ambisonic IR mode
   */
  async initialize(audioContext: AudioContext): Promise<void> {
    this.audioContext = audioContext;

    // Lazy load ambisonics library (avoid SSR issues)
    await loadAmbisonics();

    // Create master gain
    this.masterGain = audioContext.createGain();
    this.masterGain.gain.value = 1.0;
    this.masterGain.connect(audioContext.destination);

    console.log('[AmbisonicIRMode] Initialized (awaiting IR buffer)');
  }

  /**
   * Set ambisonic impulse response buffer
   * Auto-detects order from channel count: (order + 1)^2 = channels
   */
  async setImpulseResponse(irBuffer: AudioBuffer): Promise<void> {
    if (!this.audioContext) {
      throw new Error('[AmbisonicIRMode] Cannot set IR - not initialized');
    }

    const channels = irBuffer.numberOfChannels;
    const previousOrder = this.ambisonicOrder;

    // Detect order from channel count
    let order: AmbisonicOrder;
    if (channels === 4) {
      order = 1; // FOA
    } else if (channels === 9) {
      order = 2; // SOA
    } else if (channels === 16) {
      order = 3; // TOA
    } else {
      throw new Error(
        `[AmbisonicIRMode] Unsupported channel count: ${channels}. Expected 4 (FOA), 9 (SOA), or 16 (TOA).`
      );
    }

    // Process IR buffer (resample if needed, apply fixed gain, convert SN3D→N3D)
    // Note: Uses fixed gain multiplier instead of normalization to preserve localization
    const processedBuffer = processImpulseResponse(irBuffer, this.audioContext, true, true);

    // Check if order changed - need to recreate convolvers
    const orderChanged = previousOrder !== order;

    // Store IR and configuration
    this.irBuffer = processedBuffer;
    this.ambisonicOrder = order;
    this.numAmbisonicChannels = channels;

    console.log(`[AmbisonicIRMode] IR buffer set (order ${order}, ${channels} channels, ${processedBuffer.sampleRate}Hz, ${processedBuffer.length} samples)`);

    // Initialize pipeline with detected order
    await this.initializePipeline();

    if (orderChanged && this.sourceChains.size > 0) {
      // Order changed - must recreate source chains (convolvers are order-specific)
      console.log(`[AmbisonicIRMode] Order changed from ${previousOrder} to ${order}, recreating ${this.sourceChains.size} source chains`);
      const existingSources = Array.from(this.sourceChains.entries()).map(([id, chain]) => ({
        id,
        buffer: chain.bufferSource?.buffer ?? null,
        position: chain.position,
        isPlaying: chain.isPlaying,
        volume: chain.gainNode.gain.value,
        isMuted: chain.muteGainNode.gain.value === 0,
      }));

      // Remove old chains
      existingSources.forEach(({ id }) => this.removeSource(id));

      // Recreate with new order
      existingSources.forEach(({ id, buffer, position, isPlaying, volume, isMuted }) => {
        if (buffer) {
          this.createSource(id, buffer, position);
          const chain = this.sourceChains.get(id);
          if (chain) {
            chain.gainNode.gain.value = volume;
            chain.muteGainNode.gain.value = isMuted ? 0 : 1;
            if (isPlaying) {
              this.playSource(id);
            }
          }
        }
      });
    } else {
      // Same order - just update IR buffers
      this.sourceChains.forEach((chain) => {
        this.updateChainIR(chain);
      });
    }
  }

  /**
   * Initialize the ambisonic processing pipeline
   */
  private async initializePipeline(): Promise<void> {
    if (!this.audioContext || !this.irBuffer) {
      return;
    }

    // Increment counter to track this initialization (for race condition handling)
    const initId = ++this.pipelineInitCounter;

    // Cleanup old pipeline
    if (this.binauralDecoder) {
      this.binauralDecoder.dispose();
      this.binauralDecoder = null;
    }
    if (this.ambisonicMixBus) {
      this.ambisonicMixBus.disconnect();
      this.ambisonicMixBus = null;
    }

    // Create binaural decoder with rotation support
    this.binauralDecoder = new BinauralDecoder();
    await this.binauralDecoder.initialize(this.audioContext, this.ambisonicOrder);

    // Enable rotation for AmbisonicIRMode (IR has fixed spatial encoding, need to rotate field)
    this.binauralDecoder.setRotationEnabled(true);

    // Check if this initialization is still current (another call may have started)
    if (initId !== this.pipelineInitCounter) {
      console.warn('[AmbisonicIRMode] Pipeline initialization superseded, aborting');
      return;
    }

    // Create ambisonic mix bus (sums all convolved sources)
    // Use GainNode to mix multi-channel signals (ChannelMerger would downmix to mono)
    this.ambisonicMixBus = this.audioContext.createGain();
    this.ambisonicMixBus.channelCount = this.numAmbisonicChannels;
    this.ambisonicMixBus.channelCountMode = 'explicit';
    this.ambisonicMixBus.channelInterpretation = 'speakers';
    this.ambisonicMixBus.gain.value = 1.0; // Unity gain for proper mixing

    // Create boost gain for order-dependent compensation (separate from master)
    const gainCompensation = this.ambisonicOrder === 1
      ? AMBISONIC.ORDER_GAIN_COMPENSATION.FOA
      : this.ambisonicOrder === 2
        ? AMBISONIC.ORDER_GAIN_COMPENSATION.SOA
        : AMBISONIC.ORDER_GAIN_COMPENSATION.TOA;

    this.boostGain = this.audioContext.createGain();
    this.boostGain.gain.value = gainCompensation;

    // Connect pipeline: MixBus → Decoder → Boost Gain → Master Gain → Destination
    this.ambisonicMixBus.connect(this.binauralDecoder.getInputNode());
    this.binauralDecoder.getOutputNode().connect(this.boostGain);
    this.boostGain.connect(this.masterGain!);

    console.log(`[AmbisonicIRMode] Pipeline initialized (order ${this.ambisonicOrder}, ${this.numAmbisonicChannels} channels, gain compensation: ${gainCompensation.toFixed(2)})`);
    console.log(`[AmbisonicIRMode] Audio graph: Convolver → AmbisonicMixBus → SceneRotator → Decoder → MasterGain → Destination`);
  }

  /**
   * Get current ambisonic order
   */
  getAmbisonicOrder(): AmbisonicOrder {
    return this.ambisonicOrder;
  }

  /**
   * Create a new audio source with JSAmbisonics IR convolution
   */
  createSource(sourceId: string, audioBuffer: AudioBuffer, position: Position): void {
    if (!this.audioContext || !this.irBuffer) {
      console.error('[AmbisonicIRMode] Cannot create source - not initialized or no IR');
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

    // Create wet gain node
    const wetGain = this.audioContext.createGain();
    wetGain.gain.value = 1.0;

    // Create JSAmbisonics convolver for multi-channel IR
    const convolver = new ambisonics.convolver(this.audioContext, this.ambisonicOrder);
    convolver.updateFilters(this.irBuffer);

    // Connect: GainNode → MuteGain → WetGain → Convolver → AmbisonicMixBus
    gainNode.connect(muteGainNode);
    muteGainNode.connect(wetGain);
    wetGain.connect(convolver.in);
    if (this.ambisonicMixBus) {
      try {
        convolver.out.connect(this.ambisonicMixBus);
      } catch (e) {
        console.warn('[AmbisonicIRMode] Error connecting convolver to mix bus:', e);
      }
    } else {
      console.warn('[AmbisonicIRMode] Cannot connect convolver - ambisonicMixBus is null (pipeline reinitializing)');
    }

    const chain: SourceChain = {
      sourceId,
      audioBuffer,
      bufferSource: null,
      gainNode,
      muteGainNode,
      convolver,
      wetGain,
      position,
      isPlaying: false,
      isMuted: false
    };

    this.sourceChains.set(sourceId, chain);

    // Update scene alignment (in case this is the first/closest source)
    this.updateSceneAlignment();

    console.log(`[AmbisonicIRMode] Created source "${sourceId}" with JSAmbisonics convolver (order ${this.ambisonicOrder}, ${this.numAmbisonicChannels} channels)`);
  }

  /**
   * Update scene alignment based on closest source
   * Aligns the Ambisonic IR so that "Front" points to the closest source
   */
  private updateSceneAlignment(): void {
    if (!this.receiverPosition || this.sourceChains.size === 0 || !this.binauralDecoder) return;

    // Find closest source
    let closestSource: SourceChain | null = null;
    let minDistSq = Infinity;

    this.sourceChains.forEach(chain => {
      const distSq = chain.position.distanceToSquared(this.receiverPosition!);
      if (distSq < minDistSq) {
        minDistSq = distSq;
        closestSource = chain;
      }
    });

    if (closestSource) {
      const source = closestSource as SourceChain;
      const dx = source.position.x - this.receiverPosition.x;
      const dz = source.position.z - this.receiverPosition.z;
      
      // Calculate azimuth from receiver to source (relative to -Z Front)
      // +X is Right, -Z is Front
      // atan2(-dx, -dz) gives angle from Front, with +Angle = Left
      const sourceAzimuth = Math.atan2(-dx, -dz);
      
      // We want to rotate the scene such that the IR's Front aligns with this azimuth
      // Offset = -SourceAngle
      this.binauralDecoder.setRotationOffset(-sourceAzimuth);
      
      // console.log(`[AmbisonicIRMode] Aligned scene to source at azimuth ${(sourceAzimuth * 180 / Math.PI).toFixed(1)}°`);
    }
  }

  /**
   * Update chain IR buffer when IR changes (uses JSAmbisonics convolver)
   */
  private updateChainIR(chain: SourceChain): void {
    if (!this.irBuffer) {
      return;
    }

    // Update JSAmbisonics convolver with new IR
    chain.convolver.updateFilters(this.irBuffer);
  }

  /**
   * Update source position
   * Note: In ambisonic IR mode, source position doesn't affect spatial encoding
   * The IR already contains all spatial information from the room measurement
   */
  updateSourcePosition(sourceId: string, position: Position): void {
    const chain = this.sourceChains.get(sourceId);
    if (!chain) {
      console.warn(`[AmbisonicIRMode] Source "${sourceId}" not found for position update`);
      return;
    }
    
    // Update stored position (for reference, but doesn't affect audio)
    chain.position = position;
    
    // Update scene alignment if source moved
    this.updateSceneAlignment();
    
    // Note: IR already contains spatial encoding, no position updates needed
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

    // Update scene alignment
    this.updateSceneAlignment();

    console.log(`[AmbisonicIRMode] Removed source "${sourceId}"`);
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
      console.warn(`[AmbisonicIRMode] Source ${sourceId} not found`);
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

    // Connect to JSAmbisonics convolver
    // Graph: bufferSource → convolver.in → convolver.out → ambisonicMerger
    bufferSource.connect(chain.gainNode);

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

    console.log(`[AmbisonicIRMode] Started playback for source ${sourceId} (loop: ${loop}, offset: ${offset}s)`);
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
      console.warn(`[AmbisonicIRMode] Error stopping source ${sourceId}:`, error);
    }

    chain.bufferSource = null;
    chain.isPlaying = false;

    console.log(`[AmbisonicIRMode] Stopped playback for source ${sourceId}`);
  }

  /**
   * Stop all audio sources immediately
   */
  stopAllSources(): void {
    console.log(`[AmbisonicIRMode] Stopping all ${this.sourceChains.size} sources`);
    this.sourceChains.forEach((_, sourceId) => {
      this.stopSource(sourceId);
    });
  }

  /**
   * Update listener orientation (rotation only - position is LOCKED in receiver mode)
   * Uses camera orientation for head rotation in the ambisonic field.
   */
  updateListener(position: Position, orientation: Orientation): void {
    // Position is IGNORED in receiver mode (3 DOF - rotation only)
    // Store initial position on first call
    if (!this.receiverPosition) {
      this.receiverPosition = position.clone();
      console.log(`[AmbisonicIRMode] Receiver position locked at (${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)})`);
      
      // Initial alignment
      this.updateSceneAlignment();
    }
    
    // Update binaural decoder with camera orientation (head rotation via sceneRotator)
    // The ambisonic IR contains spatial information, so we rotate the field with head movement
    if (this.binauralDecoder) {
      this.binauralDecoder.updateOrientation(orientation);
    }
  }

  /**
   * Get output node for connection
   */
  getOutputNode(): AudioNode {
    if (!this.masterGain) {
      throw new Error('[AmbisonicIRMode] Not initialized');
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
    return AudioMode.AMBISONIC_IR;
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
    
    console.log(`[AmbisonicIRMode] Enabled (${this.sourceChains.size} sources, order ${this.ambisonicOrder})`);
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
    
    console.log('[AmbisonicIRMode] Disabled');
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
    if (this.ambisonicMixBus) {
      this.ambisonicMixBus.disconnect();
      this.ambisonicMixBus = null;
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
    
    console.log('[AmbisonicIRMode] Disposed');
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

    // Connect to JSAmbisonics convolver
    // Graph: bufferSource → gainNode → muteGain → wetGain → convolver.in → convolver.out → ambisonicMixBus
    bufferSource.connect(chain.gainNode);

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
      chain.bufferSource.disconnect();
    } catch (error) {
      // Already stopped or disconnected
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
      chain.gainNode.disconnect();
      chain.muteGainNode.disconnect();
      chain.wetGain.disconnect();

      // Disconnect JSAmbisonics convolver
      if (chain.convolver && chain.convolver.out) {
        chain.convolver.out.disconnect();
      }
    } catch (error) {
      // Already disconnected
    }
  }
}
