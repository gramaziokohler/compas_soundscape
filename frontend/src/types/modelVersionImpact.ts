/**
 * Model version update impact — mirrors backend ModelVersionImpact* schemas
 * (POST /api/speckle/version-impact).
 */

/** Changes at or below these thresholds never invalidate results. */
export interface ModelVersionTolerance {
  distance_m: number;
  angle_deg: number;
  area_ratio: number;
}

/** Acoustic region sent for scoping: whole model, or ids (any alias) + layer names. */
export interface ModelVersionRegion {
  whole_model: boolean;
  ids: string[];
  layers: string[];
}

export interface ModelVersionPlacementPoint {
  id: string;
  position: [number, number, number];
}

export interface ModelVersionImpactRequest {
  from_version_id: string;
  to_version_id: string;
  tolerance: ModelVersionTolerance;
  region: ModelVersionRegion | null;
  points: ModelVersionPlacementPoint[];
}

export type ModelVersionObjectStatus = 'changed' | 'added' | 'removed' | 'below_tolerance';

export interface ModelVersionObjectChange {
  over_tolerance: boolean;
  kind: 'moved' | 'rotated' | 'scaled' | 'reshaped';
  moved_m: number;
  extent_change_m: number;
  area_change_ratio: number;
  scale: number | null;
  rotation_deg: number;
}

export interface ModelVersionObjectImpact {
  /** Stable key across versions (applicationId, else raw hash). */
  key: string;
  name: string;
  layer: string | null;
  application_id: string | null;
  /** Raw Speckle hashes in the version that holds the object (new, or old if removed). */
  raw_ids: string[];
  status: ModelVersionObjectStatus;
  in_region: boolean;
  change: ModelVersionObjectChange | null;
}

export interface ModelVersionRegionTotals {
  object_count: number;
  area_m2: number;
  bounding_volume_m3: number;
}

export interface ModelVersionPlacement {
  id: string;
  status: 'outside' | 'inside_object';
  object_name?: string | null;
  object_key?: string | null;
}

export interface ModelVersionImpactReport {
  from_version_id: string;
  to_version_id: string;
  tolerance: ModelVersionTolerance;
  counts: Record<ModelVersionObjectStatus, number>;
  region_counts: Record<ModelVersionObjectStatus, number>;
  objects: ModelVersionObjectImpact[];
  region: { before: ModelVersionRegionTotals; after: ModelVersionRegionTotals };
  placements: ModelVersionPlacement[];
}
