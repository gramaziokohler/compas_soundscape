/**
 * Hook for managing Speckle-based surface materials
 *
 * Extracts layers from world tree, finds "Acoustics" layer or provides alternatives,
 * extracts mesh objects from selected layer, and tracks material assignments per object ID.
 *
 * Used for PyroomAcoustics and Choras simulations with Speckle models.
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Viewer } from '@speckle/viewer';
import type {
  SpeckleMeshObject,
  SpeckleLayerInfo,
  SpeckleMaterialAssignment,
  ObjectColorGroup
} from '@/types/speckle-materials';
import type { ExplorerNode } from './useSpeckleTree';
import type { AcousticMaterial } from '@/types/materials';
import { getMaterialColorByAbsorption, MATERIAL_DEFAULT_COLOR } from '@/utils/constants';

/**
 * Hierarchical mesh object with children
 */
export interface HierarchicalMeshObject extends SpeckleMeshObject {
  children: HierarchicalMeshObject[];
  hasGeometry: boolean;
}

interface UseSpeckleSurfaceMaterialsReturn {
  // State
  selectedLayerId: string | null;
  layerOptions: SpeckleLayerInfo[];
  meshObjects: HierarchicalMeshObject[]; // Now hierarchical
  materialAssignments: Map<string, string>; // objectId -> materialId

  // Methods
  selectLayer: (layerId: string) => void;
  assignMaterial: (objectId: string, materialId: string) => void;
  assignMaterialToAll: (materialId: string) => void;
  assignMaterialToObjects: (objectIds: string[], materialId: string) => void;
  getMaterialColor: (materialId: string) => string;
  getColorGroups: () => ObjectColorGroup[];
  clearMaterialAssignments: () => void;
  getAllObjectIds: () => string[]; // Get all object IDs in the tree
}

/**
 * Get root children from world tree (handles different structures)
 */
function getRootChildren(worldTree: any): any[] {
  if (!worldTree) return [];

  if (worldTree.tree?._root?.children) {
    return worldTree.tree._root.children;
  } else if (worldTree._root?.children) {
    return worldTree._root.children;
  } else if (worldTree.root?.children) {
    return worldTree.root.children;
  } else if (worldTree.children) {
    return worldTree.children;
  }

  return [];
}

/**
 * Check if a node contains geometry (mesh/brep)
 */
function isGeometryNode(node: any): boolean {
  const raw = node?.raw || node?.model?.raw || {};
  const speckleType = raw.speckle_type || '';

  return speckleType.includes('Mesh') ||
         speckleType.includes('Brep') ||
         speckleType.includes('Geometry');
}

/**
 * Extract layers from world tree - goes TWO LEVELS DEEPER
 * Root nodes -> Model containers -> Their children are the actual layers
 */
function extractLayers(worldTree: any): SpeckleLayerInfo[] {
  const layers: SpeckleLayerInfo[] = [];

  if (!worldTree) return layers;

  try {
    const rootChildren = getRootChildren(worldTree);

    // The root children contain the model root(s)
    for (const rootNode of rootChildren) {
      const modelContainers = rootNode?.model?.children || rootNode?.children || [];

      // Go one level deeper - into model containers
      for (const container of modelContainers) {
        const layerNodes = container?.model?.children || container?.children || [];

        // These are the actual layers
        for (const layerNode of layerNodes) {
          const raw = layerNode?.raw || layerNode?.model?.raw || {};
          const name = raw.name || layerNode?.model?.name || 'Unnamed Layer';
          const id = raw.id || layerNode?.model?.id || layerNode?.id || `layer-${layers.length}`;

          // Count geometry objects in this layer
          const meshCount = countGeometryObjects(layerNode);

          if (meshCount > 0) {
            layers.push({
              id,
              name,
              meshCount,
              meshObjects: [] // Will be populated when layer is selected
            });
          }
        }
      }
    }
  } catch (error) {
    console.error('[extractLayers] Error:', error);
  }

  return layers;
}

