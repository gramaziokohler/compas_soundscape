/**
 * Waveform Visualization Utilities
 *
 * Generates and renders audio waveforms with amplitude in dB over time.
 * Used for audio analysis visualization in the sidebar.
 *
 * Features:
 * - Black background with primary/grey colors
 * - Dotted grid background
 * - Mirrored positive/negative amplitudes
 * - Multi-channel display (1-16 channels)
 * - Ambisonic channel labeling (FOA/TOA)
 * - Axis labels and legend
 */

import { AUDIO_VISUALIZATION, AMBISONIC } from "@/utils/constants";
import type { ViewportState } from "@/hooks/useWaveformInteraction";

/**
 * Waveform data structure for a single channel
 */
export interface ChannelWaveformData {
  /** Array of amplitude values (linear, 0-1 range) */
  amplitudes: number[];
  /** Time points corresponding to each amplitude sample */
  timePoints: number[];
  /** Peak amplitude (linear) */
  peak: number;
  /** RMS amplitude (linear) */
  rms: number;
}

/**
 * Complete waveform data structure
 */
export interface WaveformData {
  /** Channel data (1-16 channels) */
  channels: ChannelWaveformData[];
  /** Number of channels */
  numChannels: number;
  /** Duration in seconds */
  duration: number;
}

/**
 * Get channel names based on channel count
 * Returns appropriate labels for different audio formats
 *
 * @param numChannels - Number of audio channels
 * @returns Array of channel names
 */
export function getChannelNames(numChannels: number): string[] {
  if (numChannels === 1) {
    return ['Mono'];
  }
  
  if (numChannels === 2) {
    return ['L', 'R'];
  }
  
  if (numChannels === 4) {
    // First-Order Ambisonics (FOA) - SN3D/ACN ordering
    return [...AMBISONIC.FOA_CHANNEL_NAMES];
  }
  
  if (numChannels === 16) {
    // Third-Order Ambisonics (TOA) - SN3D/ACN ordering
    return [...AMBISONIC.TOA_CHANNEL_NAMES];
  }
  
  // Generic multi-channel
  return Array.from({ length: numChannels }, (_, i) => `Ch ${i + 1}`);
}

/**
 * Calculate RMS (Root Mean Square) amplitude
 *
 * @param samples - Array of audio samples
 * @returns RMS amplitude value
 */
function calculateRMS(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / samples.length);
}

/**
 * Extract waveform data from a single channel
 *
 * @param channelData - Float32Array of audio samples for one channel
 * @param sampleRate - Sample rate in Hz
 * @param targetPoints - Number of visualization points
 * @returns Channel waveform data
 */
function extractChannelWaveform(
  channelData: Float32Array,
  sampleRate: number,
  targetPoints: number
): ChannelWaveformData {
  const totalSamples = channelData.length;
  const samplesPerPoint = Math.floor(totalSamples / targetPoints);

  const amplitudes: number[] = [];
  const timePoints: number[] = [];

  let peakLinear = 0;

  // Extract peak amplitude for each visualization point
  for (let i = 0; i < targetPoints; i++) {
    const startIdx = i * samplesPerPoint;
    const endIdx = Math.min(startIdx + samplesPerPoint, totalSamples);

    // Find peak amplitude in this segment
    let segmentPeak = 0;
    for (let j = startIdx; j < endIdx; j++) {
      const absValue = Math.abs(channelData[j]);
      if (absValue > segmentPeak) {
        segmentPeak = absValue;
      }
    }

    if (segmentPeak > peakLinear) {
      peakLinear = segmentPeak;
    }

    // Store linear amplitude (0-1 range)
    amplitudes.push(segmentPeak);

    // Calculate time point in seconds
    const timeInSeconds = (startIdx + (endIdx - startIdx) / 2) / sampleRate;
    timePoints.push(timeInSeconds);
  }

  // Calculate overall RMS
  const rms = calculateRMS(channelData);

  return {
    amplitudes,
    timePoints,
    peak: peakLinear,
    rms
  };
}

/**
 * Extract waveform data from AudioBuffer
 *
 * Downsamples the audio to a target number of points for efficient visualization.
 * Uses peak detection to preserve important amplitude information.
 * Supports mono, stereo, FOA (4-ch), and TOA (16-ch) audio.
 *
 * @param audioBuffer - AudioBuffer to analyze
 * @param targetPoints - Number of visualization points (from AUDIO_VISUALIZATION.WAVEFORM_POINTS)
 * @returns Waveform data with channel information
 */
