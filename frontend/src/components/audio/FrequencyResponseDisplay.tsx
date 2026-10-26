'use client';

import { useEffect, useMemo, useRef } from 'react';
import { computeFrequencyResponse, formatFrequency } from '@/lib/audio/utils/frequency-response';
import { getChannelNames } from '@/lib/audio/utils/waveform-utils';
import { useResolvedColorTheme } from '@/hooks/useResolvedColorTheme';
import { AUDIO_VISUALIZATION } from '@/utils/constants';
import { getDefaultWaveformHeight } from '@/components/audio/AudioWaveformDisplay';
import { useElementSize } from '@/hooks/useElementSize';
import { useWaveformInteraction } from '@/hooks/useWaveformInteraction';

interface FrequencyResponseDisplayProps {
  audioBuffer: AudioBuffer;
  /** Linear gain applied to the IR (import-irs gain); shifts the curve by 20·log10(scale) dB. */
  amplitudeScale?: number;
  /** Fill the parent (which must have a definite size) instead of using the fixed preview size. */
  fill?: boolean;
}

const CHANNEL_COLOR_VARS = ['--color-primary', '--color-warning', '--color-success', '--color-error'] as const;

/**
 * Log-frequency magnitude plot of an impulse response (1/6-octave smoothed).
 * Same footprint as AudioWaveformDisplay so the preview keeps its size when switching modes.
 *
 * Usage: `<FrequencyResponseDisplay audioBuffer={buffer} />`
 */
