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
}

/** Response envelope from GET /api/speckle/models */
export interface SpeckleProjectModelsResponse {
  project_id: string;
  models: SpeckleModelDetail[];
  total_count: number;
  auth_token?: string;
}
