/**
 * IRManagementPanel Component
 *
 * Panel for managing impulse response loading and activation.
 * Displays IR state, channel count, and provides action buttons.
 *
 * Features:
 * - File upload for IR loading
 * - Activate/Deactivate/Clear buttons
 * - IR state display (imported/selected)
 * - Channel count indication
 * - Warning messages
 * - Disabled states based on workflow
 *
 * Usage:
 * ```tsx
 * <IRManagementPanel
 *   irState={{ isImported: true, isSelected: false, channelCount: 4 }}
 *   onLoadIR={(file) => loadImpulseResponse(file)}
 *   onSelectIR={() => selectImpulseResponse()}
 *   onDeselectIR={() => deselectImpulseResponse()}
 *   onClearIR={() => clearImpulseResponse()}
 *   warnings={['⚠️ IR mode requires a receiver']}
 * />
 * ```
 */

'use client';

import React, { useRef } from 'react';
import {
  AUDIO_MODE_UI,
  AUDIO_WARNINGS,
  UI_COLORS,
  UI_BORDER_RADIUS,
  UI_SPACING,
  UI_FONT_SIZE,
  UI_TRANSITIONS,
  UI_SHADOWS,
  UI_BUTTON,
} from '@/lib/constants';

interface IRManagementPanelProps {
  irState: {
    isImported: boolean;
    isSelected: boolean;
    channelCount?: number;
  };
  onLoadIR: (file: File) => Promise<void>;
  onSelectIR: () => Promise<void>;
  onDeselectIR: () => Promise<void>;
  onClearIR: () => Promise<void>;
  warnings: string[];
  className?: string;
}

