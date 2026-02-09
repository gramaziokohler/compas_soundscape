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
  hideTextInfo = false
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
    let height: number = AUDIO_VISUALIZATION.WAVEFORM_HEIGHT;
    
    if (numChannels === 4) {
      // FOA (4-channel): Increase height for better readability
      height = Math.min(600, AUDIO_VISUALIZATION.WAVEFORM_HEIGHT * 1.5);
    } else if (numChannels >= 8) {
      // TOA (16-channel) or multi-channel: Significantly taller
      height = Math.min(800, AUDIO_VISUALIZATION.WAVEFORM_HEIGHT * 2);
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
      <div className="p-3 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg">
        <p className="text-xs font-semibold text-gray-800 dark:text-gray-300 mb-2">Audio Information</p>
        <div className="text-xs text-gray-700 dark:text-gray-400 space-y-1">
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

  return (
    <div ref={containerRef} className="bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden">
      {/* Waveform canvas container with reset button */}
      <div className="relative">
        <canvas
          ref={canvasRef}
          className="w-full"
          style={{ cursor: isDragging ? 'grabbing' : viewport.zoom > 1 ? 'grab' : 'default' }}
        />

        {/* Reset zoom button - top right corner */}
        {viewport.zoom > 1 && (
          <button
            onClick={resetViewport}
            className="absolute top-2 right-2 bg-black/70 hover:bg-black/90 text-white p-1.5 rounded text-xs transition-colors"
            title="Reset zoom (or double-click)"
          >
            Reset
          </button>
        )}
      </div>

      {/* Minimal text info - 2 lines (conditionally rendered) */}
      {!hideTextInfo && (
        <div className="px-3 py-2 text-xs text-gray-700 dark:text-gray-400 space-y-0.5">
          <div className="truncate" title={audioInfo.filename}>
            {audioInfo.filename}
          </div>
          <div className="flex gap-4">
            <span>{audioInfo.sample_rate} Hz</span>
            <span>{audioInfo.duration.toFixed(2)}s</span>
          </div>
        </div>
      )}
    </div>
  );
}
