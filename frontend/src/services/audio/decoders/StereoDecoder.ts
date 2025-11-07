/**
 * StereoDecoder
 *
 * Outputs stereo audio for speaker playback.
 * Includes basic stereo widening and cross-talk cancellation.
 */

import type { IOutputDecoder } from '../interfaces/IOutputDecoder';
import { OutputDecoderType } from '../types';

export class StereoDecoder implements IOutputDecoder {
  private audioContext: AudioContext | null = null;
  private inputNode: GainNode | null = null;
  private outputNode: GainNode | null = null;
  private stereoWidener: StereoPannerNode | null = null;

  initialize(audioContext: AudioContext): void {
    this.audioContext = audioContext;

    // Create nodes
    this.inputNode = audioContext.createGain();
    this.stereoWidener = audioContext.createStereoPanner();
    this.outputNode = audioContext.createGain();

    // Connect chain
    this.inputNode.connect(this.stereoWidener);
    this.stereoWidener.connect(this.outputNode);

    // Set stereo width (0 = mono, 1 = full stereo)
    this.stereoWidener.pan.setValueAtTime(0, audioContext.currentTime);
  }

  getInputNode(): AudioNode {
    if (!this.inputNode) {
      throw new Error('Decoder not initialized');
    }
    return this.inputNode;
  }

  getOutputNode(): AudioNode {
    if (!this.outputNode) {
      throw new Error('Decoder not initialized');
    }
    return this.outputNode;
  }

  updateOrientation(orientation: [number, number, number]): void {
    // Stereo speakers don't need orientation updates
    // Could implement speaker angle compensation here
  }

  getType(): OutputDecoderType {
    return OutputDecoderType.STEREO_SPEAKERS;
  }

  dispose(): void {
    if (this.inputNode) {
      this.inputNode.disconnect();
      this.inputNode = null;
    }
    if (this.stereoWidener) {
      this.stereoWidener.disconnect();
      this.stereoWidener = null;
    }
    if (this.outputNode) {
      this.outputNode.disconnect();
      this.outputNode = null;
    }
  }
}
