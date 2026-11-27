/**
 * Heatmap listener — an SPL map over a surface, computed by compas_acoustics
 * `EnergyMap` (backend `POST /api/acoustics/heatmap-speckle`).
 *
 * The surface UI is the grid listener's (objects / drawn area, X/Y spacing,
 * Z offset), so a heatmap IS a GridListenerData plus its result. The backend
 * returns the map per source at a 0 dB reference level; the frontend weights
 * the sources by their sound cards' volume and mute / solo state live.
 */

import type { GridListenerData } from './receiver';

/** What the heatmap shows: A-weighted broadband level, or one octave band (index into `bands`). */
export type HeatmapMetric = 'spl_a' | number;

/** The stored reference to a finished heatmap run (persisted with the soundscape). */
export interface HeatmapResultRef {
  /** Backend payload id (`GET /api/acoustics/heatmap/{heatmapId}`). */
  heatmapId: string;
  /** Simulation card whose geometry + materials were used. */
  simulationConfigId: string;
  /** Fingerprint of the run's inputs — differs from the live one when the result is outdated. */
  signature: string;
  /** Backend source id (posKey) → sound ids it stands for (their volume / mute / solo drive its level). */
  sourceSounds: Record<string, string[]>;
}

/**
 * The undoable part of a heatmap: its surface. The result and the displayed
 * metric are kept apart (runtime maps of the store) — undo never discards a
 * finished run, and switching the metric is display state.
 */
export type HeatmapListenerData = GridListenerData;

/** A heatmap as saved in soundscape.json (`heatmap_listeners`). */
export interface SavedHeatmapListener extends GridListenerData {
  metric: HeatmapMetric;
  result: HeatmapResultRef | null;
}

/** One source of a heatmap payload: its level per point and band at 0 dB re 1 m. */
export interface HeatmapPayloadSource {
  id: string;
  position: [number, number, number];
  /** [point][band] dB, null where the point is outside the room. */
  spl_bands: Array<Array<number | null> | null>;
}

/** `GET /api/acoustics/heatmap/{id}` document. */
export interface HeatmapPayload {
  heatmap_id: string;
  /** Octave band centres (Hz). */
  bands: number[];
  /** Per point: inside the room (false → no value). */
  inside: boolean[];
  /** Points in model coordinates, same order as the request. */
  points: Array<[number, number, number]>;
  sources: HeatmapPayloadSource[];
  n_rays: number;
  warnings: string[];
}

/** Job result of the heatmap job (`/api/jobs/{id}`). */
export interface HeatmapJobResult {
  heatmap_id: string;
  payload_file?: string;
}

/** Runtime state of a heatmap's run (not undoable, not persisted). */
export interface HeatmapRunState {
  status: 'idle' | 'running' | 'done' | 'error';
  progress: number;
  statusText: string;
  jobId: string | null;
  error: string | null;
}
