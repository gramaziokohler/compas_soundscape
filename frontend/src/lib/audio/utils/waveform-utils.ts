/**
 * Waveform Visualization Utilities
 *
 * Generates and renders audio waveforms with amplitude over time.
 * Used for impulse-response hover preview in the sidebar.
 */

import { AUDIO_VISUALIZATION } from "@/utils/constants";
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

/** Format IR duration for axis labels */
export function formatIrDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0';
  if (seconds < 0.01) return `${(seconds * 1_000_000).toFixed(0)} µs`;
  if (seconds < 1) return `${Math.round(seconds * 1000)} ms`;
  if (seconds < 10) return `${seconds.toFixed(2)} s`;
  return `${seconds.toFixed(1)} s`;
}

/** Format peak amplitude — linear for loud signals, dB for very quiet IR tails */
export function formatPeakAmplitude(peak: number): string {
  if (!Number.isFinite(peak) || peak <= 0) return '0';
  if (peak >= 0.1) return peak.toFixed(2);
  if (peak >= 0.01) return peak.toFixed(3);
  const db = 20 * Math.log10(peak);
  return `${db.toFixed(1)} dB`;
}

/**
 * Get channel names based on channel count
 * Returns appropriate labels for different audio formats
 */
export function getChannelNames(numChannels: number): string[] {
  if (numChannels === 1) {
    return ['Mono'];
  }

  if (numChannels === 2) {
    return ['L', 'R'];
  }

  if (numChannels === 4) {
    return ['W', 'Y', 'Z', 'X'];
  }

  if (numChannels === 16) {
    return ['W', 'Y', 'Z', 'X', 'V', 'T', 'R', 'S', 'U', 'Q', 'O', 'M', 'K', 'L', 'N', 'P'];
  }

  return Array.from({ length: numChannels }, (_, i) => `Ch ${i + 1}`);
}

function calculateRMS(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / samples.length);
}

function extractChannelWaveform(
  channelData: Float32Array,
  sampleRate: number,
  targetPoints: number
): ChannelWaveformData {
  const totalSamples = channelData.length;
  const effectivePoints = Math.min(targetPoints, totalSamples);
  const samplesPerPoint = effectivePoints > 0
    ? Math.max(1, Math.floor(totalSamples / effectivePoints))
    : 1;

  const amplitudes: number[] = [];
  const timePoints: number[] = [];
  let peakLinear = 0;

  for (let i = 0; i < effectivePoints; i++) {
    const startIdx = i * samplesPerPoint;
    const endIdx = Math.min(startIdx + samplesPerPoint, totalSamples);

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

    amplitudes.push(segmentPeak);
    const timeInSeconds = (startIdx + (endIdx - startIdx) / 2) / sampleRate;
    timePoints.push(timeInSeconds);
  }

  const rms = calculateRMS(channelData);

  return {
    amplitudes,
    timePoints,
    peak: peakLinear,
    rms,
  };
}

export function extractWaveformData(
  audioBuffer: AudioBuffer,
  targetPoints: number = AUDIO_VISUALIZATION.WAVEFORM_POINTS
): WaveformData {
  const numChannels = Math.min(audioBuffer.numberOfChannels, 16);
  const channels: ChannelWaveformData[] = [];

  for (let ch = 0; ch < numChannels; ch++) {
    const channelData = audioBuffer.getChannelData(ch);
    channels.push(extractChannelWaveform(channelData, audioBuffer.sampleRate, targetPoints));
  }

  return {
    channels,
    numChannels,
    duration: audioBuffer.duration,
  };
}

