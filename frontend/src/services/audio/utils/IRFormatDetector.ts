/**
 * IR Format Detector
 *
 * Detects impulse response format based on channel count.
 * Supports: Mono (1ch), Binaural (2ch), FOA (4ch), TOA (16ch)
 */

import { AudioRenderMode } from '../types';
import type { IRFormat } from '../types';

export class IRFormatDetector {
  /**
   * Detect IR format from audio buffer
   */
  static detect(buffer: AudioBuffer): IRFormat {
    const channels = buffer.numberOfChannels;

    switch (channels) {
      case 1:
        return 'mono';
      case 2:
        return 'binaural';
      case 4:
        return 'foa';
      case 16:
        return 'toa';
      default:
        throw new Error(
          `Unsupported IR channel count: ${channels}. ` +
          `Supported: 1 (mono), 2 (binaural), 4 (FOA), 16 (TOA)`
        );
    }
  }

  /**
   * Get audio render mode from IR format
   */
  static getRenderMode(format: IRFormat): AudioRenderMode {
    switch (format) {
      case 'mono':
        return AudioRenderMode.MONO_IR;
      case 'binaural':
        return AudioRenderMode.SPATIAL_IR_BINAURAL;
      case 'foa':
        return AudioRenderMode.SPATIAL_IR_FOA;
      case 'toa':
        return AudioRenderMode.SPATIAL_IR_TOA;
    }
  }

  /**
   * Get DOF description for IR format
   */
  static getDOFDescription(format: IRFormat): string {
    switch (format) {
      case 'mono':
        return '6 DOF for sources, 0 DOF for IR (head-locked)';
      case 'binaural':
      case 'foa':
      case 'toa':
        return '3 DOF rotation (static position at receiver)';
    }
  }

  /**
   * Get UI notice message for IR format
   */
  static getUINotice(format: IRFormat, isActive: boolean): string {
    if (!isActive) {
      const formatName = IRFormatDetector.getFormatName(format);
      return `${formatName} IR loaded but inactive (not in receiver mode)`;
    }

    switch (format) {
      case 'mono':
        return 'Mono IR active: Head-locked mode (no rotation affects IR)';
      case 'binaural':
        return 'Binaural (2ch) IR active: 3DoF rotation enabled (static position)';
      case 'foa':
        return 'FOA (4ch) IR active: 3DoF rotation enabled (static position)';
      case 'toa':
        return 'TOA (16ch) IR active: 3DoF rotation enabled (static position)';
    }
  }

  /**
   * Get human-readable format name
   */
  static getFormatName(format: IRFormat): string {
    switch (format) {
      case 'mono':
        return 'Mono';
      case 'binaural':
        return 'Binaural (2ch)';
      case 'foa':
        return 'FOA (4ch)';
      case 'toa':
        return 'TOA (16ch)';
    }
  }
}
