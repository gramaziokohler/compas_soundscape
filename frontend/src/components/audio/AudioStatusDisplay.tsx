/**
 * AudioStatusDisplay Component
 *
 * Real-time status overlay showing current audio mode, IR status, and warnings.
 * Auto-hides when there are no warnings and no active changes.
 *
 * Features:
 * - Current mode badge with color coding
 * - IR active indicator
 * - DOF indication
 * - Ambisonic order display
 * - Warning messages
 * - Auto-fade transitions
 * - Minimal, non-intrusive design
 *
 * Usage:
 * ```tsx
 * <AudioStatusDisplay
 *   status={{
 *     currentMode: AudioMode.ANECHOIC,
 *     isReceiverModeActive: false,
 *     isIRActive: false,
 *     ambisonicOrder: 1,
 *     dofDescription: '6 DOF',
 *     uiNotice: null
 *   }}
 *   warnings={[]}
 *   onClearWarnings={() => {}}
 * />
 * ```
 */

'use client';

import React, { useEffect, useState } from 'react';
import { AudioMode } from '@/types/audio';
import type { OrchestratorStatus } from '@/types/audio';
import {
  AUDIO_MODE_DESCRIPTIONS,
  AUDIO_MODE_COLORS,
  AMBISONIC_ORDER_INFO,
  UI_COLORS,
  UI_BORDER_RADIUS,
  UI_SPACING,
  UI_FONT_SIZE,
  UI_SHADOWS,
  UI_OPACITY,
} from '@/lib/constants';

interface AudioStatusDisplayProps {
  status: OrchestratorStatus | null;
  warnings: string[];
  onClearWarnings: () => void;
  className?: string;
  alwaysShow?: boolean; // Override auto-hide behavior
}