/**
 * Count geometry objects in a subtree
 */
function countGeometryObjects(node: any): number {
  if (!node) return 0;

  let count = 0;

  if (isGeometryNode(node)) {
    count = 1;
  }

  const children = node?.model?.children || node?.children || [];
  for (const child of children) {
    count += countGeometryObjects(child);
  }

  return count;
}

/**
 * Build hierarchical mesh object tree from a layer node
 */
function buildHierarchicalTree(node: any): HierarchicalMeshObject | null {
  if (!node) return null;

  const raw = node?.raw || node?.model?.raw || {};
  const name = raw.name || node?.model?.name || 'Unnamed';
  const id = raw.id || node?.model?.id || node?.id || `obj-${Math.random()}`;
  const speckleType = raw.speckle_type || '';

  const hasGeometry = isGeometryNode(node);
  const children: HierarchicalMeshObject[] = [];

  // Process children
  const nodeChildren = node?.model?.children || node?.children || [];
  for (const child of nodeChildren) {
    const childObj = buildHierarchicalTree(child);
    if (childObj && (childObj.hasGeometry || childObj.children.length > 0)) {
      children.push(childObj);
    }
  }

  // Only include if this node has geometry or has children with geometry
  if (!hasGeometry && children.length === 0) {
    return null;
  }

  return {
    id,
    name,
    speckle_type: speckleType,
    hasGeometry,
    children
  };
}

/**
 * Get the layer node from world tree by ID
 * Searches two levels deep: root -> containers -> layers
 */
function getLayerNode(worldTree: any, layerId: string): any | null {
  if (!worldTree) return null;

  const rootChildren = getRootChildren(worldTree);

  for (const rootNode of rootChildren) {
    const modelContainers = rootNode?.model?.children || rootNode?.children || [];

    // Go one level deeper into containers
    for (const container of modelContainers) {
      const layerNodes = container?.model?.children || container?.children || [];

      // Search for the layer in the actual layer nodes
      for (const layerNode of layerNodes) {
        const raw = layerNode?.raw || layerNode?.model?.raw || {};
        const nodeId = raw.id || layerNode?.model?.id || layerNode?.id;

        if (nodeId === layerId) {
          return layerNode;
        }
      }
    }
  }

  return null;
}

/**
 * Collect all geometry object IDs from hierarchical tree
 */
function collectAllObjectIds(objects: HierarchicalMeshObject[]): string[] {
  const ids: string[] = [];

  for (const obj of objects) {
    if (obj.hasGeometry) {
      ids.push(obj.id);
    }
    ids.push(...collectAllObjectIds(obj.children));
  }

  return ids;
}

/**
 * Options for initializing the hook with persisted state
 */
interface UseSpeckleSurfaceMaterialsOptions {
  initialAssignments?: Record<string, string>; // objectId -> materialId (from config)
  initialLayerName?: string | null; // Previously selected layer name (resolved to ID internally)
}

/**
 * Hook for managing Speckle surface materials
 */
