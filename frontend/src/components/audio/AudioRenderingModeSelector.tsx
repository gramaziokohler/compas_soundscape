/**
 * Audio Rendering Mode Selector
 *
 * Three-button selector for audio rendering mode:
 * - Flat Anechoic: Simple distance-based attenuation
 * - ShoeBox Acoustics: Advanced HRTF with room acoustics
 * - Spatial Anechoic: Dry signal only (no room acoustics)
 *
 * Only one mode can be active at a time.
 */

'use client';

import React from 'react';
import { UI_COLORS } from '@/lib/constants';

export type AudioRenderingMode = 'basic_mixer' | 'resonance' | 'anechoic';

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
      <label className="text-xs font-medium" style={{ color: UI_COLORS.NEUTRAL_700 }}>
        Audio Rendering Mode
      </label>
      <div className="flex gap-2">
        <button
          onClick={() => onModeChange('basic_mixer')}
          className={`flex-1 px-3 py-2 text-xs rounded transition-colors ${
            currentMode === 'basic_mixer'
              ? 'text-white'
              : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
          }`}
          style={currentMode === 'basic_mixer' ? { backgroundColor: UI_COLORS.PRIMARY } : {}}
        >
          Flat Anechoic
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
          onClick={() => onModeChange('anechoic')}
          className={`flex-1 px-3 py-2 text-xs rounded transition-colors ${
            currentMode === 'anechoic'
              ? 'text-white'
              : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
          }`}
          style={currentMode === 'anechoic' ? { backgroundColor: UI_COLORS.PRIMARY } : {}}
        >
          Spatial Anechoic
        </button>
      </div>
      <p className="text-xs" style={{ color: UI_COLORS.NEUTRAL_500 }}>
        {currentMode === 'basic_mixer' && 'Simple audio mixer with no spatial processing'}
        {currentMode === 'resonance' && 'Advanced HRTF with room acoustics modeling'}
        {currentMode === 'anechoic' && '🔇 Dry signal only - no room reflections or acoustics'}
      </p>
    </div>
  );
}
