/**
 * BinauralDecoder
 *
 * Outputs binaural (HRTF) audio for headphone listening.
 * Currently a pass-through as HRTF is handled by PannerNode.
 * Can be extended with custom HRTF implementation.
 */

import type { IOutputDecoder } from '../interfaces/IOutputDecoder';
import { OutputDecoderType } from '../types';

export class BinauralDecoder implements IOutputDecoder {
  private audioContext: AudioContext | null = null;
  private inputNode: GainNode | null = null;
  private outputNode: GainNode | null = null;

  initialize(audioContext: AudioContext): void {
    this.audioContext = audioContext;

    // Create pass-through nodes
    this.inputNode = audioContext.createGain();
    this.outputNode = audioContext.createGain();

    // Direct connection (HRTF handled by PannerNode upstream)
    this.inputNode.connect(this.outputNode);
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
    // Orientation handled by AudioListener in NoIRRenderer
    // For future custom HRTF implementation, would apply rotation here
  }

  getType(): OutputDecoderType {
    return OutputDecoderType.BINAURAL_HRTF;
  }

  dispose(): void {
    if (this.inputNode) {
      this.inputNode.disconnect();
      this.inputNode = null;
    }
    if (this.outputNode) {
      this.outputNode.disconnect();
      this.outputNode = null;
    }
  }
}
