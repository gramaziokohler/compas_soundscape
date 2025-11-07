/**
 * AudioSourceHandle Implementation
 *
 * Concrete implementation of the AudioSourceHandle interface.
 * Wraps Web Audio API AudioBufferSourceNode with position control.
 */

import type { AudioSourceHandle } from '../types';

export class AudioSourceHandleImpl implements AudioSourceHandle {
  private source: AudioBufferSourceNode | null = null;
  private gainNode: GainNode;
  private position: [number, number, number];
  private audioContext: AudioContext;
  private audioBuffer: AudioBuffer;
  private isPlaying: boolean = false;
  private onEndedCallback: (() => void) | null = null;

  constructor(
    audioContext: AudioContext,
    audioBuffer: AudioBuffer,
    position: [number, number, number],
    outputNode: AudioNode
  ) {
    this.audioContext = audioContext;
    this.audioBuffer = audioBuffer;
    this.position = position;

    // Create gain node for volume control
    this.gainNode = audioContext.createGain();
    this.gainNode.connect(outputNode);
  }

  play(): void {
    if (this.isPlaying) {
      this.stop();
    }

    // Create new source (can only be played once)
    this.source = this.audioContext.createBufferSource();
    this.source.buffer = this.audioBuffer;
    this.source.connect(this.gainNode);

    // Set up ended callback
    this.source.onended = () => {
      this.isPlaying = false;
      if (this.onEndedCallback) {
        this.onEndedCallback();
      }
    };

    this.source.start(0);
    this.isPlaying = true;
  }

  pause(): void {
    // Web Audio API doesn't support pause, so we stop
    this.stop();
  }

  stop(): void {
    if (this.source && this.isPlaying) {
      try {
        this.source.stop();
      } catch (e) {
        // Already stopped
      }
      this.isPlaying = false;
    }
  }

  setVolume(volume: number): void {
    this.gainNode.gain.setValueAtTime(volume, this.audioContext.currentTime);
  }

  setPosition(position: [number, number, number]): void {
    this.position = position;
    // Position update handled by specific renderer implementations
  }

  getPosition(): [number, number, number] {
    return this.position;
  }

  connect(destination: AudioNode): void {
    this.gainNode.connect(destination);
  }

  disconnect(): void {
    this.gainNode.disconnect();
  }

  getOutputNode(): AudioNode {
    return this.gainNode;
  }

  setOnEndedCallback(callback: () => void): void {
    this.onEndedCallback = callback;
  }

  dispose(): void {
    this.stop();
    this.disconnect();
    this.source = null;
  }
}
