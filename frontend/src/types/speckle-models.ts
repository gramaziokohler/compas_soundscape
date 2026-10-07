// frontend/src/types/speckle-models.ts
// TypeScript types for Speckle project model browsing

/** Author metadata for a Speckle model */
export interface SpeckleModelAuthor {
  id: string;
  name: string;
  avatar?: string;
}

/** Summary of a single Speckle model version */
export interface SpeckleVersionSummary {
  id: string;
  message?: string;
  source_application?: string;
  referenced_object?: string;
  created_at?: string;
  author_name?: string;
}

/** Detailed info for a Speckle model (matches backend SpeckleModelDetail) */
export interface SpeckleModelDetail {
  id: string;
  name: string;
  display_name: string;
  description?: string;
  created_at?: string;
  updated_at?: string;
  preview_url?: string;
  author?: SpeckleModelAuthor;
  versions_count: number;
  latest_version?: SpeckleVersionSummary;
  /** Time this workspace last saved a soundscape for the model (local save). */
  last_saved_at?: string;
}

/** Response envelope from GET /api/speckle/models */
export interface SpeckleProjectModelsResponse {
  project_id: string;
  models: SpeckleModelDetail[];
  total_count: number;
  auth_token?: string;
}

/** Response from GET /api/speckle/models/{model_id}/latest */
export interface SpeckleModelLatestVersion {
  version_id: string;
  object_id: string;
  created_at?: string;
  author_name?: string;
  source_application?: string;
  message?: string;
}

/** Response from GET /api/speckle/ingestion/{ingestion_id} */
export interface SpeckleIngestionStatus {
  status: string | null;
  /** App-side stage: Speckle status plus the "materializing" bundle → legacy step. */
  stage: 'queued' | 'processing' | 'materializing' | 'success' | 'failed';
  progress_message: string | null;
  /** 0–1 fraction while processing; null when Speckle reports no percentage. */
  progress: number | null;
  /** converting | packing | bundling | publishing */
  phase: string | null;
  attempt: number | null;
  version_id: string | null;
  object_id: string | null;
  error: string | null;
}

/** Client-side stages of a model upload, from file POST to viewer load. */
export type SpeckleUploadStage = 'uploading' | 'queued' | 'processing' | 'materializing' | 'loading';

/** Live progress of a model upload, surfaced in the scene loading overlay. */
export interface SpeckleUploadProgress {
  stage: SpeckleUploadStage;
  /** Speckle's own progress message (e.g. "Converting geometry"). */
  message: string | null;
  /** 0–1 fraction; null = indeterminate. */
  progress: number | null;
  phase: string | null;
  /** Speckle conversion attempt — ≥ 2 means the job was restarted. */
  attempt: number | null;
}
