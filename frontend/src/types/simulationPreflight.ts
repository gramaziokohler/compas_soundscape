/**
 * Simulation geometry preflight types.
 *
 * Mirrors backend/utils/preflight_payload.py (payload) and
 * backend/models/schemas.py (MeshPrepSettings, PreflightIssue). The payload is
 * the exact mesh the simulation will use: welded, oriented from the air side,
 * with per-face flags stored as flat arrays (one entry per triangle).
 */

/** Target engine of a preflight (severities differ per engine). */
export type SimulationEngine = 'pyroomacoustics' | 'choras';

/** User-tunable simulation mesh preparation (Advanced settings > Acoustics). */
export interface SimulationMeshSettings {
  weld_tolerance_mm: number;
  merge_coplanar: boolean;
  coplanar_angle_deg: number;
  coplanar_distance_mm: number;
  detect_two_sided: boolean;
  visibility_quality: 'fast' | 'standard' | 'thorough';
}

export type PreflightSeverity = 'error' | 'warning' | 'info';

export interface PreflightIssue {
  id: string;
  severity: PreflightSeverity;
  code: string;
  title: string;
  detail: string;
  position: [number, number, number] | null;
  segment: [[number, number, number], [number, number, number]] | null;
  face_ids: number[];
  object_ids: string[];
  loop_ids: number[];
}

/**
 * Face classes (backend/services/simulation_mesh_service.py FACE_CLASS_*).
 * Double-sidedness is a separate per-face flag (`two_sided`): a thin surface is
 * SHELL or INTERIOR like any other face.
 */
export const PREFLIGHT_FACE_CLASS = {
  SHELL: 0,
  INTERIOR: 1,
  SKIPPED: 2,
} as const;
export type PreflightFaceClass = (typeof PREFLIGHT_FACE_CLASS)[keyof typeof PREFLIGHT_FACE_CLASS];

export type PreflightSeedStatus = 'inside' | 'leaky' | 'outside';

export interface PreflightSeed {
  id: string;
  kind: 'source' | 'receiver';
  position: [number, number, number];
  status: PreflightSeedStatus;
  escape_fraction: number;
  surface_distance_m: number;
  enclosure: number;
}

export interface PreflightLoop {
  id: number;
  /** Flat [x0,y0,z0, x1,y1,z1, ...] segment pairs. */
  segments: number[];
  length: number;
  extent: number;
  centroid: [number, number, number];
  leaking: boolean;
}

export interface PreflightLeakRay {
  origin: [number, number, number];
  end: [number, number, number];
}

export interface PreflightBlockedPath {
  source_id: string;
  receiver_id: string;
  segment: [[number, number, number], [number, number, number]];
  face_ids: number[];
  separated: boolean;
}

export interface PreflightStats {
  input_faces: number;
  welded_faces: number;
  welded_vertices: number;
  dropped_unassigned_faces: number;
  dropped_unassigned_objects: string[];
  duplicate_faces: number;
  coincident_opposite_faces: number;
  components: number;
  closed_components: number;
  non_manifold_edges: number;
  boundary_edges: number;
  flipped_faces: number;
  two_sided_faces: number;
  skipped_faces: number;
  simulated_walls: number;
  rays_per_seed: number;
  leak_fraction: number;
  air_volume_m3: number;
  air_volume_method: string;
  ism_paths_estimate: number;
  obstructing_walls: number;
}

export interface PreflightPayload {
  preflight_id: string;
  engine: SimulationEngine;
  settings: SimulationMeshSettings;
  stats: PreflightStats;
  objects: string[];
  vertices: number[];
  faces: number[];
  face_class: PreflightFaceClass[];
  face_object: number[];
  face_wall: number[];
  two_sided: (0 | 1)[];
  flipped: (0 | 1)[];
  closed: (0 | 1)[];
  obstructing: (0 | 1)[];
  air_hits: number[];
  loops: PreflightLoop[];
  leaks: PreflightLeakRay[];
  seeds: PreflightSeed[];
  blocked_paths: PreflightBlockedPath[];
  issues: PreflightIssue[];
}

/** Job result of POST /api/simulation/preflight-speckle. */
export interface PreflightJobResult {
  preflight_id: string;
  engine: SimulationEngine;
  n_errors: number;
  n_warnings: number;
  n_infos: number;
  payload_file: string;
}

/** How faces are coloured in the 3D preview. */
export type PreflightViewMode = 'orientation' | 'topology' | 'class';

/**
 * Visibility toggles of the 3D preview. Content categories (one checkbox per
 * legend row of the active view mode) + overlays. `doubleSided` and `skipped`
 * are shared by the view modes that list them.
 */
export interface PreflightFilters {
  // Orientation
  reflectingSide: boolean;
  backSide: boolean;
  // Topology
  closed: boolean;
  open: boolean;
  // Shell
  shell: boolean;
  interior: boolean;
  // Shared
  doubleSided: boolean;
  skipped: boolean;
  // Overlays
  edges: boolean;
  holes: boolean;
  leaks: boolean;
  blockers: boolean;
}

export type PreflightRunStatus = 'idle' | 'running' | 'done' | 'error';

export interface PreflightEntry {
  status: PreflightRunStatus;
  progress: number;
  statusText: string;
  error: string | null;
  jobId: string | null;
  /** Input signature the current result was computed for (staleness check). */
  signature: string | null;
  engine: SimulationEngine | null;
  summary: Pick<PreflightJobResult, 'n_errors' | 'n_warnings' | 'n_infos'> | null;
  payload: PreflightPayload | null;
}
