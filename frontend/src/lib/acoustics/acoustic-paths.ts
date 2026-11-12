/**
 * Pure helpers of the sound-path view (no three.js, no store): which paths a view shows, where a
 * billiard particle is at a time, and which diffraction edge a click picks.
 */

import type {
  AcousticPathsPayload,
  AcousticPathsView,
  DiffractedPath,
  DiffractionEdge,
  ReflectionPath,
  TracedRay,
} from '@/types/acousticPaths';

type PairPath = { s: number; r: number; delay_ms: number };

function pairFilter(payload: AcousticPathsPayload, view: AcousticPathsView): (p: { s: number; r?: number }) => boolean {
  const s = view.sourceId === null ? -1 : payload.sources.findIndex((x) => x.id === view.sourceId);
  const r = view.receiverId === null ? -1 : payload.receivers.findIndex((x) => x.id === view.receiverId);
  return (p) =>
    (view.sourceId === null || p.s === s) &&
    (view.receiverId === null || p.r === undefined || p.r === r);
}

/** Arrival time of the first path of each pair (the reference of the time window), keyed `s:r`. */
export function firstArrivals(paths: readonly PairPath[]): Map<string, number> {
  const first = new Map<string, number>();
  for (const p of paths) {
    const key = `${p.s}:${p.r}`;
    const t = first.get(key);
    if (t === undefined || p.delay_ms < t) first.set(key, p.delay_ms);
  }
  return first;
}

function inWindow(p: PairPath, first: Map<string, number>, windowMs: number | null): boolean {
  if (windowMs === null) return true;
  return p.delay_ms - (first.get(`${p.s}:${p.r}`) ?? 0) <= windowMs;
}

/** The reflection paths a view shows: order, pair and arrival-time filters applied. */
export function visibleReflections(payload: AcousticPathsPayload, view: AcousticPathsView): ReflectionPath[] {
  const all = payload.reflections?.paths ?? [];
  if (!view.showReflections) return [];
  const keep = pairFilter(payload, view);
  const first = firstArrivals(all);
  return all.filter((p) => p.order <= view.maxOrder && keep(p) && inWindow(p, first, view.timeWindowMs));
}

/** The diffracted paths a view shows (the time window counts from the pair's first specular arrival). */
export function visibleDiffracted(payload: AcousticPathsPayload, view: AcousticPathsView): DiffractedPath[] {
  const all = payload.diffraction?.paths ?? [];
  if (!view.showDiffraction) return [];
  const keep = pairFilter(payload, view);
  const first = firstArrivals([...(payload.reflections?.paths ?? []), ...all]);
  return all.filter((p) => keep(p) && inWindow(p, first, view.timeWindowMs));
}

export function visibleEdges(payload: AcousticPathsPayload, view: AcousticPathsView): DiffractionEdge[] {
  if (!view.showEdges) return [];
  const edges = payload.diffraction?.edges ?? [];
  return view.obstacleEdgesOnly ? edges.filter((e) => e.kind === 'obstacle') : edges;
}

export function visibleRays(payload: AcousticPathsPayload, view: AcousticPathsView): TracedRay[] {
  if (!view.showRays) return [];
  const keep = pairFilter(payload, view);
  return (payload.rays?.rays ?? []).filter((ray) => keep({ s: ray.s }));
}

/** Distance travelled at each corner of a polyline (flat points), starting at 0. */
export function cumulativeDistances(points: readonly number[]): Float64Array {
  const n = Math.floor(points.length / 3);
  const out = new Float64Array(Math.max(n, 0));
  for (let i = 1; i < n; i++) {
    out[i] = out[i - 1] + Math.hypot(
      points[3 * i] - points[3 * i - 3],
      points[3 * i + 1] - points[3 * i - 2],
      points[3 * i + 2] - points[3 * i - 1],
    );
  }
  return out;
}

/**
 * Position on a polyline after travelling `distance`: `[x, y, z, segment]`, or null once the ray
 * has ended (distance beyond its last corner) or not started (negative).
 */
export function pointAtDistance(
  points: readonly number[],
  cumulative: Float64Array,
  distance: number,
): [number, number, number, number] | null {
  const n = cumulative.length;
  if (n < 2 || distance < 0 || distance > cumulative[n - 1]) return null;
  let i = 1;
  while (i < n - 1 && cumulative[i] < distance) i++;
  const span = cumulative[i] - cumulative[i - 1];
  const t = span > 0 ? (distance - cumulative[i - 1]) / span : 0;
  const a = 3 * (i - 1);
  const b = 3 * i;
  return [
    points[a] + t * (points[b] - points[a]),
    points[a + 1] + t * (points[b + 1] - points[a + 1]),
    points[a + 2] + t * (points[b + 2] - points[a + 2]),
    i - 1,
  ];
}

/** Number of reflections a ray has made after travelling `distance` (corners strictly passed). */
export function reflectionsPassed(cumulative: Float64Array, distance: number): number {
  let count = 0;
  for (let i = 1; i < cumulative.length - 1; i++) if (cumulative[i] < distance) count++;
  return count;
}

/** Distance (same unit as the inputs) from point p to segment ab in 2D. */
export function pointSegmentDistance2D(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** An edge projected to the screen: pixel end points and view depth; null when behind the camera. */
export interface ScreenEdge {
  id: number;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  depth: number;
}

/** The edge nearest to the pointer within `tolerancePx` (the nearer to the camera on a tie), or null. */
export function pickScreenEdge(edges: readonly ScreenEdge[], x: number, y: number, tolerancePx: number): number | null {
  let best: { id: number; distance: number; depth: number } | null = null;
  for (const e of edges) {
    const distance = pointSegmentDistance2D(x, y, e.ax, e.ay, e.bx, e.by);
    if (distance > tolerancePx) continue;
    if (!best || distance < best.distance - 1 || (Math.abs(distance - best.distance) <= 1 && e.depth < best.depth)) {
      best = { id: e.id, distance, depth: e.depth };
    }
  }
  return best ? best.id : null;
}

/** Counts shown in the panel. */
export function pathCounts(payload: AcousticPathsPayload | null): {
  reflections: number; diffracted: number; edges: number; excluded: number; used: number; rays: number;
} {
  const edges = payload?.diffraction?.edges ?? [];
  return {
    reflections: payload?.reflections?.paths.length ?? 0,
    diffracted: payload?.diffraction?.paths.length ?? 0,
    edges: edges.length,
    excluded: edges.filter((e) => e.excluded).length,
    used: edges.filter((e) => e.used).length,
    rays: payload?.rays?.rays.length ?? 0,
  };
}
