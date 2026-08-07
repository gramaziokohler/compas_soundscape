// ============================================================================
// UI Scale System — viewport-proportional, zoom-aware sizing
// ============================================================================
//
// Every UI element is assigned one of three scaling classes:
//
//   physical      — constant logical size. CSS pixels are already zoom-invariant
//                   under OS display scaling and browser zoom, so `physical()` is
//                   an identity. It exists to make the intent explicit.
//   fluid         — proportional to the viewport (constant fraction of the window).
//   clamped-fluid — fluid between a hard physical min/max (classic clamp()).
//
// The viewport is tracked in CSS pixels. OS display scaling / browser zoom are
// handled by the browser for anything expressed in CSS px; this module only
// reacts to the CSS-pixel viewport so fluid surfaces keep a constant fraction
// of the window at any zoom/resolution.
//
// Non-component callers (constants, imperative code) use `getScale()`, which
// reflects the latest viewport pushed by `useViewportScale()`.

export const SCALE_REFERENCE_VIEWPORT = { width: 1920, height: 1080 } as const;

export interface ViewportSize {
  width: number;
  height: number;
}

let _viewport: ViewportSize = { ...SCALE_REFERENCE_VIEWPORT };

// Browser-only eager init so the first render already reflects the real window
// instead of flashing reference-sized panels on small screens.
if (typeof window !== 'undefined') {
  _viewport = { width: window.innerWidth, height: window.innerHeight };
}

export function getViewport(): ViewportSize {
  return _viewport;
}

/** Update the module-level viewport (called by useViewportScale on resize). */
export function setViewport(width: number, height: number): void {
  _viewport = { width: Math.max(1, width), height: Math.max(1, height) };
}

export interface Scale {
  /** Physical size — constant CSS px, zoom/DPI invariant. */
  physical(px: number): number;
  /** Fluid width — fraction of the current viewport width. */
  vw(fraction: number): number;
  /** Fluid height — fraction of the current viewport height. */
  vh(fraction: number): number;
  /** Clamped-fluid width: fluid between a physical min and max. */
  clampW(minPx: number, fraction: number, maxPx: number): number;
  /** Clamped-fluid height: fluid between a physical min and max. */
  clampH(minPx: number, fraction: number, maxPx: number): number;
  viewport: ViewportSize;
}

function clamp(min: number, value: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function buildScale(viewport: ViewportSize): Scale {
  return {
    physical: (px: number) => px,
    vw: (fraction: number) => Math.round(viewport.width * fraction),
    vh: (fraction: number) => Math.round(viewport.height * fraction),
    clampW: (minPx, fraction, maxPx) => clamp(minPx, viewport.width * fraction, maxPx),
    clampH: (minPx, fraction, maxPx) => clamp(minPx, viewport.height * fraction, maxPx),
    viewport,
  };
}

/** Module-level scale backed by the tracked viewport — for non-component callers. */
export function getScale(): Scale {
  return buildScale(_viewport);
}

/**
 * Clamp a top-left screen position so an element of (width,height) stays fully
 * inside the viewport. Shared by all floating panels/overlays so every popup
 * behaves identically regardless of screen size.
 */
export function clampToViewport(
  x: number,
  y: number,
  width: number,
  height: number,
  margin = 8,
): { x: number; y: number } {
  const cx = Math.max(margin, Math.min(x, Math.max(margin, _viewport.width - width - margin)));
  const cy = Math.max(margin, Math.min(y, Math.max(margin, _viewport.height - height - margin)));
  return { x: cx, y: cy };
}

/** Clamp a width so the element cannot exceed the viewport width. */
export function clampToViewportWidth(width: number, minWidth = 0, margin = 8): number {
  return Math.max(minWidth, Math.min(width, Math.max(minWidth, _viewport.width - margin)));
}

/** Clamp a height so the element cannot exceed the viewport height. */
export function clampToViewportHeight(height: number, minHeight = 0, margin = 8): number {
  return Math.max(minHeight, Math.min(height, Math.max(minHeight, _viewport.height - margin)));
}
