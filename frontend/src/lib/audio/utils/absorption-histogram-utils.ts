/**
 * Absorption Coefficient Histogram Utilities
 *
 * Renders a vector (SVG-based) per-frequency-band absorption histogram.
 * Two variants:
 *  - Full: labels, axes, grid — shown in expanded dropdown hover.
 *  - Mini: bars only, no text — small icon sized to tree-item line height.
 */

/** CSS variable reader (SSR-safe). */
const getCssVar = (v: string, fallback: string): string => {
  if (typeof document === 'undefined') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(v).trim() || fallback;
};

/* ------------------------------------------------------------------ */
/*  Full histogram (SVG string)                                       */
/* ------------------------------------------------------------------ */

/** Base design dimensions (75 % of old 260×156). */
const FULL_W = 195;
const FULL_H = 117;

const PAD = { top: 18, right: 5, bottom: 21, left: 30 } as const;

/**
 * Build an SVG string for the full absorption histogram.
 * Caller injects it via `innerHTML` on a container div.
 */
export function buildAbsorptionHistogramSVG(
  coeffs: number[],
  centerFreqs: number[],
): string {
  if (coeffs.length === 0) return '';

  const primary = getCssVar('--color-primary', '#002aff');
  const grey = getCssVar('--color-secondary-hover', '#9CA3AF');
  const grid = getCssVar('--color-secondary-hover', '#374151');
  const bg = getCssVar('--background', '#000000');

  const plotW = FULL_W - PAD.left - PAD.right;
  const plotH = FULL_H - PAD.top - PAD.bottom;
  const n = coeffs.length;
  const gap = 2;
  const barW = (plotW - gap * (n - 1)) / n;

  const gridLines = [0.25, 0.5, 0.75, 1.0]
    .map((level) => {
      const y = PAD.top + plotH * (1 - level);
      return `<line x1="${PAD.left}" y1="${y}" x2="${PAD.left + plotW}" y2="${y}" stroke="${grid}" stroke-width="0.5" stroke-dasharray="2 2.5" />`;
    })
    .join('');

  const bars = coeffs
    .map((coeff, i) => {
      const c = Math.max(0, Math.min(1, coeff));
      const bh = c * plotH;
      const x = PAD.left + i * (barW + gap);
      const y = PAD.top + plotH - bh;
      return `<rect x="${x}" y="${y}" width="${barW}" height="${bh}" fill="${primary}" rx="0.5" />`;
    })
    .join('');

  const freqLabels = centerFreqs
    .map((f, i) => {
      const x = PAD.left + i * (barW + gap) + barW / 2;
      const label = f >= 1000 ? `${f / 1000}k` : `${f}`;
      return `<text x="${x}" y="${FULL_H - 3}" text-anchor="middle" fill="${grey}" font-size="8" font-family="system-ui, -apple-system, sans-serif">${label}</text>`;
    })
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${FULL_W} ${FULL_H}" width="100%" height="100%" shape-rendering="geometricPrecision">
  <rect width="${FULL_W}" height="${FULL_H}" fill="${bg}" rx="3" />
  ${gridLines}
  <line x1="${PAD.left}" y1="${PAD.top}" x2="${PAD.left}" y2="${PAD.top + plotH}" stroke="${grid}" stroke-width="0.5" />
  ${bars}
  ${freqLabels}
  <text x="${PAD.left - 2}" y="${PAD.top + 6}" text-anchor="end" fill="${grey}" font-size="7.5" font-family="system-ui, -apple-system, sans-serif">100</text>
  <text x="${PAD.left - 2}" y="${PAD.top + plotH + 5}" text-anchor="end" fill="${grey}" font-size="7.5" font-family="system-ui, -apple-system, sans-serif">0</text>
  <text x="${PAD.left + 2}" y="${PAD.top - 4}" fill="${grey}" font-size="7.5" font-family="system-ui, -apple-system, sans-serif">α(%)</text>
</svg>`;
}

/* ------------------------------------------------------------------ */
/*  Mini histogram icon (bars only, no text/axes)                     */
/* ------------------------------------------------------------------ */

/**
 * Build a tiny SVG string showing only the bars, sized to fit the given
 * `size` (px). Used as an inline icon in the collapsed dropdown trigger.
 */
export function buildMiniHistogramSVG(
  coeffs: number[],
  size: number,
): string {
  if (coeffs.length === 0) return '';

  const primary = getCssVar('--color-primary', '#002aff');
  const bg = getCssVar('--background', '#000000');

  const pad = 2;
  const inner = size - pad * 2;
  const n = coeffs.length;
  const gap = 0.8;
  const barW = (inner - gap * (n - 1)) / n;

  const bars = coeffs
    .map((coeff, i) => {
      const c = Math.max(0, Math.min(1, coeff));
      const bh = Math.max(0.5, c * inner);
      const x = pad + i * (barW + gap);
      const y = pad + inner - bh;
      return `<rect x="${x}" y="${y}" width="${barW}" height="${bh}" fill="${primary}" rx="0.3" />`;
    })
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" shape-rendering="geometricPrecision">
  <rect width="${size}" height="${size}" fill="${bg}" rx="2" />
  ${bars}
</svg>`;
}

/* ------------------------------------------------------------------ */
/*  Legacy canvas API (kept for any remaining canvas consumers)       */
/* ------------------------------------------------------------------ */

/**
 * @deprecated Use `buildAbsorptionHistogramSVG` for vector rendering.
 */
export function drawAbsorptionHistogram(
  canvas: HTMLCanvasElement,
  coeffs: number[],
  centerFreqs: number[],
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx || coeffs.length === 0) return;

  const svg = buildAbsorptionHistogramSVG(coeffs, centerFreqs);
  const img = new Image();
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  img.onload = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
  };
  img.src = url;
}
