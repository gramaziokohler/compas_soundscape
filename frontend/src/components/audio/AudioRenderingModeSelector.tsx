/**
 * Audio Rendering Mode Selector
 *
 * Three-button selector for audio rendering mode:
 * - No Acoustics: Dry signal only (no room acoustics)
 * - ShoeBox Acoustics: Advanced HRTF with room acoustics
 * - Precise Acoustics: User-uploaded impulse response convolution
 *
 * Only one mode can be active at a time.
 */

'use client';

import React from 'react';
import { UI_COLORS } from '@/utils/constants';

export type AudioRenderingMode = 'anechoic' | 'resonance' | 'precise';

interface AudioRenderingModeSelectorProps {
  currentMode: AudioRenderingMode;
  onModeChange: (mode: AudioRenderingMode) => void;
  className?: string;
}

export function AudioRenderingModeSelector({
  currentMode,
  onModeChange,
  className = ''
}: AudioRenderingModeSelectorProps) {
  return (
    <select
      value={currentMode}
      onChange={(e) => onModeChange(e.target.value as AudioRenderingMode)}
      className={`flex-1 text-xs px-2 py-1 text-white rounded focus:outline-none focus:ring-1 focus:ring-white ${className}`}
      style={{
        backgroundColor: UI_COLORS.PRIMARY,
        borderRadius: '8px'
      }}
    >
      <option value="anechoic">No Acoustics</option>
      <option value="resonance">ShoeBox Acoustics</option>
      <option value="precise">Precise Acoustics</option>
    </select>
  );
}
