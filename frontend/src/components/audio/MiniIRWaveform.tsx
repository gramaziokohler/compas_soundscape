'use client';

import { useEffect, useRef } from 'react';
import { extractWaveformData } from '@/lib/audio/utils/waveform-utils';
import { useResolvedColorTheme } from '@/hooks/useResolvedColorTheme';
import { Spinner } from '@/components/ui/Spinner';
import { AUDIO_VISUALIZATION } from '@/utils/constants';

interface MiniIRWaveformProps {
  audioBuffer: AudioBuffer | null;
  className?: string;
  /** When true, renders transparent with white waveform strokes (simulation card). */
  onBlueBackground?: boolean;
  /** When true and no buffer is available yet, shows a small spinner (WAV still downloading/decoding). */
  loading?: boolean;
}

const WIDTH = 56;
const MONO_HEIGHT = 22;
const FOA_HEIGHT = 40;

/**
 * Compact impulse-response thumbnail for sidebar IR rows.
 * Renders mono as a single track; FOA (4-ch) as four stacked mini tracks.
 */
export function MiniIRWaveform({
  audioBuffer,
  className = '',
  onBlueBackground = false,
  loading = false,
}: MiniIRWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const colorTheme = useResolvedColorTheme();
  const height = audioBuffer?.numberOfChannels === 4 ? FOA_HEIGHT : MONO_HEIGHT;

  const borderStyle = onBlueBackground
    ? { borderColor: 'var(--color-on-blue)' }
    : { borderColor: 'var(--color-border-strong)' };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !audioBuffer) return;

    const numChannels = audioBuffer.numberOfChannels;
    const canvasHeight = numChannels === 4 ? FOA_HEIGHT : MONO_HEIGHT;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = WIDTH * dpr;
    canvas.height = canvasHeight * dpr;
    canvas.style.width = `${WIDTH}px`;
    canvas.style.height = `${canvasHeight}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const root = document.documentElement;
    const getCssVar = (v: string, fallback: string) =>
      getComputedStyle(root).getPropertyValue(v).trim() || fallback;

    const lineColor = onBlueBackground
      ? getCssVar('--color-on-blue', '#ffffff')
      : getCssVar('--color-primary', '#002aff');

    ctx.clearRect(0, 0, WIDTH, canvasHeight);

    const waveformData = extractWaveformData(audioBuffer, Math.min(120, AUDIO_VISUALIZATION.WAVEFORM_POINTS));
    const trackHeight = canvasHeight / numChannels;
    const globalPeak = Math.max(...waveformData.channels.map((ch) => ch.peak), 1e-6);

    waveformData.channels.forEach((channelData, chIdx) => {
      const trackY = chIdx * trackHeight;
      const centerY = trackY + trackHeight / 2;
      const maxAmp = Math.max(trackHeight / 2 - 1, 1);

      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 1;

      const numPoints = channelData.amplitudes.length;
      for (let i = 0; i < numPoints; i++) {
        const amp = channelData.amplitudes[i] / globalPeak;
        const x = numPoints > 1 ? (i / (numPoints - 1)) * WIDTH : 0;
        const ampH = amp * maxAmp;
        ctx.beginPath();
        ctx.moveTo(x, centerY - ampH);
        ctx.lineTo(x, centerY + ampH);
        ctx.stroke();
      }
    });
  }, [audioBuffer, colorTheme, onBlueBackground]);

  if (!audioBuffer) {
    return (
      <div
        className={`shrink-0 rounded border bg-transparent ${className}`}
        style={{
          width: WIDTH,
          height: MONO_HEIGHT,
          ...borderStyle,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {loading && (
          <span
            style={{
              display: 'flex',
              color: onBlueBackground ? 'var(--color-on-blue-muted)' : 'var(--color-secondary-hover)',
            }}
          >
            <Spinner size={12} />
          </span>
        )}
      </div>
    );
  }

  return (
    <canvas
      ref={canvasRef}
      className={`shrink-0 rounded border bg-transparent ${className}`}
      style={borderStyle}
      width={WIDTH}
      height={height}
    />
  );
}
