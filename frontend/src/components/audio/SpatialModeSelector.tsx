/**
 * Spatial Mode Selector
 *
 * Toggle between Three.js Positional Audio and Resonance Audio
 * for No IR rendering mode.
 */

'use client';

import React from 'react';
import { UI_COLORS } from '@/lib/constants';

interface SpatialModeSelectorProps {
  currentMode: 'threejs' | 'resonance';
  onModeChange: (mode: 'threejs' | 'resonance') => void;
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
          onClick={() => onModeChange('threejs')}
          className={`flex-1 px-3 py-2 text-xs rounded transition-colors ${
            currentMode === 'threejs'
              ? 'text-white'
              : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
          }`}
          style={currentMode === 'threejs' ? { backgroundColor: UI_COLORS.PRIMARY } : {}}
        >
          Three.js Positional
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
          Resonance Audio
        </button>
      </div>
      <p className="text-xs" style={{ color: UI_COLORS.NEUTRAL_500 }}>
        {currentMode === 'threejs'
          ? 'Simple distance-based attenuation with HRTF panning'
          : 'Advanced HRTF with room acoustics modeling'}
      </p>
    </div>
  );
}
