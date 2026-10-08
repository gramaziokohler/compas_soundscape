/**
 * Categories, colours and visibility of the simulation-mesh preview.
 *
 * Each view mode splits the faces into categories. One table
 * (`PREVIEW_CATEGORIES`) drives everything: the colour of a face side in the
 * 3D preview, whether it is drawn (its category's filter checkbox), and the
 * legend rows in the panel, whose checkbox is tinted with the same colour.
 *
 * Three.js renders a triangle's FrontSide on the side its normal points to.
 * Simulated normals point AWAY from the air (pyroomacoustics convention), so
 * the reflecting side of a wall is its Three.js BackSide.
 *
 * Colours are CSS tokens only, resolved at render time.
 */

import { getCssColorHex } from '@/utils/utils';
import { PREFLIGHT_FACE_CLASS } from '@/types/simulationPreflight';
import type {
  PreflightFilters,
  PreflightPayload,
  PreflightSeverity,
  PreflightViewMode,
} from '@/types/simulationPreflight';

export type PreviewCategoryKey = Extract<
  keyof PreflightFilters,
  'reflectingSide' | 'backSide' | 'closed' | 'open' | 'shell' | 'interior' | 'doubleSided' | 'skipped'
>;
export type PreviewOverlayKey = Extract<keyof PreflightFilters, 'edges' | 'holes' | 'leaks' | 'blockers'>;

export interface PreviewCategory<K extends string = PreviewCategoryKey> {
  key: K;
  /** CSS custom property of the category colour (legend checkbox + 3D). */
  colorVar: string;
  label: string;
}

const SKIPPED: PreviewCategory = {
  key: 'skipped', colorVar: '--color-secondary-hover', label: 'Skipped surface (never reached by sound)',
};
const DOUBLE_SIDED: PreviewCategory = {
  key: 'doubleSided', colorVar: '--color-info', label: 'Double-sided surface',
};

/** Legend + filter categories of each view mode, in display order. */
export const PREVIEW_CATEGORIES: Record<PreflightViewMode, PreviewCategory[]> = {
  orientation: [
    { key: 'reflectingSide', colorVar: '--color-primary', label: 'Reflecting side (faces the air)' },
    { key: 'backSide', colorVar: '--color-warning', label: 'Back side (inside the wall)' },
    DOUBLE_SIDED,
    SKIPPED,
  ],
  topology: [
    { key: 'closed', colorVar: '--color-success', label: 'Closed (watertight) element' },
    { key: 'open', colorVar: '--color-warning', label: 'Open single surface' },
    DOUBLE_SIDED,
    SKIPPED,
  ],
  class: [
    { key: 'shell', colorVar: '--color-primary', label: 'Outer shell' },
    { key: 'interior', colorVar: '--color-warning', label: 'Objects inside the room' },
    SKIPPED,
  ],
};

/** Overlay toggles; the checkbox colour matches the drawn lines. */
export const PREVIEW_OVERLAYS: PreviewCategory<PreviewOverlayKey>[] = [
  { key: 'edges', colorVar: '--color-secondary-hover', label: 'Wall edges' },
  { key: 'holes', colorVar: '--color-warning', label: 'Holes (open edges)' },
  { key: 'leaks', colorVar: '--color-error', label: 'Leaks (escaping sound)' },
  { key: 'blockers', colorVar: '--color-error', label: 'Blocked direct paths' },
];

export interface PreviewPalette {
  edges: number;
  holes: number;
  error: number;
  warning: number;
  info: number;
  /** Colour of each category key (all view modes). */
  category: Record<PreviewCategoryKey, number>;
}

/** Resolve the palette from the current theme's CSS tokens. */
export function resolvePreviewPalette(): PreviewPalette {
  const category = {} as Record<PreviewCategoryKey, number>;
  for (const list of Object.values(PREVIEW_CATEGORIES)) {
    for (const c of list) category[c.key] = getCssColorHex(c.colorVar);
  }
  const overlay = (key: PreviewOverlayKey) =>
    getCssColorHex(PREVIEW_OVERLAYS.find((o) => o.key === key)!.colorVar);
  return {
    edges: overlay('edges'),
    holes: overlay('holes'),
    error: getCssColorHex('--color-error'),
    warning: getCssColorHex('--color-warning'),
    info: getCssColorHex('--color-info'),
    category,
  };
}

export function severityColor(palette: PreviewPalette, severity: PreflightSeverity): number {
  return severity === 'error' ? palette.error : severity === 'warning' ? palette.warning : palette.info;
}

/** Category of each side of a face: [Three.js FrontSide, BackSide]. */
function faceCategories(payload: PreflightPayload, f: number, mode: PreflightViewMode): [PreviewCategoryKey, PreviewCategoryKey] {
  const cls = payload.face_class[f];
  const both = (k: PreviewCategoryKey): [PreviewCategoryKey, PreviewCategoryKey] => [k, k];
  if (cls === PREFLIGHT_FACE_CLASS.SKIPPED) return both('skipped');
  const twoSided = payload.two_sided[f] === 1;

  switch (mode) {
    case 'orientation':
      // Normal side = inside the wall; the opposite (BackSide) faces the air.
      return twoSided ? both('doubleSided') : ['backSide', 'reflectingSide'];
    case 'topology':
      return both(twoSided ? 'doubleSided' : payload.closed[f] === 1 ? 'closed' : 'open');
    case 'class':
    default:
      return both(cls === PREFLIGHT_FACE_CLASS.INTERIOR ? 'interior' : 'shell');
  }
}

/**
 * Colour of each side of face `f`, or null where that side is filtered out.
 * Returns `[front, back]` (Three.js FrontSide / BackSide).
 */
export function faceSideColors(
  payload: PreflightPayload,
  f: number,
  mode: PreflightViewMode,
  filters: PreflightFilters,
  palette: PreviewPalette,
): [number | null, number | null] {
  const [front, back] = faceCategories(payload, f, mode);
  return [
    filters[front] ? palette.category[front] : null,
    filters[back] ? palette.category[back] : null,
  ];
}