export function renderWaveform(
  canvas: HTMLCanvasElement,
  waveformData: WaveformData,
  channelLabels?: string[],
  viewport?: ViewportState
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (width <= 0 || height <= 0) return;

  const { zoom = 1, panX = 0, panY = 0 } = viewport || {};
  const labels = channelLabels || getChannelNames(waveformData.numChannels);
  const axis = AUDIO_VISUALIZATION.AXIS;

  const padding = {
    top: axis.PAD_TOP,
    right: axis.PAD_RIGHT,
    bottom: axis.PAD_BOTTOM,
    left: axis.PAD_LEFT,
  };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const root = typeof document !== 'undefined' ? document.documentElement : null;
  const getCssVar = (v: string, fallback: string) =>
    root ? getComputedStyle(root).getPropertyValue(v).trim() || fallback : fallback;

  const primaryColor = getCssVar('--color-primary', '#002aff');
  const labelColor = getCssVar('--color-secondary-hover', '#5c5f66');
  const axisColor = getCssVar('--color-border-strong', 'rgba(0,0,0,0.16)');
  const gridColor = getCssVar('--color-border', 'rgba(0,0,0,0.08)');
  const backgroundColor = getCssVar('--color-secondary-lighter', '#e4e3d9');
  const plotBorderColor = getCssVar('--color-border-strong', 'rgba(0,0,0,0.16)');

  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, width, height);

  const globalPeak = Math.max(
    ...waveformData.channels.map((ch) => ch.peak),
    1e-6
  );

  const isFoa = waveformData.numChannels === 4;
  const isMultiChannel = waveformData.numChannels > 1;
  const peakLabel = formatPeakAmplitude(globalPeak);
  const pkGap = axis.PK_GAP;
  const foaPkRowHeight = 10;

  type TrackSlot = { trackY: number; trackH: number; pkY: number | null };

  const trackSlots: TrackSlot[] = (() => {
    if (!isFoa) {
      const trackHeight = plotHeight / waveformData.numChannels;
      return waveformData.channels.map((_, channelIdx) => ({
        trackY: padding.top + channelIdx * trackHeight,
        trackH: trackHeight,
        pkY: null,
      }));
    }

    const channelCount = waveformData.numChannels;
    const gapCount = channelCount * 2 - 1;
    const trackH = (plotHeight - channelCount * foaPkRowHeight - gapCount * pkGap) / channelCount;

    let cursor = padding.top;
    return waveformData.channels.map(() => {
      const pkY = cursor + foaPkRowHeight - 2;
      cursor += foaPkRowHeight + pkGap;
      const trackY = cursor;
      cursor += trackH + pkGap;
      return { trackY, trackH, pkY };
    });
  })();

  const visibleFraction = 1 / zoom;
  const startFraction = 0.5 + panX - visibleFraction / 2;
  const endFraction = startFraction + visibleFraction;
  const visibleStartTime = Math.max(0, startFraction * waveformData.duration);
  const visibleEndTime = Math.min(waveformData.duration, endFraction * waveformData.duration);

  const drawDottedGrid = (trackY: number, trackH: number) => {
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 5]);

    const numVerticalLines = 8;
    for (let i = 0; i <= numVerticalLines; i++) {
      const dataFraction = startFraction + (i / numVerticalLines) * visibleFraction;
      if (dataFraction < 0 || dataFraction > 1) continue;

      const viewportFraction = (dataFraction - startFraction) / visibleFraction;
      const x = padding.left + viewportFraction * plotWidth;

      ctx.beginPath();
      ctx.moveTo(x, trackY);
      ctx.lineTo(x, trackY + trackH);
      ctx.stroke();
    }

    const centerY = trackY + trackH / 2;
    const numHorizontalLines = 4;
    for (let i = 0; i <= numHorizontalLines; i++) {
      const normalizedY = (i / numHorizontalLines - 0.5) * 2;
      const transformedY = centerY + (normalizedY * trackH / 2 - panY * trackH) * zoom;

      if (transformedY >= trackY && transformedY <= trackY + trackH) {
        ctx.beginPath();
        ctx.moveTo(padding.left, transformedY);
        ctx.lineTo(padding.left + plotWidth, transformedY);
        ctx.stroke();
      }
    }

    ctx.setLineDash([]);
  };

  const drawCenterAxis = (trackY: number, trackH: number) => {
    const centerY = trackY + trackH / 2;
    const transformedCenterY = centerY - panY * trackH * zoom;

    if (transformedCenterY >= trackY && transformedCenterY <= trackY + trackH) {
      ctx.strokeStyle = axisColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padding.left, transformedCenterY);
      ctx.lineTo(padding.left + plotWidth, transformedCenterY);
      ctx.stroke();
    }
  };

  const drawPeakGuides = (trackY: number, trackH: number, channelPeak: number) => {
    const centerY = trackY + trackH / 2;
    const maxAmplitude = trackH / 2;
    const normalizedPeak = channelPeak / globalPeak;
    const peakHeight = normalizedPeak * maxAmplitude * zoom;
    const verticalCenter = centerY - panY * trackH * zoom;

    ctx.save();
    ctx.strokeStyle = primaryColor;
    ctx.globalAlpha = 0.22;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);

    const topY = verticalCenter - peakHeight;
    const bottomY = verticalCenter + peakHeight;

    if (topY >= trackY && topY <= trackY + trackH) {
      ctx.beginPath();
      ctx.moveTo(padding.left, topY);
      ctx.lineTo(padding.left + plotWidth, topY);
      ctx.stroke();
    }

    if (bottomY >= trackY && bottomY <= trackY + trackH) {
      ctx.beginPath();
      ctx.moveTo(padding.left, bottomY);
      ctx.lineTo(padding.left + plotWidth, bottomY);
      ctx.stroke();
    }

    ctx.restore();
  };

  const drawChannelWaveform = (
    channelData: ChannelWaveformData,
    trackY: number,
    trackH: number,
    color: string
  ) => {
    const centerY = trackY + trackH / 2;
    const maxAmplitude = trackH / 2;

    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;

    ctx.save();
    ctx.beginPath();
    ctx.rect(padding.left, trackY, plotWidth, trackH);
    ctx.clip();

    const numPoints = channelData.amplitudes.length;
    const startIdx = Math.max(0, Math.floor(startFraction * numPoints));
    const endIdx = Math.min(numPoints - 1, Math.ceil(endFraction * numPoints));

    for (let i = startIdx; i <= endIdx; i++) {
      const amplitude = channelData.amplitudes[i] / globalPeak;
      const dataFraction = numPoints > 1 ? i / (numPoints - 1) : 0;
      const viewportFraction = (dataFraction - startFraction) / visibleFraction;
      const x = padding.left + viewportFraction * plotWidth;

      const verticalCenter = centerY - panY * trackH * zoom;
      const ampHeight = amplitude * maxAmplitude * zoom;

      ctx.beginPath();
      ctx.moveTo(x, verticalCenter - ampHeight);
      ctx.lineTo(x, verticalCenter + ampHeight);
      ctx.stroke();
    }

    ctx.restore();
  };

  waveformData.channels.forEach((channelData, channelIdx) => {
    const { trackY, trackH, pkY } = trackSlots[channelIdx];

    drawDottedGrid(trackY, trackH);
    drawPeakGuides(trackY, trackH, channelData.peak);
    drawCenterAxis(trackY, trackH);
    drawChannelWaveform(channelData, trackY, trackH, primaryColor);

    if (isMultiChannel && !isFoa) {
      ctx.fillStyle = labelColor;
      ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textAlign = 'left';
      const label = labels[channelIdx] || `Ch ${channelIdx + 1}`;
      ctx.fillText(label, padding.left + 4, trackY + 13);
    }

    if (isFoa && pkY !== null) {
      ctx.fillStyle = labelColor;
      ctx.font = '9px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textAlign = 'left';
      const label = labels[channelIdx] || `Ch ${channelIdx + 1}`;
      ctx.fillText(`pk ${formatPeakAmplitude(channelData.peak)} · ${label}`, padding.left, pkY);
    }
  });

  ctx.strokeStyle = plotBorderColor;
  ctx.lineWidth = 1;
  ctx.strokeRect(padding.left, padding.top, plotWidth, plotHeight);

  if (!isFoa) {
    ctx.fillStyle = labelColor;
    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`pk ${peakLabel}`, padding.left, padding.top - pkGap);
  }

  const xAxisY = padding.top + plotHeight;
  ctx.strokeStyle = axisColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding.left, xAxisY);
  ctx.lineTo(padding.left + plotWidth, xAxisY);
  ctx.stroke();

  ctx.fillStyle = labelColor;
  ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';

  ctx.textAlign = 'left';
  ctx.fillText(formatIrDuration(visibleStartTime), padding.left, xAxisY + 12);

  ctx.textAlign = 'right';
  const endLabel = zoom > 1.01 || Math.abs(panX) > 0.01
    ? formatIrDuration(visibleEndTime)
    : formatIrDuration(waveformData.duration);
  ctx.fillText(endLabel, padding.left + plotWidth, xAxisY + 12);
}

export function renderWaveformWithTheme(
  canvas: HTMLCanvasElement,
  waveformData: WaveformData,
  channelLabels?: string[]
): void {
  renderWaveform(canvas, waveformData, channelLabels);
}
