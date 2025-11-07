/**
 * MonoIRRenderer
 *
 * Renders audio with mono IR convolution.
 * Uses Three.js positional audio + ConvolverNode.
 * 6 DOF for sound sources, 0 DOF for IR (head-locked).
 * ONLY active in receiver mode.
 */

import type { IAudioRenderer } from '../interfaces/IAudioRenderer';
import type { AudioRenderMode, AudioSourceHandle } from '../types';
import { AudioSourceHandleImpl } from '../utils/AudioSourceHandleImpl';

export class MonoIRRenderer implements IAudioRenderer {
  private audioContext: AudioContext | null = null;
  private listenerNode: AudioListener | null = null;
  private convolver: ConvolverNode | null = null;
  private irBuffer: AudioBuffer | null = null;
  private masterGain: GainNode | null = null;
  private isReceiverModeActive: boolean = false;
  private enabled: boolean = true;

  // Source management
  private sources: Set<AudioSourceHandle> = new Set();
  private pannerNodes: Map<AudioSourceHandle, PannerNode> = new Map();

  initialize(audioContext: AudioContext): void {
    this.audioContext = audioContext;
    this.listenerNode = audioContext.listener;
    this.masterGain = audioContext.createGain();
  }

  setImpulseResponse(irBuffer: AudioBuffer): void {
    if (!this.audioContext) {
      throw new Error('Renderer not initialized');
    }

    // Verify mono
    if (irBuffer.numberOfChannels !== 1) {
      throw new Error(
        `Expected mono IR, got ${irBuffer.numberOfChannels} channels`
      );
    }

    this.irBuffer = irBuffer;
    this.convolver = this.audioContext.createConvolver();
    this.convolver.buffer = irBuffer;

    // Connect convolver to master gain
    this.convolver.connect(this.masterGain!);
  }

  createSource(
    position: [number, number, number],
    audioBuffer: AudioBuffer
  ): AudioSourceHandle {
    if (!this.audioContext || !this.masterGain) {
      throw new Error('Renderer not initialized');
    }

    // Create panner node for positional audio
    const panner = this.audioContext.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 1;
    panner.maxDistance = 10000;
    panner.rolloffFactor = 1;

    // Set initial position
    panner.positionX.setValueAtTime(position[0], this.audioContext.currentTime);
    panner.positionY.setValueAtTime(position[1], this.audioContext.currentTime);
    panner.positionZ.setValueAtTime(position[2], this.audioContext.currentTime);

    // Connect based on receiver mode
    const outputNode = this.isReceiverModeActive && this.convolver
      ? this.convolver
      : this.masterGain;

    panner.connect(outputNode);

    // Create source handle
    const source = new AudioSourceHandleImpl(
      this.audioContext,
      audioBuffer,
      position,
      panner
    );

    this.sources.add(source);
    this.pannerNodes.set(source, panner);

    // Override setPosition to update panner
    const originalSetPosition = source.setPosition.bind(source);
    source.setPosition = (newPosition: [number, number, number]) => {
      originalSetPosition(newPosition);
      if (this.audioContext) {
        panner.positionX.setValueAtTime(newPosition[0], this.audioContext.currentTime);
        panner.positionY.setValueAtTime(newPosition[1], this.audioContext.currentTime);
        panner.positionZ.setValueAtTime(newPosition[2], this.audioContext.currentTime);
      }
    };

    return source;
  }

  setReceiverMode(isActive: boolean): void {
    if (this.isReceiverModeActive === isActive) return;

    this.isReceiverModeActive = isActive;

    // Rewire all sources
    this.sources.forEach(source => {
      const panner = this.pannerNodes.get(source);
      if (!panner) return;

      // Disconnect from current output
      panner.disconnect();

      // Reconnect to appropriate output
      const outputNode = isActive && this.convolver
        ? this.convolver
        : this.masterGain;

      if (outputNode) {
        panner.connect(outputNode);
      }
    });
  }

  updateListener(
    position: [number, number, number],
    orientation: [number, number, number]
  ): void {
    if (!this.listenerNode || !this.audioContext) return;

    // Update Three.js listener for positional audio
    // Orientation does NOT affect mono IR (0 DOF for IR)
    this.listenerNode.positionX.setValueAtTime(position[0], this.audioContext.currentTime);
    this.listenerNode.positionY.setValueAtTime(position[1], this.audioContext.currentTime);
    this.listenerNode.positionZ.setValueAtTime(position[2], this.audioContext.currentTime);

    // Ignore orientation for mono IR (head-locked)
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
    return true; // Mono IR requires receiver mode
  }

  getMode(): AudioRenderMode {
    return AudioRenderMode.MONO_IR;
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
    this.pannerNodes.clear();

    if (this.convolver) {
      this.convolver.disconnect();
      this.convolver = null;
    }

    if (this.masterGain) {
      this.masterGain.disconnect();
      this.masterGain = null;
    }
  }
}