export function extractWaveformData(
  audioBuffer: AudioBuffer,
  targetPoints: number = AUDIO_VISUALIZATION.WAVEFORM_POINTS
): WaveformData {
  const numChannels = Math.min(audioBuffer.numberOfChannels, 16); // Support up to 16 channels
  const channels: ChannelWaveformData[] = [];

  // Extract each channel
  for (let ch = 0; ch < numChannels; ch++) {
    const channelData = audioBuffer.getChannelData(ch);
    const channelWaveform = extractChannelWaveform(
      channelData,
      audioBuffer.sampleRate,
      targetPoints
    );
    channels.push(channelWaveform);
  }

  return {
    channels,
    numChannels,
    duration: audioBuffer.duration
  };
}

/**
 * Render waveform to canvas
 *
 * Features:
 * - Black background
 * - Primary color (#F500B8) for waveforms
 * - Grey for labels and grid
 * - Dotted grid background
 * - Mirrored positive/negative amplitudes around center axis
 * - Multi-channel display (1-16 channels, stacked vertically)
 * - X and Y axis with labels
 * - Channel labels (supports ambisonic naming)
 * - Zoom and pan support via viewport parameter
 *
 * @param canvas - HTML canvas element to render to
 * @param waveformData - Waveform data to visualize
 * @param channelLabels - Optional channel labels (if not provided, auto-generated from channel count)
 * @param viewport - Optional viewport state for zoom/pan (default: zoom=1, pan=0)
 */