export function FrequencyResponseDisplay({ audioBuffer, amplitudeScale, fill = false }: FrequencyResponseDisplayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fillSize = useElementSize(containerRef, fill);
  const colorTheme = useResolvedColorTheme();
  const data = useMemo(() => computeFrequencyResponse(audioBuffer), [audioBuffer]);
  const channelLabels = useMemo(() => getChannelNames(audioBuffer.numberOfChannels), [audioBuffer]);
  const gainDb = amplitudeScale !== undefined && amplitudeScale > 0 ? 20 * Math.log10(amplitudeScale) : 0;
  const fixedHeight = getDefaultWaveformHeight(audioBuffer.numberOfChannels);
  const { viewport, isDragging, resetViewport } = useWaveformInteraction({ canvasRef });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const width = fill ? fillSize.width : AUDIO_VISUALIZATION.WAVEFORM_WIDTH;
    const height = fill ? fillSize.height : fixedHeight;
    if (width <= 0 || height <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const css = getComputedStyle(document.documentElement);
    const cssVar = (name: string) => css.getPropertyValue(name).trim() || 'currentColor';
    const labelColor = cssVar('--color-secondary-hover');
    const axisColor = cssVar('--color-border-strong');
    const gridColor = cssVar('--color-border');

    const cfg = AUDIO_VISUALIZATION.FREQUENCY_RESPONSE;
    const pad = { left: 30, right: 6, top: 14, bottom: 16 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = cssVar('--color-secondary-lighter');
    ctx.fillRect(0, 0, width, height);

    const { frequencies, channelsDb } = data;
    let maxDb = -Infinity;
    for (const ch of channelsDb) for (const v of ch) if (v + gainDb > maxDb) maxDb = v + gainDb;
    if (!Number.isFinite(maxDb)) maxDb = 0;
    const topDb = Math.ceil(maxDb / cfg.DB_STEP) * cfg.DB_STEP;
    const bottomDb = topDb - cfg.DB_RANGE;

    const fMin = frequencies[0];
    const fMax = frequencies[frequencies.length - 1];
    const logSpan = Math.log(fMax / fMin);

    // Viewport: the visible window over the full data range, as fractions (0..1).
    const { zoom, panX, panY } = viewport;
    const visible = 1 / zoom;
    const startX = 0.5 + panX - visible / 2;
    const startY = 0.5 + panY - visible / 2;
    const xOf = (f: number) => pad.left + (((Math.log(f / fMin) / logSpan) - startX) / visible) * plotW;
    const yOf = (db: number) => {
      const frac = (topDb - Math.max(bottomDb, Math.min(topDb, db))) / cfg.DB_RANGE;
      return pad.top + ((frac - startY) / visible) * plotH;
    };

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    ctx.clip();
    ctx.font = '9px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 5]);
    ctx.strokeStyle = gridColor;
    ctx.fillStyle = labelColor;
    ctx.textAlign = 'right';
    const dbStep = zoom >= 4 ? 2 : zoom >= 2 ? 5 : cfg.DB_STEP;
    for (let db = topDb; db >= bottomDb; db -= dbStep) {
      const y = yOf(db);
      if (y < pad.top - 0.5 || y > pad.top + plotH + 0.5) continue;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(pad.left + plotW, y);
      ctx.stroke();
      ctx.fillText(`${db}`, pad.left - 3, y + 3);
    }
    ctx.textAlign = 'center';
    const freqTicks: number[] = [];
    const multipliers = zoom >= 2 ? [1, 2, 3, 4, 5, 6, 7, 8, 9] : [1, 2, 5];
    for (let decade = 10; decade <= fMax; decade *= 10) {
      for (const m of multipliers) {
        const f = decade * m;
        if (f >= fMin && f <= fMax) freqTicks.push(f);
      }
    }
    let lastLabelX = -Infinity;
    for (const f of freqTicks) {
      const x = xOf(f);
      if (x < pad.left - 0.5 || x > pad.left + plotW + 0.5) continue;
      ctx.beginPath();
      ctx.moveTo(x, pad.top);
      ctx.lineTo(x, pad.top + plotH);
      ctx.stroke();
      if (x - lastLabelX >= 26) {
        ctx.fillText(formatFrequency(f), x, pad.top + plotH + 11);
        lastLabelX = x;
      }
    }
    ctx.setLineDash([]);
    ctx.restore();

    ctx.strokeStyle = axisColor;
    ctx.strokeRect(pad.left, pad.top, plotW, plotH);
    ctx.fillStyle = labelColor;
    ctx.textAlign = 'left';
    ctx.fillText('dB · Hz', pad.left, pad.top - 4);

    ctx.save();
    ctx.beginPath();
    ctx.rect(pad.left, pad.top, plotW, plotH);
    ctx.clip();
    ctx.lineWidth = 1.5;
    channelsDb.forEach((ch, idx) => {
      ctx.strokeStyle = cssVar(CHANNEL_COLOR_VARS[idx % CHANNEL_COLOR_VARS.length]);
      ctx.beginPath();
      ch.forEach((db, i) => {
        const x = xOf(frequencies[i]);
        const y = yOf(db + gainDb);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    });
    ctx.restore();

    if (channelsDb.length > 1) {
      ctx.textAlign = 'right';
      channelsDb.forEach((_, idx) => {
        ctx.fillStyle = cssVar(CHANNEL_COLOR_VARS[idx % CHANNEL_COLOR_VARS.length]);
        ctx.fillText(channelLabels[idx] ?? `Ch ${idx + 1}`, pad.left + plotW - 4 - (channelsDb.length - 1 - idx) * 18, pad.top - 4);
      });
    }
  }, [data, gainDb, colorTheme, channelLabels, fill, fillSize, fixedHeight, viewport]);

  const note = data.totalChannels > data.channelsDb.length && (
    <p className="absolute bottom-0 right-1 text-[10px]" style={{ color: 'var(--color-secondary-hover)' }}>
      first {data.channelsDb.length} of {data.totalChannels} channels
    </p>
  );

  return (
    <div
      ref={containerRef}
      className={fill ? 'relative overflow-hidden w-full h-full' : 'relative overflow-hidden'}
      style={fill ? undefined : { width: AUDIO_VISUALIZATION.WAVEFORM_WIDTH }}
    >
      <canvas
        ref={canvasRef}
        className={fill ? 'absolute inset-0' : 'block'}
        style={{ cursor: isDragging ? 'grabbing' : viewport.zoom > 1 ? 'grab' : 'default' }}
      />
      {viewport.zoom > 1 && (
        <button
          type="button"
          onClick={resetViewport}
          className="absolute top-1 right-1 z-10 px-1.5 py-0.5 rounded text-[10px] transition-colors"
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
      {note}
    </div>
  );
}
