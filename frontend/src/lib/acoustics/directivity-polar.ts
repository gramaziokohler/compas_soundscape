/**
 * Polar-plot SVG of a measured directivity preview (backend `preview_json`):
 * one cut (horizontal or vertical) with one curve per band, in dB re on-axis.
 * Front (0°) points up; positive angles turn to the left (horizontal cut) or up
 * (vertical cut). Returned as a markup string for `dangerouslySetInnerHTML`,
 * themed through CSS custom properties.
 */

import { DIRECTIVITY } from '@/utils/constants';
import type { DirectivityPreview } from '@/types/directivity';

export type PolarCut = 'horizontal' | 'vertical';

export interface PolarSvgOptions {
  size?: number;
  /** Floor of the radial dB scale (0 dB at the rim). */
  minDb?: number;
  /** Which band indices to draw (default all). */
  bands?: number[];
}

const RING_STEP_DB = 10;
const RING_OPACITY = 0.18;
const BAND_OPACITIES = [0.45, 0.7, 1.0];

function fmtBand(hz: number): string {
  return hz >= 1000 ? `${hz / 1000} kHz` : `${hz} Hz`;
}

function dbToRadius(db: number, minDb: number, radius: number): number {
  const clamped = Math.max(minDb, Math.min(0, db));
  return radius * (1 - clamped / minDb);
}

/** Polar curve points: angle index k ↔ k·step degrees, front up, positive angles to the left. */
function curvePath(valuesDb: number[], stepDeg: number, cx: number, cy: number, radius: number, minDb: number): string {
  const pts = valuesDb.map((db, k) => {
    const a = (k * stepDeg * Math.PI) / 180;
    const r = dbToRadius(db, minDb, radius);
    return `${(cx - Math.sin(a) * r).toFixed(1)},${(cy - Math.cos(a) * r).toFixed(1)}`;
  });
  return pts.length ? `M${pts.join('L')}Z` : '';
}

export function buildPolarCutSVG(preview: DirectivityPreview, cut: PolarCut, options: PolarSvgOptions = {}): string {
  const size = options.size ?? DIRECTIVITY.PREVIEW_H;
  const minDb = options.minDb ?? DIRECTIVITY.PREVIEW_MIN_DB;
  const curves = cut === 'horizontal' ? preview.horizontal_db : preview.vertical_db;
  const bandIdx = options.bands ?? curves.map((_, i) => i);
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 6;

  const rings: string[] = [];
  for (let db = 0; db > minDb; db -= RING_STEP_DB) {
    const r = dbToRadius(db, minDb, radius);
    rings.push(`<circle cx="${cx}" cy="${cy}" r="${r.toFixed(1)}" fill="none" stroke="var(--foreground)" stroke-opacity="${RING_OPACITY}" stroke-width="0.5"/>`);
  }
  const axes =
    `<line x1="${cx}" y1="${cy - radius}" x2="${cx}" y2="${cy + radius}" stroke="var(--foreground)" stroke-opacity="${RING_OPACITY}" stroke-width="0.5"/>` +
    `<line x1="${cx - radius}" y1="${cy}" x2="${cx + radius}" y2="${cy}" stroke="var(--foreground)" stroke-opacity="${RING_OPACITY}" stroke-width="0.5"/>`;

  const paths = bandIdx
    .map((i, n) => {
      const d = curvePath(curves[i] ?? [], preview.angle_step_deg, cx, cy, radius, minDb);
      const opacity = BAND_OPACITIES[Math.min(n, BAND_OPACITIES.length - 1)];
      return `<path d="${d}" fill="none" stroke="var(--color-primary)" stroke-opacity="${opacity}" stroke-width="1.4" stroke-linejoin="round"/>`;
    })
    .join('');

  const frontLabel = `<text x="${cx}" y="${cy - radius - 1}" text-anchor="middle" font-size="7" fill="var(--foreground)" fill-opacity="0.6">front</text>`;
  const sideLabel = cut === 'horizontal'
    ? `<text x="${cx - radius + 2}" y="${cy - 2}" font-size="7" fill="var(--foreground)" fill-opacity="0.6">left</text>`
    : `<text x="${cx + 3}" y="${cy - radius + 9}" font-size="7" fill="var(--foreground)" fill-opacity="0.6">up</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${cut} directivity cut">${rings.join('')}${axes}${paths}${frontLabel}${sideLabel}</svg>`;
}

/** Legend entries of the plotted bands, in curve order. */
export function polarLegend(preview: DirectivityPreview, bands?: number[]): Array<{ label: string; opacity: number }> {
  const idx = bands ?? preview.bands_hz.map((_, i) => i);
  return idx.map((i, n) => ({ label: fmtBand(preview.bands_hz[i]), opacity: BAND_OPACITIES[Math.min(n, BAND_OPACITIES.length - 1)] }));
}

/** "First-order approximation explains X %" per band (wave solver), from the stored residuals. */
export function fitExplainedPercent(residual: number[] | null | undefined): number | null {
  if (!residual?.length) return null;
  const worst = Math.max(...residual);
  return Math.max(0, Math.round((1 - worst * worst) * 100));
}
