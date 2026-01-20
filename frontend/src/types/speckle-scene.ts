/**
 * SpeckleScene Component Types
 *
 * Type definitions for the Speckle viewer integration.
 * Extends ThreeScene types to support Speckle models while maintaining
 * all existing audio workflow functionality.
 */

import type { ThreeSceneProps } from './three-scene';

/**
 * SpeckleScene Component Props
 *
 * Extends ThreeSceneProps but makes geometryData optional (use Speckle model instead).
 * Adds Speckle-specific properties for model loading and authentication.
 */
export interface SpeckleSceneProps extends Omit<ThreeSceneProps, 'geometryData'> {
  /** Optional: The 3D geometry data to visualize (COMPAS format) - falls back if no Speckle model */
  geometryData?: ThreeSceneProps['geometryData'];

  /** Speckle model URL (e.g., https://speckle.xyz/streams/streamId/objects/objectId) */
  modelUrl?: string;

  /** Authentication token for private Speckle models */
  authToken?: string;

  /** Full Speckle data from upload (preferred over modelUrl for direct object loading) */
  speckleData?: {
    model_id: string;
    version_id: string;
    file_id: string;
    url: string;
    object_id: string;
    auth_token?: string;
  };

  /** Speckle stream/project ID */
  speckleModelId?: string;

  /** Speckle object/commit ID */
  speckleObjectId?: string;
}

/**
 * Speckle Geometry Node
 *
 * Represents a node in the Speckle geometry hierarchy.
 * Used for traversing and selecting geometry from the Speckle model.
 */
export interface SpeckleGeometryNode {
  /** Unique identifier for the node */
  id: string;

  /** Display name of the node */
  name: string;

  /** Child nodes in the hierarchy */
  children: SpeckleGeometryNode[];

  /** Raw Speckle object data */
  raw: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}
