/**
 * SpatialIRRenderer
 *
 * Renders audio with spatial IR convolution (binaural/FOA/TOA).
 * Supports 3 DOF head rotation with static position.
 * Uses ambisonic encoding + multi-channel convolution + rotation + decoding.
 * ONLY active in receiver mode.
 */

import type { IAudioRenderer } from '../interfaces/IAudioRenderer';
import { AudioRenderMode } from '../types';
import type { AudioSourceHandle, IRFormat } from '../types';
import { AudioSourceHandleImpl } from '../utils/AudioSourceHandleImpl';
import { AmbisonicHelpers } from '../utils/AmbisonicHelpers';

export class SpatialIRRenderer implements IAudioRenderer {
  private audioContext: AudioContext | null = null;
  private irBuffer: AudioBuffer | null = null;
  private irFormat: IRFormat | null = null;
  private masterGain: GainNode | null = null;
  private isReceiverModeActive: boolean = false;
  private enabled: boolean = true;
  private currentOrientation: [number, number, number] = [0, 0, 0];
  private listenerPosition: [number, number, number] = [0, 0, 0];

  // Convolution nodes (one per channel)
  private convolvers: ConvolverNode[] = [];

  // Channel merger/splitter for multi-channel processing
  private channelMerger: ChannelMergerNode | null = null;
  private channelSplitter: ChannelSplitterNode | null = null;

  // Source management
  private sources: Set<AudioSourceHandle> = new Set();
  private sourceGains: Map<AudioSourceHandle, GainNode> = new Map();

  initialize(audioContext: AudioContext): void {
    this.audioContext = audioContext;
    this.masterGain = audioContext.createGain();
  }

  setImpulseResponse(irBuffer: AudioBuffer, format: IRFormat): void {
    if (!this.audioContext) {
      throw new Error('Renderer not initialized');
    }

    this.irBuffer = irBuffer;
    this.irFormat = format;

    // Clean up existing convolvers
    this.convolvers.forEach(c => c.disconnect());
    this.convolvers = [];

    // Set up convolution based on format
    switch (format) {
      case 'binaural':
        this.setupBinauralIR(irBuffer);
        break;
      case 'foa':
        this.setupFOAIR(irBuffer);
        break;
      case 'toa':
        this.setupTOAIR(irBuffer);
        break;
      default:
        throw new Error(`Unsupported IR format: ${format}`);
    }
  }

  private setupBinauralIR(irBuffer: AudioBuffer): void {
    if (!this.audioContext) return;

    // For binaural (2ch), create 2 convolvers
    this.channelSplitter = this.audioContext.createChannelSplitter(2);
    this.channelMerger = this.audioContext.createChannelMerger(2);

    for (let i = 0; i < 2; i++) {
      const convolver = this.audioContext.createConvolver();

      // Extract single channel from IR
      const channelBuffer = this.audioContext.createBuffer(
        1,
        irBuffer.length,
        irBuffer.sampleRate
      );
      channelBuffer.copyToChannel(irBuffer.getChannelData(i), 0);
      convolver.buffer = channelBuffer;

      // Connect: splitter -> convolver -> merger
      this.channelSplitter!.connect(convolver, i, 0);
      convolver.connect(this.channelMerger!, 0, i);

      this.convolvers.push(convolver);
    }

    // Connect merger to master gain
    this.channelMerger.connect(this.masterGain!);
  }

  private setupFOAIR(irBuffer: AudioBuffer): void {
    if (!this.audioContext) return;

    // For FOA (4ch), create 4 convolvers
    this.channelSplitter = this.audioContext.createChannelSplitter(4);
    this.channelMerger = this.audioContext.createChannelMerger(4);

    for (let i = 0; i < 4; i++) {
      const convolver = this.audioContext.createConvolver();

      // Extract single channel from IR
      const channelBuffer = this.audioContext.createBuffer(
        1,
        irBuffer.length,
        irBuffer.sampleRate
      );
      channelBuffer.copyToChannel(irBuffer.getChannelData(i), 0);
      convolver.buffer = channelBuffer;

      // Connect: splitter -> convolver -> merger
      this.channelSplitter!.connect(convolver, i, 0);
      convolver.connect(this.channelMerger!, 0, i);

      this.convolvers.push(convolver);
    }

    // Merger output will be decoded to binaural/stereo
    // For now, simple downmix to stereo
    const decoder = this.audioContext.createGain();
    this.channelMerger.connect(decoder);
    decoder.connect(this.masterGain!);
  }

