/**
 * Grid listener point ids have the form `${gridListenerId}-${pointIndex}`.
 * Splits on the LAST dash, since grid ids themselves contain dashes.
 *
 * Returns null when the id has no numeric point suffix (e.g. a single
 * receiver id, or a grid id on its own).
 */
export function parseGridPointId(pointId: string): { gridId: string; index: number } | null {
  const lastDash = pointId.lastIndexOf('-');
  if (lastDash <= 0) return null;
  const index = parseInt(pointId.substring(lastDash + 1), 10);
  if (isNaN(index)) return null;
  return { gridId: pointId.substring(0, lastDash), index };
}