export function useSpeckleSurfaceMaterials(
  viewerRef: React.RefObject<Viewer | null>,
  worldTree: any,
  availableMaterials: AcousticMaterial[],
  options?: UseSpeckleSurfaceMaterialsOptions
): UseSpeckleSurfaceMaterialsReturn {
  // Initialize from persisted state if provided
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [materialAssignments, setMaterialAssignments] = useState<Map<string, string>>(() => {
    if (options?.initialAssignments && Object.keys(options.initialAssignments).length > 0) {
      return new Map(Object.entries(options.initialAssignments));
    }
    return new Map();
  });

  // Defensive re-sync: if the component is reused (stays mounted) but
  // initialAssignments changes (e.g. switching simulation cards), re-initialize.
  // Guard: skip if the incoming assignments are identical to our current state —
  // this prevents a loop where the parent reflects our own changes back as a new
  // object reference (assignMaterial → notify parent → parent updates config →
  // config.speckleMaterialAssignments is a new object → this effect fires again).
  const prevInitialRef = useRef(options?.initialAssignments);
  const initialAssignments = options?.initialAssignments;
  const materialAssignmentsRef = useRef(materialAssignments);
  materialAssignmentsRef.current = materialAssignments;
  useEffect(() => {
    if (initialAssignments === prevInitialRef.current) return;
    prevInitialRef.current = initialAssignments;

    if (!initialAssignments || Object.keys(initialAssignments).length === 0) return;

    // Skip if the content matches our current state (parent echoing our own changes)
    const current = materialAssignmentsRef.current;
    const entries = Object.entries(initialAssignments);
    if (
      entries.length === current.size &&
      entries.every(([k, v]) => current.get(k) === v)
    ) return;

    setMaterialAssignments(new Map(entries));
  }, [initialAssignments]);

  // Track if we've already initialized the layer selection
  const [hasInitializedLayer, setHasInitializedLayer] = useState(false);

  // Store initial layer name for resolution when layers become available
  const initialLayerName = options?.initialLayerName;

  // Extract layers from world tree (one level deeper)
  const layerOptions = useMemo(() => {
    console.log('[useSpeckleSurfaceMaterials] Extracting layers from worldTree');
    return extractLayers(worldTree);
  }, [worldTree]);

  // Build hierarchical mesh objects from selected layer
  const meshObjects = useMemo((): HierarchicalMeshObject[] => {
    if (!selectedLayerId || !worldTree) return [];

    const layerNode = getLayerNode(worldTree, selectedLayerId);
    if (!layerNode) return [];

    // Build hierarchical tree from layer's children
    const children = layerNode?.model?.children || layerNode?.children || [];
    const hierarchicalObjects: HierarchicalMeshObject[] = [];

    for (const child of children) {
      const obj = buildHierarchicalTree(child);
      if (obj) {
        hierarchicalObjects.push(obj);
      }
    }

    console.log('[useSpeckleSurfaceMaterials] Built hierarchical tree:', hierarchicalObjects);
    return hierarchicalObjects;
  }, [selectedLayerId, worldTree]);

  // Auto-select layer: prioritize persisted layer name, then "Acoustics", then first layer
  useEffect(() => {
    if (layerOptions.length === 0) {
      setSelectedLayerId(null);
      return;
    }

    // Skip if we've already initialized
    if (hasInitializedLayer && selectedLayerId) {
      // Verify the current layer still exists
      const layerExists = layerOptions.some(l => l.id === selectedLayerId);
      if (layerExists) {
        return;
      }
      // If current layer doesn't exist, fall through to re-selection
    }

    // First priority: try to restore from persisted layer name
    if (initialLayerName) {
      const persistedLayer = layerOptions.find(l => l.name === initialLayerName);
      if (persistedLayer) {
        console.log('[useSpeckleSurfaceMaterials] Restoring persisted layer:', initialLayerName, '->', persistedLayer.id);
        setSelectedLayerId(persistedLayer.id);
        setHasInitializedLayer(true);
        return;
      }
    }

    // Second priority: try to find "Acoustics" layer
    const acousticsLayer = layerOptions.find(
      l => l.name.toLowerCase() === 'acoustics'
    );

    if (acousticsLayer) {
      console.log('[useSpeckleSurfaceMaterials] Found "Acoustics" layer:', acousticsLayer);
      setSelectedLayerId(acousticsLayer.id);
    } else {
      console.log('[useSpeckleSurfaceMaterials] No "Acoustics" layer found, using first layer:', layerOptions[0]);
      setSelectedLayerId(layerOptions[0].id);
    }

    // Mark as initialized after first selection
    setHasInitializedLayer(true);
  }, [layerOptions, hasInitializedLayer, selectedLayerId, initialLayerName]);

  /**
   * Select a layer by ID
   */
  const selectLayer = useCallback((layerId: string) => {
    console.log('[useSpeckleSurfaceMaterials] Selecting layer:', layerId);
    setSelectedLayerId(layerId);
    // Clear material assignments when changing layers
    setMaterialAssignments(new Map());
  }, []);

  /**
   * Get all geometry object IDs in current selection
   */
  const getAllObjectIds = useCallback((): string[] => {
    return collectAllObjectIds(meshObjects);
  }, [meshObjects]);

  /**
   * Assign material to an object (and optionally its children)
   */
  const assignMaterial = useCallback((objectId: string, materialId: string) => {
    console.log('[useSpeckleSurfaceMaterials] Assigning material:', { objectId, materialId });
    setMaterialAssignments(prev => {
      const newAssignments = new Map(prev);
      if (materialId) {
        newAssignments.set(objectId, materialId);
      } else {
        newAssignments.delete(objectId);
      }
      return newAssignments;
    });
  }, []);

  /**
   * Assign material to a specific set of objects in a single state update
   */
  const assignMaterialToObjects = useCallback((objectIds: string[], materialId: string) => {
    console.log('[useSpeckleSurfaceMaterials] Assigning material to', objectIds.length, 'objects:', materialId);
    setMaterialAssignments(prev => {
      const newAssignments = new Map(prev);
      for (const objectId of objectIds) {
        if (materialId) {
          newAssignments.set(objectId, materialId);
        } else {
          newAssignments.delete(objectId);
        }
      }
      return newAssignments;
    });
  }, []);

  /**
   * Assign material to ALL objects in the tree
   */
  const assignMaterialToAll = useCallback((materialId: string) => {
    console.log('[useSpeckleSurfaceMaterials] Assigning material to all:', materialId);
    const allIds = collectAllObjectIds(meshObjects);

    setMaterialAssignments(prev => {
      const newAssignments = new Map(prev);
      for (const id of allIds) {
        if (materialId) {
          newAssignments.set(id, materialId);
        } else {
          newAssignments.delete(id);
        }
      }
      return newAssignments;
    });
  }, [meshObjects]);

  /**
   * Get color for a material ID based on its absorption coefficient
   * Uses gradient from pink (low absorption) to teal (high absorption)
   */
  const getMaterialColor = useCallback((materialId: string): string => {
    // Find material in available materials
    const material = availableMaterials.find(m => m.id === materialId);
    if (!material) {
      console.warn('[useSpeckleSurfaceMaterials] Material not found:', materialId, 'Using default color');
      return MATERIAL_DEFAULT_COLOR;
    }

    // Get color based on absorption coefficient
    const color = getMaterialColorByAbsorption(material.absorption);
    return color;
  }, [availableMaterials]);

  /**
   * Get color groups for FilteringExtension.setUserObjectColors
   */
  const getColorGroups = useCallback((): ObjectColorGroup[] => {
    const colorGroups: ObjectColorGroup[] = [];
    const colorMap = new Map<string, string[]>(); // color -> objectIds[]

    // Group objects by color
    materialAssignments.forEach((materialId, objectId) => {
      const color = getMaterialColor(materialId);

      if (!colorMap.has(color)) {
        colorMap.set(color, []);
      }
      colorMap.get(color)!.push(objectId);
    });

    // Convert to ObjectColorGroup format
    colorMap.forEach((objectIds, color) => {
      colorGroups.push({ objectIds, color });
    });

    return colorGroups;
  }, [materialAssignments, getMaterialColor]);

  /**
   * Clear all material assignments
   */
  const clearMaterialAssignments = useCallback(() => {
    console.log('[useSpeckleSurfaceMaterials] Clearing all material assignments');
    setMaterialAssignments(new Map());
  }, []);

  return {
    selectedLayerId,
    layerOptions,
    meshObjects,
    materialAssignments,
    selectLayer,
    assignMaterial,
    assignMaterialToAll,
    assignMaterialToObjects,
    getMaterialColor,
    getColorGroups,
    clearMaterialAssignments,
    getAllObjectIds
  };
}
