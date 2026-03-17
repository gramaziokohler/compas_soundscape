/**
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
 * Format Specification:
 * - Channel ordering: ACN - FOA: W,Y,Z,X (AmbiX standard)
 * - Normalization: SN3D (Schmidt semi-normalized, AmbiX standard)
 * - Backend outputs AmbiX (ACN + SN3D) from pyroomacoustics directivity capture
 * - Omnitone decoder: uses AmbiX natively (no conversion)
 * - JSAmbisonics decoder: converts SN3D → N3D at convolver input
 * - FOA IRs from pyroomacoustics use directivity-based MicrophoneArray (coincident)
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
import type { IBinauralDecoder } from '../core/interfaces/IBinauralDecoder';
import { AudioMode } from '@/types/audio';
import { BinauralDecoder } from '../decoders/BinauralDecoder';
import { OmnitoneFOADecoder } from '../decoders/OmnitoneFOADecoder';
import { AUDIO_CONTROL, AMBISONIC } from '@/utils/constants';
import { convertSN3DtoN3D } from '../utils/ambisonic-utils';

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
  sourceIRBuffer: AudioBuffer | null; // Per-source IR buffer (for simulation mode)

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
  // Uses either JSAmbisonics or Omnitone based on AMBISONIC.USE_OMNITONE_FOR_FOA constant
  private binauralDecoder: IBinauralDecoder | null = null;

  // Pipeline initialization counter (for race condition handling)
  private pipelineInitCounter: number = 0;

  // Whether the current decoder needs N3D normalization (JSAmbisonics)
  // Omnitone uses SN3D (AmbiX native), JSAmbisonics uses N3D
  private decoderNeedsN3D: boolean = false;
  
  // Master output gain (user-facing volume control only)
  private masterGain: GainNode | null = null;

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

    // Initialize pipeline (even without IR buffer for simulation mode)
    await this.initializePipeline();

    console.log('[AmbisonicIRMode] Initialized');
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
    // Mono (1ch) and Stereo (2ch) use FOA order with conversion
    let order: AmbisonicOrder;
    if (channels === 1 || channels === 2) {
      order = 1; // Mono/Stereo IR - convert to FOA
    } else if (channels === 4) {
      order = 1; // FOA
    } else if (channels === 9) {
      order = 2; // SOA
    } else if (channels === 16) {
      order = 3; // TOA
    } else {
      throw new Error(
        `[AmbisonicIRMode] Unsupported channel count: ${channels}. Expected 1 (Mono), 2 (Stereo), 4 (FOA), 9 (SOA), or 16 (TOA).`
      );
    }

    // Convert mono/stereo IR to FOA format BEFORE processing
    // This ensures processImpulseResponse treats it as ambisonic (preserves gain balance)
    let bufferToProcess = irBuffer;
    if (channels === 1) {
      bufferToProcess = this.convertMonoToFOA(irBuffer);
      console.log(`[AmbisonicIRMode] Converted mono IR to FOA (W channel only)`);
    } else if (channels === 2) {
      bufferToProcess = this.convertStereoToFOA(irBuffer);
      console.log(`[AmbisonicIRMode] Converted stereo IR to FOA (L/R at ±30°)`);
    }

    // Resample IR to match AudioContext sample rate if needed (no gain manipulation)
    const processedBuffer = this.resampleIfNeeded(bufferToProcess);

    // Check if order changed - need to recreate convolvers
    const orderChanged = previousOrder !== order;

    // Store IR and configuration
    this.irBuffer = processedBuffer;
    this.ambisonicOrder = order;
    this.numAmbisonicChannels = processedBuffer.numberOfChannels;

    console.log(`[AmbisonicIRMode] IR buffer set (order ${order}, ${channels}ch → ${processedBuffer.numberOfChannels}ch, ${processedBuffer.sampleRate}Hz, ${processedBuffer.length} samples)`);

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
      // Same order - update IR buffers AND reconnect to new decoder
      // (initializePipeline disposed the old decoder, so we must reconnect)
      this.sourceChains.forEach((chain) => {
        this.updateChainIR(chain);
        
        // Reconnect convolver to new decoder
        if (this.binauralDecoder && chain.convolver) {
          try {
            // Disconnect purely to be safe (though old destination is dead)
            try { chain.convolver.out.disconnect(); } catch (e) {} 
            
            chain.convolver.out.connect(this.binauralDecoder.getInputNode());
          } catch (e) {
            console.warn('[AmbisonicIRMode] Failed to reconnect convolver:', e);
          }
        }
      });
      
      console.log(`[AmbisonicIRMode] Updated IR and reconnected ${this.sourceChains.size} sources`);
    }
  }

  /**
   * Initialize the ambisonic processing pipeline
   */
  private async initializePipeline(): Promise<void> {
    if (!this.audioContext) {
      return;
    }

    // Increment counter to track this initialization (for race condition handling)
    const initId = ++this.pipelineInitCounter;

    // Cleanup old pipeline
    if (this.binauralDecoder) {
      this.binauralDecoder.dispose();
      this.binauralDecoder = null;
    }
    // Create binaural decoder with rotation support
    // For FOA, use Omnitone if enabled in constants, otherwise use JSAmbisonics
    // For SOA/TOA, always use JSAmbisonics (Omnitone doesn't support higher orders)
    const useFOA = this.ambisonicOrder === 1;
    const useOmnitone = useFOA && AMBISONIC.USE_OMNITONE_FOR_FOA;
    
    if (useOmnitone) {
      console.log('[AmbisonicIRMode] Using Omnitone FOA decoder (Google SADIE HRTFs, SN3D native)');
      this.binauralDecoder = new OmnitoneFOADecoder();
      this.decoderNeedsN3D = false; // Omnitone uses SN3D (AmbiX)
    } else {
      console.log(`[AmbisonicIRMode] Using JSAmbisonics decoder (order ${this.ambisonicOrder}, N3D)`);
      this.binauralDecoder = new BinauralDecoder();
      this.decoderNeedsN3D = true; // JSAmbisonics uses N3D
    }
    
    await this.binauralDecoder.initialize(this.audioContext, this.ambisonicOrder);

    // Enable rotation for AmbisonicIRMode (IR has fixed spatial encoding, need to rotate field)
    this.binauralDecoder.setRotationEnabled(true);

    // Check if this initialization is still current (another call may have started)
    if (initId !== this.pipelineInitCounter) {
      console.warn('[AmbisonicIRMode] Pipeline initialization superseded, aborting');
      return;
    }

    // Connect pipeline: Convolvers → Decoder → Master Gain → Destination
    // Each convolver connects directly to decoder input (Web Audio sums automatically)
    this.binauralDecoder.getOutputNode().connect(this.masterGain!);

    console.log(`[AmbisonicIRMode] Pipeline: Convolver(s) → SceneRotator → BinDecoder → MasterGain → Destination`);
  }

  /**
   * Get current ambisonic order
   */
  getAmbisonicOrder(): AmbisonicOrder {
    return this.ambisonicOrder;
  }

  /**
   * Get the processed global IR buffer (for offline export).
   * Returns the buffer after mono/stereo→FOA conversion and gain processing.
   */
  getProcessedIRBuffer(): AudioBuffer | null {
    return this.irBuffer;
  }

  /**
   * Get all per-source processed IR buffers (for offline export in simulation mode).
   * Returns a Map of sourceId → processed IR buffer.
   */
  getSourceIRBuffers(): Map<string, AudioBuffer> {
    const result = new Map<string, AudioBuffer>();
    this.sourceChains.forEach((chain, sourceId) => {
      if (chain.sourceIRBuffer) {
        result.set(sourceId, chain.sourceIRBuffer);
      }
    });
    return result;
  }

  /**
   * Resample an AudioBuffer to match the AudioContext sample rate if needed.
   * No gain manipulation — preserves the IR data exactly.
   */
  private resampleIfNeeded(buffer: AudioBuffer): AudioBuffer {
    if (!this.audioContext || buffer.sampleRate === this.audioContext.sampleRate) {
      return buffer;
    }

    const targetRate = this.audioContext.sampleRate;
    const ratio = buffer.sampleRate / targetRate;
    const outputLength = Math.floor(buffer.length / ratio);
    const resampled = this.audioContext.createBuffer(
      buffer.numberOfChannels,
      outputLength,
      targetRate
    );

    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const input = buffer.getChannelData(ch);
      const output = resampled.getChannelData(ch);
      for (let i = 0; i < outputLength; i++) {
        const srcIdx = i * ratio;
        const idx0 = Math.floor(srcIdx);
        const idx1 = Math.min(idx0 + 1, input.length - 1);
        const frac = srcIdx - idx0;
        output[i] = input[idx0] * (1 - frac) + input[idx1] * frac;
      }
    }

    console.log(`[AmbisonicIRMode] Resampled IR: ${buffer.sampleRate}Hz → ${targetRate}Hz`);
    return resampled;
  }

  /**
   * Get IR buffer in the normalization expected by the current decoder.
   * Backend outputs AmbiX (ACN + SN3D).
   * - Omnitone: uses SN3D (AmbiX native), no conversion needed
   * - JSAmbisonics: needs SN3D → N3D normalization only
   *
   * No Y-axis flip needed: the sceneRotator's transposed Rz is compensated
   * by negating yaw/pitch in BinauralDecoder.updateOrientation instead.
   * This keeps the IR in standard +Y=Left convention throughout.
   */
  private getConvolverIR(sn3dBuffer: AudioBuffer): AudioBuffer {
    if (!this.audioContext) return sn3dBuffer;
    if (this.decoderNeedsN3D) {
      return convertSN3DtoN3D(sn3dBuffer, this.audioContext);
    }
    return sn3dBuffer;
  }

  /**
   * Create a new audio source with JSAmbisonics IR convolution
   */
  createSource(sourceId: string, audioBuffer: AudioBuffer, position: Position): void {
    if (!this.audioContext) {
      console.error('[AmbisonicIRMode] Cannot create source - not initialized');
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

    // Create JSAmbisonics convolver for multi-channel IR
    const convolver = new ambisonics.convolver(this.audioContext, this.ambisonicOrder);

    // Set IR buffer if available (global IR mode)
    // In simulation mode, IR will be set per-source via setSourceImpulseResponse()
    // Convert SN3D → N3D if JSAmbisonics decoder is active
    if (this.irBuffer) {
      convolver.updateFilters(this.getConvolverIR(this.irBuffer));
    }

    // Connect: GainNode → MuteGain → Convolver → Decoder (direct connection, no mix bus)
    gainNode.connect(muteGainNode);
    muteGainNode.connect(convolver.in);
    
    // Connect convolver directly to decoder input (Web Audio automatically sums)
    // This matches JSAmbisonics approach and avoids GainNode channel routing issues
    if (this.binauralDecoder) {
      try {
        convolver.out.connect(this.binauralDecoder.getInputNode());
      } catch (e) {
        console.warn('[AmbisonicIRMode] Error connecting convolver to decoder:', e);
      }
    } else {
      console.warn('[AmbisonicIRMode] Cannot connect convolver - decoder not initialized');
    }

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

    this.sourceChains.set(sourceId, chain);

    console.log(`[AmbisonicIRMode] Created source "${sourceId}" with JSAmbisonics convolver (order ${this.ambisonicOrder}, ${this.numAmbisonicChannels} channels)`);
  }

  /**
   * Convert mono IR to FOA (4-channel) format with signal in W channel only
   */
  private convertMonoToFOA(monoBuffer: AudioBuffer): AudioBuffer {
    const foaBuffer = this.audioContext!.createBuffer(
      4, // FOA = 4 channels (W, X, Y, Z)
      monoBuffer.length,
      monoBuffer.sampleRate
    );

    // Copy mono signal to W channel (omnidirectional)
    const monoData = monoBuffer.getChannelData(0);
    const wData = foaBuffer.getChannelData(0);
    wData.set(monoData);

    // X, Y, Z channels remain zeros (no directional encoding)
    // This represents an omnidirectional room response

    return foaBuffer;
  }

  /**
   * Convert stereo IR to FOA (4-channel) format
   * Encodes L/R channels at ±30° azimuth (standard stereo speaker layout)
   */
  private convertStereoToFOA(stereoBuffer: AudioBuffer): AudioBuffer {
    const foaBuffer = this.audioContext!.createBuffer(
      4, // FOA = 4 channels (W, X, Y, Z)
      stereoBuffer.length,
      stereoBuffer.sampleRate
    );

    const leftData = stereoBuffer.getChannelData(0);
    const rightData = stereoBuffer.getChannelData(1);

    const wData = foaBuffer.getChannelData(0);
    const xData = foaBuffer.getChannelData(1);
    const yData = foaBuffer.getChannelData(2);
    // Z channel (up/down) remains zeros for horizontal stereo

    // FOA encoding coefficients for ±30° azimuth (standard stereo)
    // Left speaker at +30° (azimuth = π/6), Right speaker at -30° (azimuth = -π/6)
    const azLeft = Math.PI / 6;  // 30 degrees
    const azRight = -Math.PI / 6; // -30 degrees

    // FOA encoding: W = 1/√2, X = cos(az), Y = sin(az) (for horizontal sources)
    const wCoeff = 1 / Math.sqrt(2);
    const xLeft = Math.cos(azLeft);
    const yLeft = Math.sin(azLeft);
    const xRight = Math.cos(azRight);
    const yRight = Math.sin(azRight);

    for (let i = 0; i < stereoBuffer.length; i++) {
      const L = leftData[i];
      const R = rightData[i];

      // Sum contributions from both channels
      wData[i] = wCoeff * (L + R);
      xData[i] = xLeft * L + xRight * R;
      yData[i] = yLeft * L + yRight * R;
    }

    return foaBuffer;
  }

  /**
   * Set impulse response for a specific source (simulation mode)
   * Allows per-source IR assignment for source-receiver pair workflows
   */
  async setSourceImpulseResponse(sourceId: string, irBuffer: AudioBuffer): Promise<void> {
    const chain = this.sourceChains.get(sourceId);
    if (!chain) {
      console.warn(`[AmbisonicIRMode] Source "${sourceId}" not found for IR update`);
      return;
    }

    if (!this.audioContext) {
      console.error('[AmbisonicIRMode] Cannot set source IR - not initialized');
      return;
    }

    // Validate channel count (1/2 for Mono/Stereo, 4/9/16 for FOA/SOA/TOA)
    const channels = irBuffer.numberOfChannels;
    if (![1, 2, 4, 9, 16].includes(channels)) {
      console.error(`[AmbisonicIRMode] Expected mono/stereo/ambisonic IR (1/2/4/9/16 channels) for source "${sourceId}", got ${channels} channels`);
      return;
    }

    // Convert mono/stereo IR to FOA format BEFORE processing
    // This ensures processImpulseResponse treats it as ambisonic (preserves gain balance)
    let bufferToProcess = irBuffer;
    if (channels === 1) {
      bufferToProcess = this.convertMonoToFOA(irBuffer);
      console.log(`[AmbisonicIRMode] Converted mono IR to FOA (W channel only) for source "${sourceId}"`);
    } else if (channels === 2) {
      bufferToProcess = this.convertStereoToFOA(irBuffer);
      console.log(`[AmbisonicIRMode] Converted stereo IR to FOA (L/R at ±30°) for source "${sourceId}"`);
    }

    // Resample if needed, no gain manipulation
    const processedBuffer = this.resampleIfNeeded(bufferToProcess);

    // Update JSAmbisonics convolver with new IR
    // Convert SN3D → N3D if JSAmbisonics decoder is active
    chain.convolver.updateFilters(this.getConvolverIR(processedBuffer));
    chain.sourceIRBuffer = processedBuffer;

    console.log(`[AmbisonicIRMode] ✅ Updated IR for source "${sourceId}" (${channels}ch → ${bufferToProcess.numberOfChannels}ch, ${bufferToProcess.length} samples @ ${bufferToProcess.sampleRate}Hz)`);
  }


  /**
   * Update chain IR buffer when IR changes (uses JSAmbisonics convolver)
   */
  private updateChainIR(chain: SourceChain): void {
    if (!this.irBuffer) {
      return;
    }

    // Update JSAmbisonics convolver with new IR
    // Convert SN3D → N3D if JSAmbisonics decoder is active
    chain.convolver.updateFilters(this.getConvolverIR(this.irBuffer));
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
    if (this.binauralDecoder) {
      this.binauralDecoder.dispose();
      this.binauralDecoder = null;
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
    // Graph: bufferSource → gainNode → muteGain → convolver → decoder
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

      // Disconnect JSAmbisonics convolver
      if (chain.convolver && chain.convolver.out) {
        chain.convolver.out.disconnect();
      }
    } catch (error) {
      // Already disconnected
    }
  }
}
