/**
 * Source directivity types (backend routers/directivities.py, services/directivity_service.py).
 *
 * A sound source radiates either omnidirectionally (no `directivity`), with an
 * analytical Cardioid-family pattern, or with a measured balloon (SOFA / BRAS CSV)
 * from the built-in presets or the user's library.
 */

/** Directivity + orientation of one sound source (shared by the variants of a prompt). */
export interface SoundDirectivity {
  /** "omni" | analytical preset id | "preset_<name>" | library "dir_<hex>" */
  id: string;
  /** Radians, listener convention: yaw=0 faces -Y, +yaw turns toward -X. */
  yaw: number;
  /** Radians, +pitch tilts up (+Z). */
  pitch: number;
  /** Radians, about the forward axis. */
  roll: number;
}

export type DirectivityKind = 'analytical' | 'measured';
export type DirectivityOrigin = 'builtin' | 'library' | 'shared';

/** A directivity the picker can assign (GET /api/me/directivities, soundscape snapshot). */
export interface DirectivityRecord {
  id: string;
  name: string;
  kind: DirectivityKind;
  origin: DirectivityOrigin;
  /** Analytical: Cardioid-family parameter (1 omni, 0.5 cardioid, 0 figure-eight). */
  p?: number | null;
  /** Measured: "sofa" | "bras_csv". */
  format?: string | null;
  /** Measured: source label inside the file (SOFA multi-source files). */
  source_label?: string | null;
  fs?: number | null;
  n_points?: number | null;
  taps?: number | null;
  /** Per octave band, relative RMS of the first-order fit used by the wave solver. */
  fit_residual?: number[] | null;
  /** False while a measured preset is still being prepared on the server. */
  available: boolean;
  created_at?: string;
  updated_at?: string;
}

/** Quick look at an upload before importing (POST /api/me/directivities/inspect). */
export interface DirectivityInspectResult {
  format: string;
  sofa_sources: string[];
  fs?: number | null;
  n_points?: number | null;
  warning?: string | null;
}

/** Polar preview of a measured balloon (GET /api/directivities/{id}/preview). */
export interface DirectivityPreview {
  bands_hz: number[];
  angle_step_deg: number;
  /** [band][angle] dB re on-axis, 0 = front, 90 = left. */
  horizontal_db: number[][];
  /** [band][angle] dB re on-axis, 0 = front, 90 = up. */
  vertical_db: number[][];
  front_back_db: number[];
}

/** Preview response of an analytical preset. */
export interface AnalyticalDirectivityPreview {
  analytical: true;
  p: number;
}

/** Progress of a directivity import job (unified /api/jobs polling). */
export interface DirectivityImportStatus {
  progress: number;
  statusText: string;
  completed: boolean;
  error?: string;
  directivity?: DirectivityRecord;
}
