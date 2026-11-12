/**
 * Sound paths of a geometric-acoustics card for the 3D view
 * (backend/services/acoustic_paths_service.py; GET /api/acoustics/paths/{id}).
 * Points are flat [x, y, z, ...] in model coordinates (metres).
 */

export type AcousticPathKind = 'reflections' | 'rays' | 'diffraction';

export interface AcousticPathPoint {
  id: string;
  position: number[];
}

export interface ReflectionPath {
  /** Index into `sources` / `receivers`. */
  s: number;
  r: number;
  /** Number of wall reflections (0 = direct sound). */
  order: number;
  points: number[];
  distance: number;
  delay_ms: number;
  /** dB re the direct sound at 1 m; null when unknown. */
  level_db: number | null;
}

export interface TracedRay {
  s: number;
  points: number[];
}

export interface DiffractionEdge {
  id: number;
  /** [x1, y1, z1, x2, y2, z2] */
  segment: number[];
  length: number;
  /** Solid angle of the wedge seen from the air: 0 = a thin panel's rim, 90 = a box corner. */
  wedge_deg: number;
  kind: 'obstacle' | 'boundary';
  excluded: boolean;
  /** A diffracted path of the current pairs passes over it. */
  used: boolean;
}

export interface DiffractedPath {
  s: number;
  r: number;
  edge: number;
  zone: 'shadow' | 'view' | 'reflection';
  order: number;
  points: number[];
  distance: number;
  delay_ms: number;
  level_db: number | null;
}

export interface AcousticPathsPayload {
  paths_id: string;
  speed_of_sound: number;
  sources: AcousticPathPoint[];
  receivers: AcousticPathPoint[];
  notes: string[];
  reflections?: { max_order: number; paths: ReflectionPath[]; truncated: boolean };
  rays?: { n_rays: number; max_order: number; rays: TracedRay[]; duration_ms: number };
  diffraction?: { edges: DiffractionEdge[]; paths: DiffractedPath[] };
}

export interface AcousticPathsJobResult {
  paths_id: string;
  n_reflections: number;
  n_rays: number;
  n_edges: number;
  n_diffracted: number;
}

export interface AcousticPathsEntry {
  status: 'idle' | 'running' | 'done' | 'error';
  progress: number;
  statusText: string;
  error: string | null;
  jobId: string | null;
  /** Input signature the payload was computed for (stale when the card's differs). */
  signature: string | null;
  payload: AcousticPathsPayload | null;
}

/** What the 3D view draws of a payload (shared by all cards). */
export interface AcousticPathsView {
  showReflections: boolean;
  showDiffraction: boolean;
  showEdges: boolean;
  showRays: boolean;
  /** Reflection orders up to this are drawn. */
  maxOrder: number;
  /** Paths arriving within this window (ms after the direct sound of their pair) are drawn; null = all. */
  timeWindowMs: number | null;
  /** Only paths of this source / receiver id (null = all). */
  sourceId: string | null;
  receiverId: string | null;
  /** Hide boundary (room corner) edges, keeping the obstacles' edges. */
  obstacleEdgesOnly: boolean;
}
