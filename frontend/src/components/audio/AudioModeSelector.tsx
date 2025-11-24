/**
 * AudioModeSelector Component
 *
 * Dropdown component for selecting audio rendering mode.
 * Displays all 6 modes with icons, names, descriptions, and DOF info.
 * Disables modes that require unmet prerequisites (IR or receiver).
 *
 * Features:
 * - Visual mode cards with icons and descriptions
 * - Requirements validation (IR, receiver)
 * - DOF indication (3 DOF vs 6 DOF)
 * - Color-coded mode types
 * - Disabled state for unavailable modes
 *
 * Usage:
 * ```tsx
 * <AudioModeSelector
 *   currentMode={AudioMode.ANECHOIC}
 *   onModeChange={(mode) => setMode({ mode, ambisonicOrder: 1 })}
 *   hasIR={false}
 *   hasReceiver={false}
 * />
 * ```
 */

'use client';

import React from 'react';
import { AudioMode } from '@/types/audio';
import {
  AUDIO_MODE_DESCRIPTIONS,
  AUDIO_MODE_COLORS,
  UI_COLORS,
  UI_BORDER_RADIUS,
  UI_SPACING,
  UI_FONT_SIZE,
  UI_TRANSITIONS,
  UI_SHADOWS,
} from '@/lib/constants';

interface AudioModeSelectorProps {
  currentMode: AudioMode;
  onModeChange: (mode: AudioMode) => void;
  hasIR: boolean;
  hasReceiver: boolean;
  className?: string;
}

export function AudioModeSelector({
  currentMode,
  onModeChange,
  hasIR,
  hasReceiver,
  className = '',
}: AudioModeSelectorProps) {
  // Map AudioMode enum to description keys
  const modeKey = currentMode as keyof typeof AUDIO_MODE_DESCRIPTIONS;
  const currentModeInfo = AUDIO_MODE_DESCRIPTIONS[modeKey];

  // Check if mode is available based on requirements
  const isModeAvailable = (mode: AudioMode): boolean => {
    const key = mode as keyof typeof AUDIO_MODE_DESCRIPTIONS;
    const info = AUDIO_MODE_DESCRIPTIONS[key];

    // IR modes require IR to be loaded
    if (info.requiresIR && !hasIR) {
      return false;
    }

    // Receiver modes require receiver placement
    if (info.requiresReceiver && !hasReceiver) {
      return false;
    }

    return true;
  };

  // Get all modes in order
  const allModes = [
    AudioMode.ANECHOIC,
    AudioMode.NO_IR_RESONANCE,
    AudioMode.MONO_IR,
    AudioMode.STEREO_IR,
    AudioMode.AMBISONIC_IR,
  ];

  return (
    <div className={`flex flex-col ${className}`} style={{ gap: UI_SPACING.SM }}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <label
          className="text-xs font-medium"
          style={{ color: UI_COLORS.NEUTRAL_700 }}
        >
          Audio Rendering Mode
        </label>
        <span
          className="text-xs font-mono"
          style={{ color: UI_COLORS.NEUTRAL_500 }}
        >
          {currentModeInfo.dof}
        </span>
      </div>

      {/* Mode Grid */}
      <div
        className="grid grid-cols-2 gap-2"
        style={{ fontSize: UI_FONT_SIZE.XS }}
      >
        {allModes.map((mode) => {
          const key = mode as keyof typeof AUDIO_MODE_DESCRIPTIONS;
          const info = AUDIO_MODE_DESCRIPTIONS[key];
          const color = AUDIO_MODE_COLORS[key];
          const isSelected = mode === currentMode;
          const isAvailable = isModeAvailable(mode);

          return (
            <button
              key={mode}
              onClick={() => isAvailable && onModeChange(mode)}
              disabled={!isAvailable}
              className={`
                relative p-3 text-left
                transition-all duration-200
                ${isSelected ? 'ring-2' : 'hover:scale-[1.02]'}
                ${!isAvailable ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
              `}
              style={{
                backgroundColor: isSelected
                  ? `${color}15`
                  : UI_COLORS.NEUTRAL_100,
                borderRadius: UI_BORDER_RADIUS.MD,
                border: `1px solid ${isSelected ? color : UI_COLORS.NEUTRAL_300}`,
                boxShadow: isSelected ? UI_SHADOWS.MD : UI_SHADOWS.SM,
                transition: UI_TRANSITIONS.NORMAL,
                ...(isSelected && { outline: `2px solid ${color}`, outlineOffset: '1px' }),
              }}
            >
              {/* Icon and Name */}
              <div className="flex items-center gap-2 mb-1">
                <span className="text-base">{info.icon}</span>
                <span
                  className="font-medium"
                  style={{
                    color: isSelected ? color : UI_COLORS.NEUTRAL_800,
                    fontSize: UI_FONT_SIZE.SM,
                  }}
                >
                  {info.shortName}
                </span>
              </div>

              {/* Description */}
              <p
                className="text-xs leading-tight mb-2"
                style={{ color: UI_COLORS.NEUTRAL_600 }}
              >
                {info.description}
              </p>

              {/* DOF Badge */}
              <div className="flex items-center gap-2">
                <span
                  className="px-1.5 py-0.5 text-xs font-mono rounded"
                  style={{
                    backgroundColor: isSelected
                      ? `${color}25`
                      : UI_COLORS.NEUTRAL_100,
                    color: isSelected ? color : UI_COLORS.NEUTRAL_600,
                    fontSize: '10px',
                  }}
                >
                  {info.dof}
                </span>

                {/* Requirements Badge */}
                {(info.requiresIR || info.requiresReceiver) && (
                  <span
                    className="px-1.5 py-0.5 text-xs rounded"
                    style={{
                      backgroundColor: isAvailable
                        ? `${UI_COLORS.SUCCESS}15`
                        : `${UI_COLORS.ERROR}15`,
                      color: isAvailable
                        ? UI_COLORS.SUCCESS
                        : UI_COLORS.ERROR,
                      fontSize: '10px',
                    }}
                  >
                    {info.requiresIR && 'IR'}
                    {info.requiresIR && info.requiresReceiver && '+'}
                    {info.requiresReceiver && 'RX'}
                  </span>
                )}
              </div>

              {/* Selected Indicator */}
              {isSelected && (
                <div
                  className="absolute top-2 right-2 w-2 h-2 rounded-full"
                  style={{ backgroundColor: color }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Current Mode Details */}
      <div
        className="p-2 text-xs rounded"
        style={{
          backgroundColor: `${AUDIO_MODE_COLORS[modeKey]}08`,
          borderRadius: UI_BORDER_RADIUS.SM,
          color: UI_COLORS.NEUTRAL_700,
        }}
      >
        <p className="font-medium mb-1" style={{ color: AUDIO_MODE_COLORS[modeKey] }}>
          {currentModeInfo.name}
        </p>
        <p style={{ fontSize: '11px', lineHeight: '1.4' }}>
          {currentModeInfo.details}
        </p>
      </div>

      {/* Requirements Notice */}
      {(!hasIR || !hasReceiver) && (
        <div
          className="p-2 text-xs rounded"
          style={{
            backgroundColor: `${UI_COLORS.WARNING}10`,
            borderRadius: UI_BORDER_RADIUS.SM,
            color: UI_COLORS.NEUTRAL_600,
            fontSize: '11px',
          }}
        >
          {!hasIR && <div>💡 Load an IR to unlock IR-based modes</div>}
          {!hasReceiver && <div>💡 Place a receiver to enable 3 DOF modes</div>}
        </div>
      )}
    </div>
  );
}
