/**
 * Spatial Anechoic Mode Toggle
 *
 * Toggle for enabling/disabling Spatial Anechoic mode (dry signal only).
 * When enabled, audio is rendered without any room acoustics or reflections.
 *
 * Features:
 * - Simple on/off toggle
 * - Visual feedback with icon
 * - Descriptive help text
 */

'use client';

import React from 'react';
import { UI_COLORS, AUDIO_MODE_DESCRIPTIONS, UI_FONT_SIZE, UI_TRANSITIONS } from '@/lib/constants';

// Toggle switch dimensions
const TOGGLE_SWITCH = {
  WIDTH: '36px',       // 9 * 4px (Tailwind w-9)
  HEIGHT: '20px',      // 5 * 4px (Tailwind h-5)
  THUMB_SIZE: '16px',  // 4 * 4px (Tailwind w-4 h-4)
  THUMB_OFFSET_OFF: '2px',  // 0.5 * 4px (Tailwind translate-x-0.5)
  THUMB_OFFSET_ON: '20px',  // 5 * 4px (Tailwind translate-x-5)
} as const;

interface AnechoicModeToggleProps {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  className?: string;
}

export function AnechoicModeToggle({
  enabled,
  onToggle,
  className = ''
}: AnechoicModeToggleProps) {
  const anechoicInfo = AUDIO_MODE_DESCRIPTIONS.anechoic;

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <div className="flex items-center justify-between">
        <label 
          className="font-medium" 
          style={{ 
            fontSize: `${UI_FONT_SIZE.XS}px`,
            color: UI_COLORS.NEUTRAL_700 
          }}
        >
          {anechoicInfo.name}
        </label>
        <button
          onClick={() => onToggle(!enabled)}
          className="relative inline-flex items-center rounded-full"
          style={{
            width: TOGGLE_SWITCH.WIDTH,
            height: TOGGLE_SWITCH.HEIGHT,
            backgroundColor: enabled ? UI_COLORS.PRIMARY : UI_COLORS.NEUTRAL_300,
            transition: UI_TRANSITIONS.COLORS
          }}
          aria-label={`Toggle ${anechoicInfo.name.toLowerCase()}`}
        >
          <span
            className="inline-block rounded-full"
            style={{
              width: TOGGLE_SWITCH.THUMB_SIZE,
              height: TOGGLE_SWITCH.THUMB_SIZE,
              backgroundColor: '#FFFFFF',
              transform: enabled 
                ? `translateX(${TOGGLE_SWITCH.THUMB_OFFSET_ON})` 
                : `translateX(${TOGGLE_SWITCH.THUMB_OFFSET_OFF})`,
              transition: 'transform 200ms ease-in-out'
            }}
          />
        </button>
      </div>
      <p 
        className="text-xs" 
        style={{ color: UI_COLORS.NEUTRAL_500 }}
      >
        {enabled
          ? `${anechoicInfo.icon} ${anechoicInfo.description}`
          : '🎵 Room acoustics active (when IR or ShoeBox enabled)'}
      </p>
    </div>
  );
}