export function AudioStatusDisplay({
  status,
  warnings,
  onClearWarnings,
  className = '',
  alwaysShow = false,
}: AudioStatusDisplayProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(Date.now());

  // Auto-show on updates, auto-hide after delay
  useEffect(() => {
    if (!status) return;

    setIsVisible(true);
    setLastUpdate(Date.now());

    // Auto-hide if no warnings and not forced to show
    if (!alwaysShow && warnings.length === 0) {
      const timer = setTimeout(() => {
        setIsVisible(false);
      }, 3000); // Hide after 3 seconds

      return () => clearTimeout(timer);
    }
  }, [status, warnings, alwaysShow]);

  // Don't render if no status
  if (!status) return null;

  // Get mode info
  const modeKey = status.currentMode as keyof typeof AUDIO_MODE_DESCRIPTIONS;
  const modeInfo = AUDIO_MODE_DESCRIPTIONS[modeKey];
  const modeColor = AUDIO_MODE_COLORS[modeKey];
  const orderInfo = AMBISONIC_ORDER_INFO[status.ambisonicOrder];

  // Determine if we should show (always show if warnings exist)
  const shouldShow = alwaysShow || warnings.length > 0 || isVisible;

  return (
    <div
      className={`fixed top-4 right-4 z-50 transition-all duration-300 ${className}`}
      style={{
        opacity: shouldShow ? 1 : 0,
        transform: shouldShow ? 'translateY(0)' : 'translateY(-20px)',
        pointerEvents: shouldShow ? 'auto' : 'none',
      }}
    >
      <div
        className="p-3 rounded-lg backdrop-blur-sm"
        style={{
          backgroundColor: `rgba(0, 0, 0, ${UI_OPACITY.BACKDROP})`,
          borderRadius: UI_BORDER_RADIUS.LG,
          border: `1px solid rgba(255, 255, 255, ${UI_OPACITY.SUBTLE})`,
          boxShadow: UI_SHADOWS.OVERLAY,
          minWidth: '280px',
          maxWidth: '360px',
        }}
      >
        {/* Mode Header */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-base">{modeInfo.icon}</span>
            <span
              className="text-sm font-semibold"
              style={{ color: modeColor }}
            >
              {modeInfo.shortName}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {/* DOF Badge */}
            <span
              className="px-2 py-0.5 text-xs font-mono rounded"
              style={{
                backgroundColor: `${modeColor}25`,
                color: modeColor,
                fontSize: '10px',
              }}
            >
              {status.dofDescription}
            </span>
          </div>
        </div>

        {/* Status Indicators */}
        <div className="flex flex-col gap-1.5 mb-2">
          {/* IR Status */}
          <div className="flex items-center gap-2">
            <div
              className="w-2 h-2 rounded-full"
              style={{
                backgroundColor: status.isIRActive
                  ? UI_COLORS.PRIMARY
                  : UI_COLORS.NEUTRAL_500,
              }}
            />
            <span
              className="text-xs"
              style={{
                color: status.isIRActive
                  ? UI_COLORS.NEUTRAL_100
                  : UI_COLORS.NEUTRAL_400,
              }}
            >
              {status.isIRActive ? 'IR Active' : 'No IR'}
            </span>
          </div>

          {/* Receiver Status (if in IR mode) */}
          {modeInfo.requiresReceiver && (
            <div className="flex items-center gap-2">
              <div
                className="w-2 h-2 rounded-full"
                style={{
                  backgroundColor: status.isReceiverModeActive
                    ? UI_COLORS.SUCCESS
                    : UI_COLORS.WARNING,
                }}
              />
              <span
                className="text-xs"
                style={{
                  color: status.isReceiverModeActive
                    ? UI_COLORS.NEUTRAL_100
                    : UI_COLORS.WARNING,
                }}
              >
                {status.isReceiverModeActive ? 'Receiver Active' : 'No Receiver'}
              </span>
            </div>
          )}

          {/* Ambisonic Order (if applicable) */}
          {status.currentMode === AudioMode.AMBISONIC_IR && (
            <div className="flex items-center gap-2">
              <span className="text-sm">{orderInfo.icon}</span>
              <span
                className="text-xs"
                style={{ color: UI_COLORS.NEUTRAL_100 }}
              >
                {orderInfo.name} ({orderInfo.channels}ch)
              </span>
            </div>
          )}
        </div>

        {/* UI Notice */}
        {status.uiNotice && (
          <div
            className="p-2 rounded text-xs mb-2"
            style={{
              backgroundColor: `${UI_COLORS.INFO}20`,
              color: UI_COLORS.INFO_LIGHT,
              borderRadius: UI_BORDER_RADIUS.SM,
              fontSize: '11px',
            }}
          >
            {status.uiNotice}
          </div>
        )}

        {/* Warnings */}
        {warnings.length > 0 && (
          <div
            className="p-2 rounded flex flex-col gap-1.5"
            style={{
              backgroundColor: `${UI_COLORS.WARNING}20`,
              borderRadius: UI_BORDER_RADIUS.SM,
              border: `1px solid ${UI_COLORS.WARNING}50`,
            }}
          >
            {warnings.map((warning, index) => (
              <p
                key={index}
                className="text-xs flex items-start gap-1.5"
                style={{
                  color: UI_COLORS.WARNING_LIGHT,
                  fontSize: '11px',
                  lineHeight: '1.4',
                }}
              >
                {warning}
              </p>
            ))}

            {/* Clear Warnings Button */}
            <button
              onClick={onClearWarnings}
              className="mt-1 px-2 py-1 text-xs rounded transition-colors self-end"
              style={{
                backgroundColor: `${UI_COLORS.WARNING}40`,
                color: UI_COLORS.WARNING_LIGHT,
                borderRadius: UI_BORDER_RADIUS.SM,
                fontSize: '10px',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = `${UI_COLORS.WARNING}60`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = `${UI_COLORS.WARNING}40`;
              }}
            >
              Clear Warnings
            </button>
          </div>
        )}

        {/* Description */}
        <p
          className="text-xs mt-2 leading-tight"
          style={{
            color: UI_COLORS.NEUTRAL_300,
            fontSize: '11px',
          }}
        >
          {modeInfo.description}
        </p>
      </div>
    </div>
  );
}
