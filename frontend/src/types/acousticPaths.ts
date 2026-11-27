/**
 * Sound paths a geometric-acoustics run stores in its results JSON (`paths`, written by
 * backend/services/acoustic_paths_service.py), drawn in the 3D view for the hovered / selected IR.
 * Points are flat [x, y, z, ...] in model coordinates (metres).
 */

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

export interface DiffractedPath {
  s: number;
  r: number;
  zone: 'shadow' | 'view' | 'reflection';
  order: number;
  points: number[];
  distance: number;
  delay_ms: number;
  level_db: number | null;
}

export interface AcousticPathsPayload {
  speed_of_sound: number;
  sources: AcousticPathPoint[];
  receivers: AcousticPathPoint[];
  notes: string[];
  /** Image-source paths up to `max_order` (the backend's ACOUSTIC_PATHS_MAX_ORDER, capped at the run's order). */
  reflections?: { max_order: number; paths: ReflectionPath[] };
  /** First-order diffracted paths, when the card's "Show diffracted paths" was on for the run. */
  diffraction?: { paths: DiffractedPath[] };
}

/** One source-listener pair of a simulation card (an IR row). */
export interface AcousticPathsFocus {
  configId: string;
  sourceId: string;
  receiverId: string;
}
