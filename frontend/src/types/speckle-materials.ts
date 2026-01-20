/**
 * Speckle-based surface materials types for acoustic simulations
 *
 * These types support material assignment to Speckle mesh objects for
 * PyroomAcoustics and Choras simulations.
 */

/**
 * Speckle mesh object extracted from world tree
 */
export interface SpeckleMeshObject {
  id: string;
  name: string;
  speckle_type: string;
}

/**
 * Layer information from Speckle world tree
 */
export interface SpeckleLayerInfo {
  id: string;
  name: string;
  meshCount: number;
  meshObjects: SpeckleMeshObject[];
}

/**
 * Material assignment linking object ID to material ID
 */
export interface SpeckleMaterialAssignment {
  objectId: string;
  materialId: string;
}

/**
 * Color group for FilteringExtension.setUserObjectColors
 */
export interface ObjectColorGroup {
  objectIds: string[];
  color: string;
}
