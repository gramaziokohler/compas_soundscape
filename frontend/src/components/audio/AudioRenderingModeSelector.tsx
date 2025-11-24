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
import { UI_COLORS } from '@/lib/constants';

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
    <div className={`flex flex-col gap-2 ${className}`}>
      <label className="text-xs font-semibold" style={{ color: UI_COLORS.NEUTRAL_700 }}>
        Audio Rendering Mode
      </label>
      <div className="flex gap-2">
        <button
          onClick={() => onModeChange('anechoic')}
          className={`flex-1 px-3 py-2 text-xs rounded transition-colors ${
            currentMode === 'anechoic'
              ? 'text-white'
              : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
          }`}
          style={currentMode === 'anechoic' ? { backgroundColor: UI_COLORS.PRIMARY } : {}}
        >
          No Acoustics
        </button>
        <button
          onClick={() => onModeChange('resonance')}
          className={`flex-1 px-3 py-2 text-xs rounded transition-colors ${
            currentMode === 'resonance'
              ? 'text-white'
              : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
          }`}
          style={currentMode === 'resonance' ? { backgroundColor: UI_COLORS.PRIMARY } : {}}
        >
          ShoeBox Acoustics
        </button>
        <button
          onClick={() => onModeChange('precise')}
          className={`flex-1 px-3 py-2 text-xs rounded transition-colors ${
            currentMode === 'precise'
              ? 'text-white'
              : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
          }`}
          style={currentMode === 'precise' ? { backgroundColor: UI_COLORS.PRIMARY } : {}}
        >
          Precise Acoustics
        </button>
      </div>
      <p className="text-xs" style={{ color: UI_COLORS.NEUTRAL_500 }}>
        {currentMode === 'anechoic' && 'Dry signal only - no room reflections or acoustics'}
        {currentMode === 'resonance' && 'Advanced HRTF with room acoustics modeling'}
        {currentMode === 'precise' && 'Custom impulse response convolution for precise acoustics'}
      </p>
    </div>
  );
}
