'use client';

import { useEffect, useRef } from 'react';
import {
  extractWaveformData,
  formatIrDuration,
  getChannelNames,
  renderWaveform,
} from '@/lib/audio/utils/waveform-utils';
import { AUDIO_VISUALIZATION } from '@/utils/constants';
import { useResolvedColorTheme } from '@/hooks/useResolvedColorTheme';
import { useWaveformInteraction } from '@/hooks/useWaveformInteraction';
import type { SEDAudioInfo } from '@/types';

interface AudioWaveformDisplayProps {
  /** Audio buffer to visualize */
  audioBuffer: AudioBuffer;
  /** Audio metadata for text display */
  audioInfo: SEDAudioInfo;
  /** Optional: Override waveform display enable/disable */
  enableWaveform?: boolean;
  /** Optional: Channel labels (e.g., ["L", "R"] for stereo) */
  channelLabels?: string[];
  /** Optional: Hide the metadata header above the waveform */
  hideTextInfo?: boolean;
  /** Optional: Callback to remove/clear this audio — shows an X button top-right */
  onClear?: () => void;
  /** Optional: Compact mode — reduces waveform height to fit tighter layouts */
  compact?: boolean;
  /** Optional: Callback fired when the user clicks "Download IR" — button only renders when provided */
  onDownload?: () => void;
}

function DownloadIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

/**
 * Full impulse-response waveform for hover preview.
 * Shows amplitude axes, per-channel peak labels, and IR duration on the time axis.
 */
export function AudioWaveformDisplay({
  audioBuffer,
  audioInfo,
  enableWaveform = AUDIO_VISUALIZATION.ENABLE_WAVEFORM_DISPLAY,
  channelLabels,
  hideTextInfo = false,
  onClear,
  compact = false,
  onDownload,
}: AudioWaveformDisplayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const colorTheme = useResolvedColorTheme();

  const resolvedChannelLabels = channelLabels ?? getChannelNames(audioBuffer.numberOfChannels);
  const { viewport, isDragging, resetViewport } = useWaveformInteraction({ canvasRef });

  useEffect(() => {
    if (!enableWaveform || !canvasRef.current || !audioBuffer || !containerRef.current) return;

    const canvas = canvasRef.current;
    const container = containerRef.current;

    const containerWidth = container.clientWidth;
    const width = Math.min(containerWidth, AUDIO_VISUALIZATION.WAVEFORM_WIDTH);

    const numChannels = audioBuffer.numberOfChannels;
    let height: number;

    if (compact) {
      height = numChannels === 4 ? 112 : numChannels >= 8 ? 144 : 70;
    } else if (numChannels === 4) {
      height = Math.min(480, AUDIO_VISUALIZATION.WAVEFORM_HEIGHT * 1.6);
    } else if (numChannels >= 8) {
      height = Math.min(640, AUDIO_VISUALIZATION.WAVEFORM_HEIGHT * 2.2);
    } else {
      height = AUDIO_VISUALIZATION.WAVEFORM_HEIGHT;
    }

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
    }

    const waveformData = extractWaveformData(
      audioBuffer,
      AUDIO_VISUALIZATION.WAVEFORM_POINTS
    );

    renderWaveform(canvas, waveformData, resolvedChannelLabels, viewport);
  }, [audioBuffer, enableWaveform, resolvedChannelLabels, viewport, compact, colorTheme]);

  if (!enableWaveform) {
    return (
      <div
        className="p-3 rounded-lg border text-xs"
        style={{
          backgroundColor: 'var(--color-surface-2)',
          borderColor: 'var(--color-border-strong)',
          color: 'var(--color-secondary-hover)',
        }}
      >
        <p className="font-semibold mb-2" style={{ color: 'var(--color-foreground)' }}>
          Audio Information
        </p>
        <div className="space-y-1">
          <div className="flex justify-between gap-4">
            <span>File</span>
            <span className="truncate">{audioInfo.filename}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span>Sample rate</span>
            <span>{audioInfo.sample_rate} Hz</span>
          </div>
          <div className="flex justify-between gap-4">
            <span>Channels</span>
            <span>{audioInfo.channels}</span>
          </div>
        </div>
      </div>
    );
  }

  const hoverTitle = !hideTextInfo
    ? `${audioInfo.filename}\n${audioInfo.sample_rate} Hz · ${formatIrDuration(audioInfo.duration)} · ${audioInfo.channels}`
    : undefined;

  const graphBg = 'var(--color-secondary-lighter)';

  return (
    <div
      ref={containerRef}
      className="relative overflow-hidden"
      style={{ width: AUDIO_VISUALIZATION.WAVEFORM_WIDTH }}
      title={hoverTitle}
    >
      {!hideTextInfo && (
        <div
          className="flex items-center justify-between gap-2 px-2 py-1.5"
          style={{ backgroundColor: graphBg }}
        >
          <div className="min-w-0">
            <p
              className="text-xs font-medium truncate"
              style={{ color: 'var(--color-foreground)' }}
            >
              {audioInfo.filename}
            </p>
            <p className="text-[10px] mt-0.5" style={{ color: 'var(--color-secondary-hover)' }}>
              {audioInfo.sample_rate} Hz · {audioInfo.channels}
            </p>
          </div>
          {onDownload && (
            <button
              type="button"
              title="Download IR"
              onClick={onDownload}
              className="shrink-0 flex items-center rounded p-1 transition-colors hover:opacity-80"
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--color-secondary-hover)',
                cursor: 'pointer',
              }}
            >
              <DownloadIcon />
            </button>
          )}
        </div>
      )}

      <div className="relative">
        <canvas
          ref={canvasRef}
          className="block w-full"
          style={{
            cursor: isDragging ? 'grabbing' : viewport.zoom > 1 ? 'grab' : 'default',
            backgroundColor: graphBg,
          }}
        />

        {viewport.zoom > 1 && (
          <button
            type="button"
            onClick={resetViewport}
            className={`absolute top-1 px-1.5 py-0.5 rounded text-[10px] transition-colors ${onClear ? 'right-7' : 'right-1'}`}
            style={{
              backgroundColor: 'var(--color-overlay-bg)',
              color: 'var(--color-foreground)',
              border: '1px solid var(--color-border-strong)',
            }}
            title="Reset zoom (or double-click)"
          >
            Reset
          </button>
        )}

        {onClear && (
          <button
            type="button"
            onClick={onClear}
            className="absolute top-1 right-1 w-5 h-5 flex items-center justify-center rounded text-xs transition-colors"
            style={{
              backgroundColor: 'var(--color-overlay-bg)',
              color: 'var(--color-foreground)',
              border: '1px solid var(--color-border-strong)',
            }}
            title="Remove audio"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}
