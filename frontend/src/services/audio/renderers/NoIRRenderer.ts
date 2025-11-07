/**
 * NoIRRenderer
 *
 * Renders audio without impulse response convolution.
 * Supports two modes: Three.js Positional Audio or Resonance Audio.
 * Full 6 DOF support (movement + rotation).
 */

import type { IAudioRenderer } from '../interfaces/IAudioRenderer';
import { AudioRenderMode, OutputDecoderType } from '../types';
import type { AudioSourceHandle } from '../types';
import { AudioSourceHandleImpl } from '../utils/AudioSourceHandleImpl';

export class NoIRRenderer implements IAudioRenderer {
  private audioContext: AudioContext | null = null;
  private listenerNode: AudioListener | null = null;
  private currentMode: 'threejs' | 'resonance' = 'threejs';
  private enabled: boolean = true;
  private outputDecoder: OutputDecoderType = OutputDecoderType.BINAURAL_HRTF;
  private masterGain: GainNode | null = null;
  private sources: Set<AudioSourceHandle> = new Set();

  // Three.js PositionalAudio simulation using PannerNode
  private pannerNodes: Map<AudioSourceHandle, PannerNode> = new Map();

  initialize(audioContext: AudioContext): void {
    this.audioContext = audioContext;
    this.listenerNode = audioContext.listener;
    this.masterGain = audioContext.createGain();
  }

  setPreferredMode(mode: 'threejs' | 'resonance'): void {
    this.currentMode = mode;
  }

  createSource(
    position: [number, number, number],
    audioBuffer: AudioBuffer
  ): AudioSourceHandle {
    if (!this.audioContext || !this.masterGain) {
      throw new Error('Renderer not initialized');
    }

    // Create panner node for spatial audio
    // Panning model determined by output decoder
    const panner = this.audioContext.createPanner();
    panner.panningModel = this.outputDecoder === OutputDecoderType.BINAURAL_HRTF ? 'HRTF' : 'equalpower';
    panner.distanceModel = 'inverse';
    panner.refDistance = 1;
    panner.maxDistance = 10000;
    panner.rolloffFactor = 1;
    panner.coneInnerAngle = 360;
    panner.coneOuterAngle = 0;
    panner.coneOuterGain = 0;

    // Set initial position
    panner.positionX.setValueAtTime(position[0], this.audioContext.currentTime);
    panner.positionY.setValueAtTime(position[1], this.audioContext.currentTime);
    panner.positionZ.setValueAtTime(position[2], this.audioContext.currentTime);

    // Connect panner to master gain
    panner.connect(this.masterGain);

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

  updateListener(
    position: [number, number, number],
    orientation: [number, number, number]
  ): void {
    if (!this.listenerNode || !this.audioContext) return;

    const [yaw, pitch, roll] = orientation;

    // Update listener position
    this.listenerNode.positionX.setValueAtTime(position[0], this.audioContext.currentTime);
    this.listenerNode.positionY.setValueAtTime(position[1], this.audioContext.currentTime);
    this.listenerNode.positionZ.setValueAtTime(position[2], this.audioContext.currentTime);

    // Calculate forward and up vectors from Euler angles
    const forward = [
      Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      -Math.cos(yaw) * Math.cos(pitch)
    ];

    const up = [
      -Math.sin(yaw) * Math.sin(pitch) * Math.cos(roll) + Math.cos(yaw) * Math.sin(roll),
      Math.cos(pitch) * Math.cos(roll),
      Math.cos(yaw) * Math.sin(pitch) * Math.cos(roll) + Math.sin(yaw) * Math.sin(roll)
    ];

    // Update listener orientation
    this.listenerNode.forwardX.setValueAtTime(forward[0], this.audioContext.currentTime);
    this.listenerNode.forwardY.setValueAtTime(forward[1], this.audioContext.currentTime);
    this.listenerNode.forwardZ.setValueAtTime(forward[2], this.audioContext.currentTime);

    this.listenerNode.upX.setValueAtTime(up[0], this.audioContext.currentTime);
    this.listenerNode.upY.setValueAtTime(up[1], this.audioContext.currentTime);
    this.listenerNode.upZ.setValueAtTime(up[2], this.audioContext.currentTime);
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
    return false; // No IR = no receiver mode constraint
  }

  getMode(): AudioRenderMode {
    return this.currentMode === 'threejs'
      ? AudioRenderMode.NO_IR_THREEJS
      : AudioRenderMode.NO_IR_RESONANCE;
  }

  getOutputNode(): AudioNode {
    if (!this.masterGain) {
      throw new Error('Renderer not initialized');
    }
    return this.masterGain;
  }

  setOutputDecoder(decoderType: OutputDecoderType): void {
    if (this.outputDecoder === decoderType) return;

    this.outputDecoder = decoderType;

    // Update panning model on all existing sources
    const panningModel = decoderType === OutputDecoderType.BINAURAL_HRTF ? 'HRTF' : 'equalpower';
    this.pannerNodes.forEach(panner => {
      panner.panningModel = panningModel;
    });

    console.log(`[NoIRRenderer] Output decoder changed to ${decoderType}, panning model: ${panningModel}`);
  }

  dispose(): void {
    this.sources.forEach(source => source.dispose());
    this.sources.clear();
    this.pannerNodes.clear();

    if (this.masterGain) {
      this.masterGain.disconnect();
      this.masterGain = null;
    }
  }
}
