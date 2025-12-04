/**
 * Material Assignment Types
 * 
 * Type definitions for hierarchical acoustic material assignment
 * in the Precise Acoustics mode.
 */

/**
 * Acoustic material definition (placeholder for now)
 */
export interface AcousticMaterial {
  id: string;
  name: string;
  // Future properties: absorption coefficients, scattering, etc.
}

/**
 * Material assignment at face level
 */
export interface FaceMaterialAssignment {
  faceIndex: number;
  material: AcousticMaterial | null;
}

/**
 * Material assignment at entity level (overrides all faces)
 */
export interface EntityMaterialAssignment {
  entityIndex: number;
  material: AcousticMaterial | null;
  // Face-level overrides (if user wants specific faces to differ)
  faceOverrides?: Map<number, AcousticMaterial | null>;
}

/**
 * Material assignment at layer/group level (overrides all entities)
 */
export interface LayerMaterialAssignment {
  layerId: string;
  layerName: string;
  material: AcousticMaterial | null;
  // Entity-level overrides
  entityOverrides?: Map<number, AcousticMaterial | null>;
}

/**
 * Global material assignment (overrides all layers)
 */
export interface GlobalMaterialAssignment {
  material: AcousticMaterial | null;
  // Layer-level overrides
  layerOverrides?: Map<string, AcousticMaterial | null>;
}

/**
 * Complete material assignment state for a model
 */
export interface MaterialAssignmentState {
  // Global default
  globalMaterial: AcousticMaterial | null;
  
  // Layer/group level assignments
  layerAssignments: Map<string, LayerMaterialAssignment>;
  
  // Entity level assignments
  entityAssignments: Map<number, EntityMaterialAssignment>;
  
  // Face level assignments
  faceAssignments: Map<number, FaceMaterialAssignment>;
}

/**
 * Selected face/entity for highlighting and UI interaction
 */
export interface SelectedGeometry {
  type: 'face' | 'entity' | 'layer' | 'global';
  faceIndex?: number;
  entityIndex?: number;
  layerId?: string;
}

/**
 * Hierarchical tree node for UI display
 */
export interface MaterialTreeNode {
  id: string;
  type: 'global' | 'layer' | 'entity' | 'face';
  label: string;
  material: AcousticMaterial | null;
  children?: MaterialTreeNode[];
  
  // Metadata
  entityIndex?: number;
  faceIndex?: number;
  layerId?: string;
  isExpanded?: boolean;
}
