/**
 * Absorption Coefficient Histogram Utilities
 *
 * Renders a minimalistic per-frequency-band absorption histogram on a canvas.
 * Style inspired by waveform-utils.ts: black background, monospace labels, dotted grid.
 */

import { PRIMARY_COLOR } from '@/utils/constants';

const GREY = '#9CA3AF';
const GRID = '#374151';
const BG = '#000000';

/**
 * Draw an absorption-coefficient histogram.
 *
 * @param canvas      Target HTML canvas element (caller sets width/height attributes)
 * @param coeffs      Absorption coefficients per band (0–1)
 * @param centerFreqs Matching octave-band center frequencies in Hz
 */
export function drawAbsorptionHistogram(
  canvas: HTMLCanvasElement,
  coeffs: number[],
  centerFreqs: number[],
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx || coeffs.length === 0) return;

  const W = canvas.width;
  const H = canvas.height;

  // Scale factor relative to the base 130×78 design
  const scale = Math.min(W / 130, H / 78);

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  const pad = {
    top: Math.round(14 * scale),
    right: Math.round(4 * scale),
    bottom: Math.round(20 * scale),
    left: Math.round(26 * scale),
  };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  const n = coeffs.length;
  const gap = Math.max(1, Math.round(2 * scale));
  const barW = (plotW - gap * (n - 1)) / n;

  // Dotted grid at 25 / 50 / 75 / 100 %
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  ctx.setLineDash([Math.round(2 * scale), Math.round(3 * scale)]);
  [0.25, 0.5, 0.75, 1.0].forEach((level) => {
    const y = pad.top + plotH * (1 - level);
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + plotW, y);
    ctx.stroke();
  });
  ctx.setLineDash([]);

  // Left axis line
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.left, pad.top);
  ctx.lineTo(pad.left, pad.top + plotH);
  ctx.stroke();

  const fontSize = Math.round(7 * scale);
  const fontStr = `${fontSize}px monospace`;

  // Bars + frequency labels
  coeffs.forEach((coeff, i) => {
    const c = Math.max(0, Math.min(1, coeff));
    const bh = c * plotH;
    const x = pad.left + i * (barW + gap);
    const y = pad.top + plotH - bh;

    ctx.fillStyle = PRIMARY_COLOR;
    ctx.fillRect(x, y, barW, bh);

    const f = centerFreqs[i];
    const label = f >= 1000 ? `${f / 1000}k` : `${f}`;
    ctx.fillStyle = GREY;
    ctx.font = fontStr;
    ctx.textAlign = 'center';
    ctx.fillText(label, x + barW / 2, H - Math.round(4 * scale));
  });

  // Y-axis labels: 100 / 0
  ctx.fillStyle = GREY;
  ctx.font = fontStr;
  ctx.textAlign = 'right';
  ctx.fillText('100', pad.left - Math.round(2 * scale), pad.top + fontSize);
  ctx.fillText('0', pad.left - Math.round(2 * scale), pad.top + plotH + Math.round(4 * scale));

  // Y-axis title
  ctx.fillStyle = GREY;
  ctx.font = fontStr;
  ctx.textAlign = 'left';
  ctx.fillText('α(%)', pad.left + Math.round(2 * scale), pad.top - Math.round(3 * scale));
}
