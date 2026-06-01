'use client';

import { useEffect, useRef } from 'react';
import { extractWaveformData, renderWaveform } from '@/lib/audio/utils/waveform-utils';
import { AUDIO_VISUALIZATION } from '@/utils/constants';
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
  /** Optional: Hide the text info below the waveform */
  hideTextInfo?: boolean;
  /** Optional: Callback to remove/clear this audio — shows an X button top-right */
  onClear?: () => void;
  /** Optional: Compact mode — reduces waveform height to fit tighter layouts */
  compact?: boolean;
}

/**
 * Audio Waveform Display Component
 *
 * Displays a graphical waveform with mirrored positive/negative amplitudes,
 * followed by minimal text info (title, sample rate, channels).
 * Features:
 * - Black background with primary color waveform
 * - Dotted grid background
 * - Dual-track display for stereo
 * - X and Y axis with labels
 * - Interactive zoom (mouse wheel) and pan (drag)
 * - Reset button and double-click to reset view
 */
export function AudioWaveformDisplay({
  audioBuffer,
  audioInfo,
  enableWaveform = AUDIO_VISUALIZATION.ENABLE_WAVEFORM_DISPLAY,
  channelLabels,
  hideTextInfo = false,
  onClear,
  compact = false,
}: AudioWaveformDisplayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Zoom and pan interaction
  const { viewport, isDragging, resetViewport } = useWaveformInteraction({ canvasRef });

  useEffect(() => {
    if (!enableWaveform || !canvasRef.current || !audioBuffer || !containerRef.current) return;

    const canvas = canvasRef.current;
    const container = containerRef.current;

    // Get container width to ensure waveform fits
    const containerWidth = container.clientWidth;
    const width = Math.min(containerWidth, AUDIO_VISUALIZATION.WAVEFORM_WIDTH);
    
    // Dynamic height based on channel count
    // Base height for 1-2 channels, scale up for multi-channel (FOA/TOA)
    const numChannels = audioBuffer.numberOfChannels;
    let height: number;

    if (compact) {
      height = numChannels === 4 ? 120 : numChannels >= 8 ? 160 : 72;
    } else if (numChannels === 4) {
      // FOA (4-channel): Increase height for better readability
      height = Math.min(600, AUDIO_VISUALIZATION.WAVEFORM_HEIGHT * 1.5);
    } else if (numChannels >= 8) {
      // TOA (16-channel) or multi-channel: Significantly taller
      height = Math.min(800, AUDIO_VISUALIZATION.WAVEFORM_HEIGHT * 2);
    } else {
      height = AUDIO_VISUALIZATION.WAVEFORM_HEIGHT;
    }

    // Set canvas size with device pixel ratio for crisp rendering
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(dpr, dpr);
    }

    // Extract waveform data
    const waveformData = extractWaveformData(
      audioBuffer,
      AUDIO_VISUALIZATION.WAVEFORM_POINTS
    );

    // Render waveform with viewport transform
    renderWaveform(canvas, waveformData, channelLabels, viewport);
  }, [audioBuffer, enableWaveform, channelLabels, viewport]);

  if (!enableWaveform) {
    // Fallback to text-only display
    return (
      <div className="p-3 bg-neutral-100 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-600 rounded-lg">
        <p className="text-xs font-semibold text-neutral-800 dark:text-neutral-300 mb-2">Audio Information</p>
        <div className="text-xs text-neutral-700 dark:text-neutral-400 space-y-1">
          <div className="flex justify-between">
            <span>File:</span>
            <span className="text-xs">{audioInfo.filename}</span>
          </div>
          <div className="flex justify-between">
            <span>Sample Rate:</span>
            <span className="text-xs">{audioInfo.sample_rate} Hz</span>
          </div>
          <div className="flex justify-between">
            <span>Channels:</span>
            <span className="text-xs">{audioInfo.channels}</span>
          </div>
        </div>
      </div>
    );
  }

  const hoverTitle = !hideTextInfo
    ? `${audioInfo.filename}\n${audioInfo.sample_rate} Hz · ${audioInfo.duration.toFixed(2)}s · ${audioInfo.channels}ch`
    : undefined;

  return (
    <div
      ref={containerRef}
      className="relative overflow-hidden rounded"
      title={hoverTitle}
    >
      <canvas
        ref={canvasRef}
        className="w-full block"
        style={{ cursor: isDragging ? 'grabbing' : viewport.zoom > 1 ? 'grab' : 'default' }}
      />

      {/* Reset zoom button */}
      {viewport.zoom > 1 && (
        <button
          onClick={resetViewport}
          className={`absolute top-1 bg-black/70 hover:bg-black/90 text-white p-1 rounded text-xs transition-colors ${onClear ? 'right-7' : 'right-1'}`}
          title="Reset zoom (or double-click)"
        >
          Reset
        </button>
      )}

      {/* Clear / X button */}
      {onClear && (
        <button
          onClick={onClear}
          className="absolute top-1 right-1 bg-black/70 hover:bg-red-600 text-white w-5 h-5 flex items-center justify-center rounded text-xs transition-colors"
          title="Remove audio"
        >
          ✕
        </button>
      )}
    </div>
  );
}
