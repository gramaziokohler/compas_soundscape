/**
 * Filled-silhouette waveform renderer.
 *
 * Replaces the mirrored-bar waveform (and DAW clip thumbnails) with a single
 * continuous filled shape spanning every amplitude edge — the top edge traces
 * the per-column max, the bottom edge the per-column min — with no separate
 * border line. Rendered through wavesurfer.js v7's `renderFunction` hook
 * (progress recoloring via the two-canvas `source-in` mask still applies), and
 * reused by the DAW timeline's plain-canvas clips.
 */

export interface SilhouettePalette {
  /** Translucent interior fill. */
  fill: string;
  /** Played-region recolor (wavesurfer progressColor). */
  progress: string;
}

/** Resolve a CSS var (or return non-`var()` strings untouched). */
function resolveCssVar(variable: string, fallback = '#888888'): string {
  if (typeof window === 'undefined') return fallback;
  if (!variable.startsWith('var(')) return variable;
  const match = variable.match(/var\(\s*(--[^,)]+)/);
  if (!match) return fallback;
  const val = getComputedStyle(document.documentElement).getPropertyValue(match[1]).trim();
  return val || fallback;
}

/**
 * Re-express a resolved CSS color at a given alpha. Handles `#rgb`, `#rrggbb`,
 * `#rrggbbaa`, and `rgba(...)`/`rgb(...)` strings so an already-translucent
 * token (e.g. `--color-on-blue-muted`) can be dimmed further.
 */
export function withAlpha(color: string, alpha: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  const a = Math.max(0, Math.min(1, alpha));
  const trimmed = color.trim().toLowerCase();
  const hex = trimmed.match(/^#([0-9a-f]{3,8})$/);
  if (hex) {
    let value = hex[1];
    if (value.length === 3) {
      value = value.split('').map((c) => c + c).join('');
    }
    if (value.length === 6) {
      const r = parseInt(value.slice(0, 2), 16);
      const g = parseInt(value.slice(2, 4), 16);
      const b = parseInt(value.slice(4, 6), 16);
      return `rgba(${r}, ${g}, ${b}, ${a})`;
    }
    if (value.length === 8) {
      const r = parseInt(value.slice(0, 2), 16);
      const g = parseInt(value.slice(2, 4), 16);
      const b = parseInt(value.slice(4, 6), 16);
      const existing = parseInt(value.slice(6, 8), 16) / 255;
      return `rgba(${r}, ${g}, ${b}, ${existing * a})`;
    }
    return color;
  }
  const rgba = trimmed.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/);
  if (rgba) {
    const existing = rgba[4] !== undefined ? parseFloat(rgba[4]) : 1;
    return `rgba(${clamp(parseFloat(rgba[1]))}, ${clamp(parseFloat(rgba[2]))}, ${clamp(parseFloat(rgba[3]))}, ${existing * a})`;
  }
  return color;
}

/**
 * Palette for the silhouette waveform. Neutral surfaces keep the accent recolor;
 * `onBlueBackground` (solid-blue generated cards) keeps the muted white fill but
 * recolors the played region to the brand primary so the progress fill is
 * actually visible against the card's white-on-blue scheme.
 */
export function resolveSilhouettePalette(onBlueBackground: boolean): SilhouettePalette {
  if (onBlueBackground) {
    return {
      fill: withAlpha(resolveCssVar('var(--color-on-blue)'), 0.8),
      progress: resolveCssVar('var(--color-primary)'),
    };
  }
  return {
    fill: withAlpha(resolveCssVar('var(--color-secondary-hover)'), 0.8),
    progress: resolveCssVar('var(--color-primary)'),
  };
}

/**
 * Compute per-column top/bottom pixel envelopes for a closed silhouette.
 * Aggregates every source sample that falls inside a given output column into
 * its extreme positive (top) and negative (bottom) edges, then scales so the
 * loudest column fills the full height (mirrors wavesurfer `normalize: true`).
 */
export function buildSilhouetteEnvelope(
  channels: number,
  length: number,
  sampleAt: (channelIndex: number, sampleIndex: number) => number,
  widthPx: number,
  heightPx: number,
): { top: Float32Array; bottom: Float32Array } {
  const top = new Float32Array(widthPx);
  const bottom = new Float32Array(widthPx);
  const half = heightPx / 2;
  if (widthPx <= 0 || heightPx <= 0 || length <= 0 || channels <= 0) return { top, bottom };

  const topPeak = new Float32Array(widthPx);
  const botPeak = new Float32Array(widthPx);

  for (let ch = 0; ch < channels; ch++) {
    for (let i = 0; i < length; i++) {
      const v = sampleAt(ch, i);
      const x = Math.min(widthPx - 1, Math.floor((i / length) * widthPx));
      if (v > topPeak[x]) topPeak[x] = v;
      if (-v > botPeak[x]) botPeak[x] = -v;
    }
  }

  let maxAbs = 1e-6;
  for (let x = 0; x < widthPx; x++) {
    if (topPeak[x] > maxAbs) maxAbs = topPeak[x];
    if (botPeak[x] > maxAbs) maxAbs = botPeak[x];
  }
  const scale = half / maxAbs;

  for (let x = 0; x < widthPx; x++) {
    top[x] = half - topPeak[x] * scale;
    bottom[x] = half + botPeak[x] * scale;
  }
  return { top, bottom };
}

/**
 * Draw a closed silhouette path (top polyline → right edge → bottom polyline →
 * left edge) and fill it. The shape boundary is defined purely by the fill —
 * no separate border is rendered.
 */
export function drawSilhouettePath(
  ctx: CanvasRenderingContext2D,
  widthPx: number,
  top: Float32Array,
  bottom: Float32Array,
  fill: string,
): void {
  if (widthPx <= 0 || top.length === 0) return;
  ctx.beginPath();
  ctx.moveTo(0, top[0]);
  for (let x = 1; x < widthPx; x++) ctx.lineTo(x, top[x]);
  ctx.lineTo(widthPx - 1, bottom[widthPx - 1]);
  for (let x = widthPx - 2; x >= 0; x--) ctx.lineTo(x, bottom[x]);
  ctx.closePath();

  ctx.fillStyle = fill;
  ctx.fill();
}

/**
 * wavesurfer v7 `renderFunction` that turns the peak arrays (one entry per
 * channel, decoded at ~8 kHz) into a filled silhouette. Runs inside the
 * renderer's canvas (device-pixel coordinate space, matching the built-in
 * bar/line renderers).
 */
export function createSilhouetteRenderFunction(palette: SilhouettePalette) {
  return (peaks: Array<Float32Array | number[]>, ctx: CanvasRenderingContext2D): void => {
    const widthPx = ctx.canvas.width;
    const heightPx = ctx.canvas.height;
    if (widthPx <= 0 || heightPx <= 0 || peaks.length === 0) return;

    const length = peaks[0].length;
    const envelope = buildSilhouetteEnvelope(
      peaks.length,
      length,
      (ch, i) => {
        const data = peaks[Math.min(ch, peaks.length - 1)];
        return data ? (data[i] ?? 0) : 0;
      },
      widthPx,
      heightPx,
    );

    drawSilhouettePath(ctx, widthPx, envelope.top, envelope.bottom, palette.fill);
  };
}
