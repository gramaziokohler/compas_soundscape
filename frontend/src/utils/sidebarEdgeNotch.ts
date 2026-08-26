/**
 * Builds a `clip-path: path(...)` string for a sidebar panel whose otherwise
 * straight edge dips inward in a smooth S-curve ripple around a fixed
 * vertical center. Used so the collapse/expand toggle handle (which floats
 * just past this edge with a small gap) reads as visually integrated with
 * the sidebar surface, instead of the panel's hard straight border being
 * interrupted by an unrelated floating circle.
 *
 * The notch is a concave dent — the panel's filled surface locally recedes
 * INTO itself at `centerY`, then returns to the straight edge above/below.
 * Coordinates are absolute px, matching the panel's own border-box (the
 * coordinate system `clip-path: path()` uses), so callers must pass the
 * panel's live width/height (e.g. from `useViewportScale()`).
 *
 * Usage:
 *   style={{ clipPath: buildSidebarEdgeNotchClipPath(contentWidth, viewportHeight, 'right', viewportHeight / 2, 100, 14) }}
 */
export function buildSidebarEdgeNotchClipPath(
  panelWidth: number,
  panelHeight: number,
  edge: 'left' | 'right',
  centerY: number,
  notchHeight: number,
  notchDepth: number,
): string {
  const h = notchHeight / 2;
  const top = centerY - h;
  const bottom = centerY + h;

  // Uses continuous vertical tangents (C1/G1 continuity) at entry/exit and the apex,
  // creating a perfectly smooth circular clearance around the center point.
  if (edge === 'right') {
    const x = panelWidth;
    const xDip = panelWidth - notchDepth;
    return (
      `path('M ${x} 0 L ${x} ${top} ` +
      `C ${x} ${centerY - h * 0.55}, ${xDip} ${centerY - h * 0.55}, ${xDip} ${centerY} ` +
      `C ${xDip} ${centerY + h * 0.55}, ${x} ${centerY + h * 0.55}, ${x} ${bottom} ` +
      `L ${x} ${panelHeight} L 0 ${panelHeight} L 0 0 Z')`
    );
  }

  // Mirrored for the left edge (right sidebar panel).
  const xDip = notchDepth;
  return (
    `path('M 0 0 L 0 ${top} ` +
    `C 0 ${centerY - h * 0.55}, ${xDip} ${centerY - h * 0.55}, ${xDip} ${centerY} ` +
    `C ${xDip} ${centerY + h * 0.55}, 0 ${centerY + h * 0.55}, 0 ${bottom} ` +
    `L 0 ${panelHeight} L ${panelWidth} ${panelHeight} L ${panelWidth} 0 Z')`
  );
}