export function IRManagementPanel({
  irState,
  onLoadIR,
  onSelectIR,
  onDeselectIR,
  onClearIR,
  warnings,
  className = '',
}: IRManagementPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isLoading, setIsLoading] = React.useState(false);

  // Handle file selection
  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setIsLoading(true);
      await onLoadIR(file);
    } catch (error) {
      console.error('Failed to load IR:', error);
    } finally {
      setIsLoading(false);
      // Reset input so same file can be selected again
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Get channel count badge color
  const getChannelColor = (channels?: number) => {
    if (!channels) return UI_COLORS.NEUTRAL_500;
    if (channels === 1) return UI_COLORS.SUCCESS;
    if (channels === 2) return UI_COLORS.WARNING;
    if (channels === 4) return UI_COLORS.INFO;
    if (channels === 9) return UI_COLORS.SUCCESS;
    if (channels === 16) return UI_COLORS.SECONDARY;
    return UI_COLORS.NEUTRAL_500;
  };

  const channelColor = getChannelColor(irState.channelCount);

  return (
    <div className={`flex flex-col ${className}`} style={{ gap: UI_SPACING.SM }}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <label
          className="text-xs font-medium"
          style={{ color: UI_COLORS.NEUTRAL_700 }}
        >
          Impulse Response
        </label>
        {irState.channelCount && (
          <span
            className="px-2 py-0.5 text-xs font-mono font-semibold rounded"
            style={{
              backgroundColor: `${channelColor}20`,
              color: channelColor,
            }}
          >
            {irState.channelCount}ch
          </span>
        )}
      </div>

      {/* IR Status Card */}
      <div
        className="p-3 rounded"
        style={{
          backgroundColor: UI_COLORS.NEUTRAL_100,
          borderRadius: UI_BORDER_RADIUS.MD,
          border: `1px solid ${UI_COLORS.NEUTRAL_300}`,
        }}
      >
        {/* Status Indicators */}
        <div className="flex items-center gap-3 mb-2">
          {/* Imported Status */}
          <div className="flex items-center gap-1.5">
            <div
              className="w-2 h-2 rounded-full"
              style={{
                backgroundColor: irState.isImported
                  ? UI_COLORS.SUCCESS
                  : UI_COLORS.NEUTRAL_400,
              }}
            />
            <span
              className="text-xs"
              style={{
                color: irState.isImported
                  ? UI_COLORS.NEUTRAL_700
                  : UI_COLORS.NEUTRAL_500,
              }}
            >
              Imported
            </span>
          </div>

          {/* Selected Status */}
          <div className="flex items-center gap-1.5">
            <div
              className="w-2 h-2 rounded-full"
              style={{
                backgroundColor: irState.isSelected
                  ? UI_COLORS.PRIMARY
                  : UI_COLORS.NEUTRAL_400,
              }}
            />
            <span
              className="text-xs"
              style={{
                color: irState.isSelected
                  ? UI_COLORS.NEUTRAL_700
                  : UI_COLORS.NEUTRAL_500,
              }}
            >
              Active
            </span>
          </div>
        </div>

        {/* Status Message */}
        <p
          className="text-xs"
          style={{
            color: UI_COLORS.NEUTRAL_600,
            fontSize: '11px',
          }}
        >
          {!irState.isImported && 'No IR loaded'}
          {irState.isImported && !irState.isSelected && 'IR loaded, not active'}
          {irState.isImported && irState.isSelected && 'IR active in audio chain'}
        </p>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-col gap-2">
        {/* Load Button */}
        <input
          ref={fileInputRef}
          type="file"
          accept={AUDIO_MODE_UI.IR_SUPPORTED_FORMATS.join(',')}
          onChange={handleFileSelect}
          className="hidden"
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isLoading}
          className="w-full px-3 py-2 text-xs font-medium rounded transition-colors"
          style={{
                backgroundColor: UI_COLORS.PRIMARY,
            color: '#ffffff',
            borderRadius: UI_BORDER_RADIUS.MD,
            transition: UI_TRANSITIONS.COLORS,
            opacity: isLoading ? 0.6 : 1,
            cursor: isLoading ? 'not-allowed' : 'pointer',
          }}
          onMouseEnter={(e) => {
            if (!isLoading) {
              e.currentTarget.style.backgroundColor = UI_COLORS.PRIMARY_HOVER;
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = UI_COLORS.PRIMARY;
          }}
        >
          {isLoading ? '⏳ Loading...' : '📁 Load IR File'}
        </button>

        {/* Activate/Deactivate Buttons */}
        <div className="flex gap-2">
          <button
            onClick={onSelectIR}
            disabled={!irState.isImported || irState.isSelected}
            className="flex-1 px-3 py-2 text-xs font-medium rounded transition-colors"
            style={{
              backgroundColor:
                !irState.isImported || irState.isSelected
                  ? UI_COLORS.NEUTRAL_200
                  : UI_COLORS.SUCCESS,
              color:
                !irState.isImported || irState.isSelected
                  ? UI_COLORS.NEUTRAL_500
                  : '#ffffff',
              borderRadius: UI_BORDER_RADIUS.MD,
              transition: UI_TRANSITIONS.COLORS,
              cursor:
                !irState.isImported || irState.isSelected
                  ? 'not-allowed'
                  : 'pointer',
            }}
            onMouseEnter={(e) => {
              if (irState.isImported && !irState.isSelected) {
                e.currentTarget.style.backgroundColor = UI_COLORS.SUCCESS_HOVER;
              }
            }}
            onMouseLeave={(e) => {
              if (irState.isImported && !irState.isSelected) {
                e.currentTarget.style.backgroundColor = UI_COLORS.SUCCESS;
              }
            }}
          >
            ✓ Activate
          </button>

          <button
            onClick={onDeselectIR}
            disabled={!irState.isSelected}
            className="flex-1 px-3 py-2 text-xs font-medium rounded transition-colors"
            style={{
              backgroundColor: !irState.isSelected
                ? UI_COLORS.NEUTRAL_200
                : UI_COLORS.WARNING,
              color: !irState.isSelected ? UI_COLORS.NEUTRAL_500 : '#ffffff',
              borderRadius: UI_BORDER_RADIUS.MD,
              transition: UI_TRANSITIONS.COLORS,
              cursor: !irState.isSelected ? 'not-allowed' : 'pointer',
            }}
            onMouseEnter={(e) => {
              if (irState.isSelected) {
                e.currentTarget.style.backgroundColor = UI_COLORS.WARNING_HOVER;
              }
            }}
            onMouseLeave={(e) => {
              if (irState.isSelected) {
                e.currentTarget.style.backgroundColor = UI_COLORS.WARNING;
              }
            }}
          >
            ⏸ Deactivate
          </button>
        </div>

        {/* Clear Button */}
        <button
          onClick={onClearIR}
          disabled={!irState.isImported}
          className="w-full px-3 py-2 text-xs font-medium rounded transition-colors"
          style={{
            backgroundColor: !irState.isImported
              ? UI_COLORS.NEUTRAL_200
              : UI_COLORS.ERROR,
            color: !irState.isImported ? UI_COLORS.NEUTRAL_500 : '#ffffff',
            borderRadius: UI_BORDER_RADIUS.MD,
            transition: UI_TRANSITIONS.COLORS,
            cursor: !irState.isImported ? 'not-allowed' : 'pointer',
          }}
          onMouseEnter={(e) => {
            if (irState.isImported) {
              e.currentTarget.style.backgroundColor = UI_COLORS.ERROR_HOVER;
            }
          }}
          onMouseLeave={(e) => {
            if (irState.isImported) {
              e.currentTarget.style.backgroundColor = UI_COLORS.ERROR;
            }
          }}
        >
          🗑️ Clear IR
        </button>
      </div>

      {/* Warnings */}
      {warnings.length > 0 && (
        <div
          className="p-2 rounded flex flex-col gap-1"
          style={{
            backgroundColor: `${UI_COLORS.WARNING}10`,
            borderRadius: UI_BORDER_RADIUS.SM,
            border: `1px solid ${UI_COLORS.WARNING}30`,
          }}
        >
          {warnings.map((warning, index) => (
            <p
              key={index}
              className="text-xs flex items-start gap-1.5"
              style={{
                color: UI_COLORS.NEUTRAL_700,
                fontSize: '11px',
              }}
            >
              {warning}
            </p>
          ))}
        </div>
      )}

      {/* Help Text */}
      <div
        className="p-2 text-xs rounded"
        style={{
          backgroundColor: `${UI_COLORS.INFO}08`,
          borderRadius: UI_BORDER_RADIUS.SM,
          color: UI_COLORS.NEUTRAL_600,
          fontSize: '11px',
          lineHeight: '1.4',
        }}
      >
        💡 Supported formats: {AUDIO_MODE_UI.IR_SUPPORTED_FORMATS.join(', ')}
        <br />
        Max size: {AUDIO_MODE_UI.IR_FILE_MAX_SIZE_MB}MB
      </div>
    </div>
  );
}
