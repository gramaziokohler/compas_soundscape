/**
 * Send sound scenes from the open model to another model of the same workspace.
 * Mirrors backend `SendScenesRequest` / `SendScenesResponse` (models/schemas.py).
 */

/** Body of POST /api/speckle/soundscape/{source_model_id}/send-scenes */
export interface SendScenesRequest {
  target_model_id: string;
  /** Usage-card indices of the scenes to copy (`SoundScene.usageIndex`). */
  usage_indices: number[];
  /** False: sounds are re-placed in front of the camera in the target. */
  keep_positions: boolean;
  /** Seed a fresh soundscape when the target has none yet. */
  target_project_id?: string;
  target_version_id?: string;
  target_model_name?: string;
  /** Workspace revision the client last saw (409 when stale). */
  base_revision?: number;
}

export interface SendScenesResponse {
  success: boolean;
  target_model_id: string;
  scenes_sent: number;
  sounds_sent: number;
  events_sent: number;
  audio_files_copied: number;
  missing_audio_filenames: string[];
  revision: number;
}

/** A model the scenes can be sent to (Speckle model or Homepage project). */
export interface SendTargetEntry {
  modelId: string;
  /** Display name shown in the dialog and the success toast. */
  name: string;
  isHome: boolean;
  /** Speckle project/version used to seed a target that has no soundscape yet. */
  projectId?: string;
  versionId?: string;
  /** Last time this workspace saved a soundscape for it (none → fresh target). */
  savedAt?: string;
}