export function renderWaveform(
  canvas: HTMLCanvasElement,
  waveformData: WaveformData,
  channelLabels?: string[],
  viewport?: ViewportState
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const width = canvas.width;
  const height = canvas.height;

  // Default viewport if not provided
  const { zoom = 1, panX = 0, panY = 0 } = viewport || {};

  // Get channel labels (auto-generate if not provided)
  const labels = channelLabels || getChannelNames(waveformData.numChannels);

  // Minimal padding - axis labels inside, extra space at bottom for time labels
  const padding = { top: 10, right: width/3 +5, bottom: height/3 +10, left: 5 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const root = typeof document !== 'undefined' ? document.documentElement : null;
  const getCssVar = (v: string, fallback: string) =>
    root ? getComputedStyle(root).getPropertyValue(v).trim() || fallback : fallback;

  const primaryColor = getCssVar('--color-primary', '#f500b8');
  const greyColor = getCssVar('--color-secondary-hover', '#9CA3AF');
  const gridColor = getCssVar('--color-secondary-hover', '#4B5563');
  const backgroundColor = getCssVar('--background', '#000000');

  // Clear canvas with black background
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, width, height);

  // Compute global peak amplitude across all channels for Y-axis auto-zoom
  const globalPeak = Math.max(
    ...waveformData.channels.map(ch => ch.peak),
    1e-6 // avoid division by zero
  );

  // Determine layout based on number of channels
  const isMultiChannel = waveformData.numChannels > 1;
  const trackHeight = plotHeight / waveformData.numChannels;

  // Helper function to draw dotted grid with viewport transform
  const drawDottedGrid = (trackY: number, trackH: number) => {
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 4]); // Dotted pattern

    // Vertical grid lines (time) - follow horizontal zoom/pan
    const numVerticalLines = 10;
    const visibleFraction = 1 / zoom;
    const startFraction = 0.5 + panX - visibleFraction / 2;

    for (let i = 0; i <= numVerticalLines; i++) {
      const dataFraction = startFraction + (i / numVerticalLines) * visibleFraction;
      if (dataFraction < 0 || dataFraction > 1) continue; // Skip lines outside bounds

      const viewportFraction = (dataFraction - startFraction) / visibleFraction;
      const x = padding.left + viewportFraction * plotWidth;

      ctx.beginPath();
      ctx.moveTo(x, trackY);
      ctx.lineTo(x, trackY + trackH);
      ctx.stroke();
    }

    // Horizontal grid lines (amplitude) - follow vertical zoom/pan
    const numHorizontalLines = 8;
    const centerY = trackY + trackH / 2;

    for (let i = 0; i <= numHorizontalLines; i++) {
      const normalizedY = (i / numHorizontalLines - 0.5) * 2; // -1 to +1
      const transformedY = centerY + (normalizedY * trackH / 2 - panY * trackH) * zoom;

      // Only draw lines within track bounds
      if (transformedY >= trackY && transformedY <= trackY + trackH) {
        ctx.beginPath();
        ctx.moveTo(padding.left, transformedY);
        ctx.lineTo(padding.left + plotWidth, transformedY);
        ctx.stroke();
      }
    }

    ctx.setLineDash([]); // Reset to solid lines
  };

  // Helper function to draw center axis with viewport transform
  const drawCenterAxis = (trackY: number, trackH: number) => {
    const centerY = trackY + trackH / 2;
    const transformedCenterY = centerY - panY * trackH * zoom;

    // Only draw if center axis is within track bounds
    if (transformedCenterY >= trackY && transformedCenterY <= trackY + trackH) {
      ctx.strokeStyle = greyColor;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(padding.left, transformedCenterY);
      ctx.lineTo(padding.left + plotWidth, transformedCenterY);
      ctx.stroke();
    }
  };

  // Helper function to draw waveform for one channel with viewport transform
  const drawChannelWaveform = (
    channelData: ChannelWaveformData,
    trackY: number,
    trackH: number,
    color: string
  ) => {
    const centerY = trackY + trackH / 2;
    const maxAmplitude = trackH / 2;

    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.5;

    // Set clipping region to prevent waveforms from overlapping into other tracks
    ctx.save();
    ctx.beginPath();
    ctx.rect(padding.left, trackY, plotWidth, trackH);
    ctx.clip();

    // Calculate visible range based on zoom and pan
    const numPoints = channelData.amplitudes.length;
    const visibleFraction = 1 / zoom; // How much of the waveform is visible
    const startFraction = 0.5 + panX - visibleFraction / 2; // Start point (0-1)
    const endFraction = startFraction + visibleFraction; // End point (0-1)

    const startIdx = Math.max(0, Math.floor(startFraction * numPoints));
    const endIdx = Math.min(numPoints - 1, Math.ceil(endFraction * numPoints));

    // Draw mirrored waveform (positive and negative) for visible range
    for (let i = startIdx; i <= endIdx; i++) {
      // Normalize amplitude against global peak so the waveform fills the track
      const amplitude = channelData.amplitudes[i] / globalPeak;

      // Map data index to canvas X coordinate
      const dataFraction = i / (numPoints - 1); // Position in data (0-1)
      const viewportFraction = (dataFraction - startFraction) / visibleFraction; // Position in viewport (0-1)
      const x = padding.left + viewportFraction * plotWidth;

      // Apply vertical pan and zoom
      const verticalCenter = centerY - panY * trackH * zoom;
      const ampHeight = amplitude * maxAmplitude * zoom;

      // Draw vertical line from -amplitude to +amplitude
      ctx.beginPath();
      ctx.moveTo(x, verticalCenter - ampHeight);
      ctx.lineTo(x, verticalCenter + ampHeight);
      ctx.stroke();
    }

    // Restore context (remove clipping)
    ctx.restore();
  };

  // Render each channel
  waveformData.channels.forEach((channelData, channelIdx) => {
    const trackY = padding.top + (channelIdx * trackHeight);

    // Draw grid
    drawDottedGrid(trackY, trackHeight);

    // Draw center axis
    drawCenterAxis(trackY, trackHeight);

    // Draw waveform
    drawChannelWaveform(channelData, trackY, trackHeight, primaryColor);

    // Draw channel label
    if (isMultiChannel) {
      ctx.fillStyle = greyColor;
      ctx.font = '10px monospace';
      ctx.textAlign = 'left';
      const label = labels[channelIdx] || `Ch ${channelIdx + 1}`;
      ctx.fillText(label, padding.left + 5, trackY + 15);
    }
  });

  // Draw Y axis labels (amplitude) - INSIDE the plot area on left, following vertical transform
  // Labels reflect the actual peak amplitude instead of a fixed ±1 range
  ctx.fillStyle = greyColor;
  ctx.textAlign = 'left';
  ctx.font = '8px monospace';

  const peakLabel = globalPeak >= 0.01
    ? globalPeak.toFixed(2)
    : globalPeak.toExponential(1);
  const ampLevels = [`+${peakLabel}`, '0', `-${peakLabel}`];

  // Draw labels for each track
  waveformData.channels.forEach((_, channelIdx) => {
    const trackY = padding.top + (channelIdx * trackHeight);
    const centerY = trackY + trackHeight / 2;

    ampLevels.forEach((label, idx) => {
      const normalizedY = (idx / (ampLevels.length - 1) - 0.5) * 2; // -1 to +1
      const transformedY = centerY + (normalizedY * trackHeight / 2 - panY * trackHeight) * zoom;

      // Only draw label if within track bounds
      if (transformedY >= trackY && transformedY <= trackY + trackHeight) {
        ctx.fillText(label, padding.left + 3, transformedY + 3);
      }
    });
  });
}

/**
 * Render waveform (no theme support needed - always black background)
 *
 * @param canvas - HTML canvas element
 * @param waveformData - Waveform data
 * @param channelLabels - Optional channel labels
 */
export function renderWaveformWithTheme(
  canvas: HTMLCanvasElement,
  waveformData: WaveformData,
  channelLabels?: string[]
): void {
  renderWaveform(canvas, waveformData, channelLabels);
}
