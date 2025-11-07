/**
 * Output Decoder Toggle
 *
 * Toggle between Binaural (HRTF) and Stereo Speakers output decoding.
 * Always available regardless of IR mode.
 */

'use client';

import React from 'react';
import { UI_COLORS } from '@/lib/constants';

type DecoderType = 'binaural' | 'stereo';

interface OutputDecoderToggleProps {
  currentDecoder: DecoderType;
  onDecoderChange: (decoder: DecoderType) => void;
  className?: string;
}

export function OutputDecoderToggle({
  currentDecoder,
  onDecoderChange,
  className = ''
}: OutputDecoderToggleProps) {
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <label className="text-xs font-medium" style={{ color: UI_COLORS.NEUTRAL_700 }}>
        Output Decoder
      </label>
      <div className="flex gap-2">
        <button
          onClick={() => onDecoderChange('binaural')}
          className={`flex-1 px-3 py-2 text-xs rounded transition-colors flex items-center justify-center gap-1.5 ${
            currentDecoder === 'binaural'
              ? 'text-white'
              : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
          }`}
          style={currentDecoder === 'binaural' ? { backgroundColor: UI_COLORS.PRIMARY } : {}}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 18v-6a9 9 0 0 1 18 0v6"/>
            <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>
          </svg>
          Binaural (HRTF)
        </button>
        <button
          onClick={() => onDecoderChange('stereo')}
          className={`flex-1 px-3 py-2 text-xs rounded transition-colors flex items-center justify-center gap-1.5 ${
            currentDecoder === 'stereo'
              ? 'text-white'
              : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
          }`}
          style={currentDecoder === 'stereo' ? { backgroundColor: UI_COLORS.PRIMARY } : {}}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="2" y="7" width="20" height="15" rx="2" ry="2"/>
            <polyline points="17 2 12 7 7 2"/>
          </svg>
          Stereo Speakers
        </button>
      </div>
      <p className="text-xs" style={{ color: UI_COLORS.NEUTRAL_500 }}>
        {currentDecoder === 'binaural'
          ? '🎧 Optimized for headphones with head-tracking'
          : '🔊 Optimized for stereo speaker playback'}
      </p>
    </div>
  );
}