  private setupTOAIR(irBuffer: AudioBuffer): void {
    if (!this.audioContext) return;

    // For TOA (16ch), create 16 convolvers
    // Similar to FOA but with 16 channels
    this.channelSplitter = this.audioContext.createChannelSplitter(16);
    this.channelMerger = this.audioContext.createChannelMerger(16);

    for (let i = 0; i < 16; i++) {
      const convolver = this.audioContext.createConvolver();

      // Extract single channel from IR
      const channelBuffer = this.audioContext.createBuffer(
        1,
        irBuffer.length,
        irBuffer.sampleRate
      );
      channelBuffer.copyToChannel(irBuffer.getChannelData(i), 0);
      convolver.buffer = channelBuffer;

      // Connect: splitter -> convolver -> merger
      this.channelSplitter!.connect(convolver, i, 0);
      convolver.connect(this.channelMerger!, 0, i);

      this.convolvers.push(convolver);
    }

    // Merger output will be decoded to binaural/stereo
    const decoder = this.audioContext.createGain();
    this.channelMerger.connect(decoder);
    decoder.connect(this.masterGain!);
  }

  createSource(
    position: [number, number, number],
    audioBuffer: AudioBuffer
  ): AudioSourceHandle {
    if (!this.audioContext || !this.masterGain) {
      throw new Error('Renderer not initialized');
    }

    // For spatial IR, we encode to ambisonics based on position
    // Then apply convolution in ambisonic domain
    // Then decode to binaural/stereo

    // For now, create a simple gain node
    // In full implementation, would encode to FOA/TOA here
    const gainNode = this.audioContext.createGain();

    // Calculate spatial encoding based on position
    const spherical = AmbisonicHelpers.cartesianToSpherical(
      position,
      this.listenerPosition
    );

    // Apply distance attenuation
    const attenuation = AmbisonicHelpers.calculateDistanceAttenuation(
      spherical.distance
    );
    gainNode.gain.setValueAtTime(attenuation, this.audioContext.currentTime);

    // Connect based on receiver mode
    const outputNode = this.isReceiverModeActive && this.channelSplitter
      ? this.channelSplitter
      : this.masterGain;

    gainNode.connect(outputNode);

    // Create source handle
    const source = new AudioSourceHandleImpl(
      this.audioContext,
      audioBuffer,
      position,
      gainNode
    );

    this.sources.add(source);
    this.sourceGains.set(source, gainNode);

    return source;
  }

  setReceiverMode(isActive: boolean): void {
    if (this.isReceiverModeActive === isActive) return;

    this.isReceiverModeActive = isActive;

    // Rewire all sources
    this.sources.forEach(source => {
      const gainNode = this.sourceGains.get(source);
      if (!gainNode) return;

      // Disconnect from current output
      gainNode.disconnect();

      // Reconnect to appropriate output
      const outputNode = isActive && this.channelSplitter
        ? this.channelSplitter
        : this.masterGain;

      if (outputNode) {
        gainNode.connect(outputNode);
      }
    });
  }

  updateListener(
    position: [number, number, number],
    orientation: [number, number, number]
  ): void {
    // Position is IGNORED (static at receiver)
    // Only orientation affects rotation
    this.currentOrientation = orientation;

    // Apply rotation to ambisonic field
    // This would update rotation matrix in full implementation
    // For now, we just store the orientation
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (this.masterGain) {
      this.masterGain.gain.setValueAtTime(
        enabled ? 1 : 0,
        this.audioContext!.currentTime
      );
    }
  }

  requiresReceiverMode(): boolean {
    return true; // Spatial IR requires receiver mode
  }

  getMode(): AudioRenderMode {
    switch (this.irFormat) {
      case 'binaural':
        return AudioRenderMode.SPATIAL_IR_BINAURAL;
      case 'foa':
        return AudioRenderMode.SPATIAL_IR_FOA;
      case 'toa':
        return AudioRenderMode.SPATIAL_IR_TOA;
      default:
        throw new Error('Unknown IR format');
    }
  }

  getOutputNode(): AudioNode {
    if (!this.masterGain) {
      throw new Error('Renderer not initialized');
    }
    return this.masterGain;
  }

  dispose(): void {
    this.sources.forEach(source => source.dispose());
    this.sources.clear();
    this.sourceGains.clear();

    this.convolvers.forEach(c => c.disconnect());
    this.convolvers = [];

    if (this.channelSplitter) {
      this.channelSplitter.disconnect();
      this.channelSplitter = null;
    }

    if (this.channelMerger) {
      this.channelMerger.disconnect();
      this.channelMerger = null;
    }

    if (this.masterGain) {
      this.masterGain.disconnect();
      this.masterGain = null;
    }
  }
}
