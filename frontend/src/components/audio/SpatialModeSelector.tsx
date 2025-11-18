/**
 * Spatial Mode Selector
 *
 * Toggle between Flat Anechoic and ShoeBox Acoustics
 * for No IR rendering mode.
 */

'use client';

import React from 'react';
import { UI_COLORS } from '@/lib/constants';

interface SpatialModeSelectorProps {
  currentMode: 'basic_mixer' | 'resonance';
  onModeChange: (mode: 'basic_mixer' | 'resonance') => void;
  className?: string;
}

export function SpatialModeSelector({
  currentMode,
  onModeChange,
  className = ''
}: SpatialModeSelectorProps) {
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <label className="text-xs font-medium" style={{ color: UI_COLORS.NEUTRAL_700 }}>
        Spatial Audio Renderer
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
      </div>
      <p className="text-xs" style={{ color: UI_COLORS.NEUTRAL_500 }}>
        {currentMode === 'basic_mixer'
          ? 'Simple audio mixer with no spatial processing'
          : 'Advanced HRTF with room acoustics modeling'}
      </p>
    </div>
  );
}