'use client';

import { useEffect, useRef } from 'react';
import { getCssColorString } from '@/utils/utils';
import { eqMagnitudeDb } from '@/lib/audio/fx/fx-eq-response';
import type { EqBand, EqParams } from '@/lib/audio/fx/fx-types';
import { FxParamSlider } from './FxParamSlider';

interface EqEditorProps {
  params: EqParams;
  analyser: AnalyserNode | null;
  sampleRate: number;
  onLive: (params: EqParams) => void;
  onCommit: (params: EqParams) => void;
}

const MIN_HZ = 20;
const MAX_HZ = 20000;
const MIN_DB = -24;
const MAX_DB = 24;

function freqToX(freq: number, width: number): number {
  const minL = Math.log10(MIN_HZ);
  const maxL = Math.log10(MAX_HZ);
  return ((Math.log10(Math.max(MIN_HZ, freq)) - minL) / (maxL - minL)) * width;
}

function xToFreq(x: number, width: number): number {
  const minL = Math.log10(MIN_HZ);
  const maxL = Math.log10(MAX_HZ);
  const t = Math.max(0, Math.min(1, x / width));
  return 10 ** (minL + t * (maxL - minL));
}

function dbToY(db: number, height: number): number {
  const t = (db - MAX_DB) / (MIN_DB - MAX_DB);
  return t * height;
}

function yToDb(y: number, height: number): number {
  const t = Math.max(0, Math.min(1, y / height));
  return MAX_DB + t * (MIN_DB - MAX_DB);
}

/**
 * Draggable EQ curve over a live FFT. Colors are read from CSS tokens at
 * draw time so the overlay follows light/dark theme.
 */
export function EqEditor({ params, analyser, sampleRate, onLive, onCommit }: EqEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const dragRef = useRef<{ index: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    const bins = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (width <= 0 || height <= 0) {
        raf = requestAnimationFrame(draw);
        return;
      }
      if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const primary = getCssColorString('--color-primary') || '#002aff';
      const muted = getCssColorString('--color-secondary-light') || '#d4d3c9';
      const border = getCssColorString('--color-border') || 'rgba(0,0,0,0.08)';
      const warning = getCssColorString('--color-warning') || '#F59E0B';

      ctx.strokeStyle = border;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, dbToY(0, height));
      ctx.lineTo(width, dbToY(0, height));
      ctx.stroke();

      if (analyser && bins) {
        analyser.getByteFrequencyData(bins);
        ctx.fillStyle = muted;
        const nyquist = (analyser.context.sampleRate || sampleRate) / 2;
        for (let i = 1; i < bins.length; i++) {
          const freq = (i / bins.length) * nyquist;
          if (freq < MIN_HZ || freq > MAX_HZ) continue;
          const x = freqToX(freq, width);
          const mag = bins[i] / 255;
          const h = mag * height * 0.45;
          ctx.globalAlpha = 0.35;
          ctx.fillRect(x, height - h, Math.max(1, width / bins.length), h);
          ctx.globalAlpha = 1;
        }
      }

      ctx.beginPath();
      ctx.strokeStyle = primary;
      ctx.lineWidth = 1.5;
      const steps = Math.max(64, Math.floor(width));
      for (let i = 0; i <= steps; i++) {
        const freq = xToFreq((i / steps) * width, width);
        const db = eqMagnitudeDb(paramsRef.current.bands, freq, sampleRate);
        const x = (i / steps) * width;
        const y = dbToY(Math.max(MIN_DB, Math.min(MAX_DB, db)), height);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      paramsRef.current.bands.forEach((band, i) => {
        if (band.type === 'highpass' || band.type === 'lowpass') return;
        const x = freqToX(band.freq, width);
        const y = dbToY(band.gain, height);
        ctx.beginPath();
        ctx.fillStyle = band.enabled ? primary : muted;
        ctx.strokeStyle = band.enabled ? primary : muted;
        ctx.lineWidth = 1;
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        if (dragRef.current?.index === i) {
          ctx.beginPath();
          ctx.strokeStyle = warning;
          ctx.arc(x, y, 8, 0, Math.PI * 2);
          ctx.stroke();
        }
      });

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [analyser, sampleRate]);

  const patchBand = (index: number, patch: Partial<EqBand>, commit: boolean) => {
    const bands = params.bands.map((b, i) => (i === index ? { ...b, ...patch } : b));
    const next = { bands };
    onLive(next);
    if (commit) onCommit(next);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    let best = -1;
    let bestD = 16;
    params.bands.forEach((band, i) => {
      if (band.type === 'highpass' || band.type === 'lowpass') return;
      const dx = freqToX(band.freq, rect.width) - x;
      const dy = dbToY(band.gain, rect.height) - y;
      const d = Math.hypot(dx, dy);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best < 0) return;
    dragRef.current = { index: best };
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    const canvas = canvasRef.current;
    if (!drag || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const freq = xToFreq(e.clientX - rect.left, rect.width);
    const gain = yToDb(e.clientY - rect.top, rect.height);
    patchBand(drag.index, { freq: Math.round(freq), gain: Math.round(gain * 10) / 10 }, false);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    onCommit(paramsRef.current);
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const selected = params.bands.findIndex((b) => b.type === 'peaking') >= 0
    ? params.bands
    : params.bands;

  return (
    <div className="card-stack">
      <canvas
        ref={canvasRef}
        className="w-full cursor-pointer"
        style={{ height: 120, background: 'var(--color-secondary-lighter)', borderRadius: 4 }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />
      {selected.slice(1, 5).map((band, i) => {
        const index = i + 1;
        return (
          <FxParamSlider
            key={`${band.type}-${index}`}
            label={band.type === 'lowshelf' ? 'Low shelf' : band.type === 'highshelf' ? 'High shelf' : `${Math.round(band.freq)} Hz`}
            value={band.gain}
            min={MIN_DB}
            max={MAX_DB}
            step={0.5}
            unit="dB"
            defaultValue={0}
            onLive={(v) => patchBand(index, { gain: v }, false)}
            onCommit={(v) => patchBand(index, { gain: v }, true)}
          />
        );
      })}
    </div>
  );
}
