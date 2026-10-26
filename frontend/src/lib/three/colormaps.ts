/**
 * Colormaps shared by the viewer overlays.
 *
 * - Sequential: blue → cyan → green → yellow → red (`valueToRGB`), used by the
 *   grid-listener gradient map and the PFFDTD SPL map.
 * - Diverging: RdBu (blue = negative, white = 0, red = positive) as a 256-entry
 *   LUT, used by the PFFDTD pressure-wave animation.
 */

/** Maps a normalised value [0,1] → RGB tuple [0,1] using blue→cyan→green→yellow→red. */
export function valueToRGB(t: number): [number, number, number] {
  const c = Math.max(0, Math.min(1, t));
  if (c < 0.25) { const u = c / 0.25;        return [0,     u,     1    ]; }
  if (c < 0.5)  { const u = (c-0.25) / 0.25; return [0,     1,     1-u  ]; }
  if (c < 0.75) { const u = (c-0.5)  / 0.25; return [u,     1,     0    ]; }
  /*    c <= 1 */ const u = (c-0.75) / 0.25; return [1,     1-u,   0    ];
}

/** CSS gradient matching `valueToRGB` (colour bars). */
export const SEQUENTIAL_CSS_GRADIENT =
  'linear-gradient(to right, #0000ff, #00ffff, #00ff00, #ffff00, #ff0000)';

/** ColorBrewer RdBu (11 classes), from negative (blue) to positive (red). */
const RDBU_STOPS: ReadonlyArray<readonly [number, number, number]> = [
  [5, 48, 97], [33, 102, 172], [67, 147, 195], [146, 197, 222], [209, 229, 240],
  [247, 247, 247],
  [253, 219, 199], [244, 165, 130], [214, 96, 77], [178, 24, 43], [103, 0, 31],
];

/** CSS gradient matching the diverging LUT (colour bars). */
export const DIVERGING_CSS_GRADIENT = `linear-gradient(to right, ${RDBU_STOPS
  .map(([r, g, b]) => `rgb(${r}, ${g}, ${b})`)
  .join(', ')})`;

/**
 * Build a diverging RGB LUT of `size` entries (flat [r,g,b,…], 0–255).
 * Index 0 = −vmax, size−1 = +vmax, centre = 0 (white).
 */
export function buildDivergingLut(size: number): Uint8Array {
  const lut = new Uint8Array(size * 3);
  const segments = RDBU_STOPS.length - 1;
  for (let i = 0; i < size; i++) {
    const t = (i / (size - 1)) * segments;
    const k = Math.min(segments - 1, Math.floor(t));
    const u = t - k;
    const a = RDBU_STOPS[k];
    const b = RDBU_STOPS[k + 1];
    lut[i * 3] = Math.round(a[0] + (b[0] - a[0]) * u);
    lut[i * 3 + 1] = Math.round(a[1] + (b[1] - a[1]) * u);
    lut[i * 3 + 2] = Math.round(a[2] + (b[2] - a[2]) * u);
  }
  return lut;
}
