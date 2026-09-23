/**
 * Speckle Tree Management Hook
 *
 * Adapted from Vue composables in speckle-frontend for React.
 * Manages the hierarchical tree structure of Speckle 3D models.
 *
 * Based on:
 * - speckle-frontend/VirtualTreeItem.vue
 * - speckle-frontend/Panel.vue
 */

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';

/**
 * Explorer Node - represents a node in the Speckle object tree
 * Adapted from ExplorerNode in Vue codebase
 */
export interface ExplorerNode {
  id: string;
  raw: any; // Raw Speckle object data
  model: {
    id: string;
    name?: string;
    children?: ExplorerNode[];
    [key: string]: any;
  };
  children?: ExplorerNode[];
}

/**
 * Virtual Item for the tree
 */
export interface VirtualTreeItem {
  id: string;
  type: 'tree-item';
  indent: number;
  hasChildren: boolean;
  isExpanded: boolean;
  data: ExplorerNode;
  isDescendantOfSelected?: boolean;
  isSelected?: boolean;
}

/**
 * Get target object IDs from Speckle data
 * Adapted from getTargetObjectIds helper
 */
export function getTargetObjectIds(speckleData: any): string[] {
  if (!speckleData || typeof speckleData !== 'object') {
    return [];
  }

  const ids: string[] = [];

  try {
    // Add main ID
    if (speckleData.id) {
      ids.push(speckleData.id);
    }

    // Recursively get children IDs
    if (speckleData.children && Array.isArray(speckleData.children)) {
      speckleData.children.forEach((child: any) => {
        ids.push(...getTargetObjectIds(child));
      });
    }
  } catch (error) {
    console.error('[getTargetObjectIds] Error extracting IDs:', error, speckleData);
  }

  return ids;
}

/**
 * Determine whether a raw Speckle node represents geometry (a surface/mesh/brep).
 */
function isGeometryRaw(raw: any): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const t: string = raw.speckle_type || '';
  if (t.includes('Mesh') || t.includes('Brep')) return true;
  if (t.includes('Objects.Geometry')) return true;
  if (raw.displayValue) return true;
  return false;
}

/**
 * Collect the raw Speckle IDs of all geometry (surface) descendants of a node,
 * including the node itself when it is geometry. Container/layer nodes contribute
 * only their geometry leaves — this is what acoustic material assignment keys off,
 * so assigning at a parent/layer row cascades to all child surfaces.
 */
export function getGeometryLeafIds(raw: any): string[] {
  const ids = new Set<string>();
  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return;
    if (node.id && isGeometryRaw(node)) ids.add(node.id);
    if (Array.isArray(node.children)) node.children.forEach(walk);
  };
  walk(raw);
  return Array.from(ids);
}

/**
 * An object is assignable geometry when it IS a Mesh OR HAS a `displayValue`
 * (Brep/BIM objects).
 */
function rawHasGeometry(raw: any): boolean {
  if (!raw || typeof raw !== 'object') return false;
  if (raw.displayValue != null) return true; // Brep / BIM object carrying a mesh
  const t: string = raw.speckle_type || '';
  return t.includes('Mesh');
}

/**
 * Count the mesh faces of a raw Speckle object. `Mesh.faces` is a flat,
 * count-prefixed array of polygons; after triangulation a polygon with n
 * vertices becomes (n − 2) triangles. A Brep/BIM object carries its meshes in
 * `displayValue` — those are summed.
 */
function countMeshFaces(raw: any): number {
  if (!raw || typeof raw !== 'object') return 0;
  const faces = (raw as any).faces;
  if (faces && typeof faces.length === 'number') {
    let total = 0;
    let i = 0;
    while (i < faces.length) {
      const n = faces[i];
      if (!Number.isFinite(n) || n < 3) break;
      total += n - 2;
      i += n + 1;
    }
    return total;
  }
  const dv = (raw as any).displayValue;
  if (dv && typeof dv === 'object' && typeof dv.length === 'number') {
    let total = 0;
    for (const m of dv) total += countMeshFaces(m);
    return total;
  }
  if (dv && typeof dv === 'object') return countMeshFaces(dv);
  return 0;
}

/**
 * Canonical viewer node id for an ExplorerNode / NodeData.
 *
 * The app walks the viewer's tree nodes, and for most nodes the object is the
 * viewer's `NodeData` — which exposes the unique id directly as `.id` (a
 * `TreeNode` nests it under `.model.id`). When the same content hash appears
 * twice, the viewer keeps the first as the bare hash and suffixes every later
 * copy with `#<n>` (`hash#10`). Keying by `raw.id` collapses all duplicates onto
 * the bare hash, so the acoustic region / visibility sets cannot select one copy.
 * Prefer `.id`, then `.model.id`, then the raw hash.
 */
export function getExplorerNodeId(node: any): string | undefined {
  return node?.id || node?.model?.id || node?.raw?.id || node?.node?.id;
}

/**
 * Walk an ExplorerNode's tree collecting geometry leaf ids and mesh-face counts.
 *
 * Geometry units are keyed by the viewer's UNIQUE node id (`node.id`, e.g.
 * `hash#4`) so each duplicate surface is addressable independently. Raw objects
 * that only appear inside a property graph (no tree node of their own) are
 * collected by their raw hash as a fallback — but only when that hash is not
 * already covered by a node id (otherwise the bare hash would be reintroduced
 * next to its unique `#N` sibling).
 */
function collectGeometryFromNode(node: any): { ids: string[]; faceCounts: Map<string, number> } {
  const ids = new Set<string>();
  const faceCounts = new Map<string, number>();
  const seenNodes = new WeakSet<object>();
  const seenRaw = new WeakSet<object>();

  const addGeometry = (id: string, raw: any) => {
    if (!ids.has(id)) faceCounts.set(id, countMeshFaces(raw));
    ids.add(id);
  };

  // Pass 1 — walk the viewer tree; key node-backed geometry by unique node id.
  const walkNode = (n: any) => {
    if (!n || typeof n !== 'object' || seenNodes.has(n)) return;
    seenNodes.add(n);
    const raw = n.model?.raw || n.raw;
    if (raw) {
      const viewId: string | undefined = n.id || n.model?.id;
      if (viewId && raw.id && rawHasGeometry(raw)) {
        addGeometry(viewId, raw);
        seenRaw.add(raw); // display meshes are walked as child nodes
      }
    }
    const children = n.model?.children || n.children;
    if (Array.isArray(children)) children.forEach(walkNode);
  };
  walkNode(node);

  // Pass 2 — fallback for geometry that has no tree node of its own.
  const coveredBase = new Set<string>();
  ids.forEach((id) => {
    const i = id.indexOf('#');
    coveredBase.add(i === -1 ? id : id.slice(0, i));
  });
  const collectRaw = (raw: any) => {
    if (!raw || typeof raw !== 'object' || seenRaw.has(raw)) return;
    seenRaw.add(raw);
    if (raw.id && rawHasGeometry(raw)) {
      if (!coveredBase.has(raw.id)) addGeometry(raw.id, raw);
      return; // assignable unit — don't descend into its display meshes
    }
    for (const key of Object.keys(raw)) {
      const v = (raw as any)[key];
      if (!v || typeof v !== 'object') continue;
      if (Array.isArray(v)) {
        v.forEach((item) => { if (item && typeof item === 'object') collectRaw(item); });
      } else {
        collectRaw(v);
      }
    }
  };
  const rootRaw = node?.model?.raw || node?.raw;
  if (rootRaw && !seenRaw.has(rootRaw)) collectRaw(rootRaw);

  return { ids: Array.from(ids), faceCounts };
}

/**
 * Like getGeometryLeafIds but walks an ExplorerNode's tree structure
 * (model.children / children) rather than raw.children. Container/layer nodes
 * keep their descendants under model.children, so this is what tree rows must
 * use to find the geometry surfaces under a parent layer (and nested layers).
 *
 * Mirrors the backend's inclusion rule: an object is assignable geometry when it
 * IS a Mesh OR HAS a `displayValue` (Brep/BIM objects). Geometry may hang off any
 * property (`elements`, `displayValue`, …), not just `children`, so we also walk
 * each raw object's full property graph.
 */
export function getGeometryLeafIdsFromNode(node: any): string[] {
  return collectGeometryFromNode(node).ids;
}

/**
 * Mesh-face counts (triangulated) per geometry leaf id under an ExplorerNode.
 * Used to total the acoustic region's mesh complexity.
 */
export function getGeometryFaceCountMapFromNode(node: any): Map<string, number> {
  return collectGeometryFromNode(node).faceCounts;
}

/**
 * Extract a short human-readable type from a full Speckle dotted type path.
 * "Objects.Geometry.Mesh" → "Mesh"
 * "Objects.Other.Instance:Objects.BuiltElements.Wall" → "Wall"
 */
export function extractShortType(speckleType: string): string {
  if (!speckleType) return '';
  const afterColon = speckleType.includes(':') ? speckleType.split(':').pop()! : speckleType;
  const short = afterColon.split('.').pop() || '';
  return short;
}

/**
 * Get header and subheader for Speckle object display
 * Adapted from getHeaderAndSubheaderForSpeckleObject helper
 */
export function getHeaderAndSubheader(speckleData: any, modelFileName?: string | null, isRootNode?: boolean): { header: string; subheader: string } {
  if (!speckleData) return { header: modelFileName || 'Unknown', subheader: '' };

  let name = speckleData.name || speckleData.id || 'Object';
  
  // Replace "Unknown" with model filename if available
  if (name === 'Unknown' && modelFileName) {
    name = modelFileName;
  }
  
  const speckleType = speckleData.speckle_type || '';

  return {
    header: name,
    subheader: extractShortType(speckleType)
  };
}

/**
 * Check if a node or any of its descendants is a Geometry object
 */
function hasGeometryInSubtree(node: ExplorerNode): boolean {
  const speckleType = node.raw?.speckle_type || node.model?.raw?.speckle_type || '';
  
  // Check if this node is a Geometry
  if (speckleType.includes('Objects.Geometry')) {
    return true;
  }
  
  // Check children recursively
  const children = node.model?.children || node.children;
  if (children && children.length > 0) {
    return children.some((child: ExplorerNode) => hasGeometryInSubtree(child));
  }
  
  return false;
}

/**
 * Filter nodes to only include Geometry objects and their ancestors
 */
function filterGeometryNodes(nodes: ExplorerNode[]): ExplorerNode[] {
  return nodes.filter(node => hasGeometryInSubtree(node)).map(node => {
    const children = node.model?.children || node.children;
    if (children && children.length > 0) {
      const filteredChildren = filterGeometryNodes(children as ExplorerNode[]);
      return {
        ...node,
        children: filteredChildren,
        model: node.model ? {
          ...node.model,
          children: filteredChildren
        } : node.model
      };
    }
    return node;
  });
}

/**
 * Check if array contains all items from another array
 */
export function containsAll(items: string[], container: string[]): boolean {
  return items.every(item => container.includes(item));
}

/**
 * Flatten model tree for virtual scrolling (filtered to show only Geometry objects)
 */
export function flattenModelTree(
  rootNodes: ExplorerNode[],
  expandedNodes: Set<string>,
  selectedObjectIds: string[],
  indent: number = 0
): VirtualTreeItem[] {
  const items: VirtualTreeItem[] = [];

  // Filter to only show geometry nodes
  const filteredNodes = filterGeometryNodes(rootNodes);

  for (const node of filteredNodes) {
    // Get the unique viewer node id (duplicate nodes carry a `#N` suffix) so
    // duplicate rows get distinct keys/expansion state. Fall back to raw/id.
    const nodeId = getExplorerNodeId(node) || String(Math.random());

    // Check for children in both possible locations
    const children = node.model?.children || node.children;
    const visibleChildren = children ?? [];
    const hasChildren = visibleChildren.length > 0;
    const isExpanded = expandedNodes.has(nodeId);

    // Check if this node is selected
    const isSelected = selectedObjectIds.includes(nodeId);

    // Check if this node or any ancestor is selected
    const isDescendantOfSelected = selectedObjectIds.some(selectedId => {
      return nodeId.startsWith(selectedId) && nodeId !== selectedId;
    });

    // When a layer contains exactly one item, hide its child by merging:
    // skip the parent row, promote the sole child to the same indent level.
    // Override the promoted child's display name to show the parent's name.
    if (visibleChildren.length === 1) {
      const childItems = flattenModelTree(
        children as ExplorerNode[],
        expandedNodes,
        selectedObjectIds,
        indent
      );
      const parentName = node.raw?.name || node.model?.name;
      if (parentName) {
        for (const item of childItems) {
          if (item.indent === indent) {
            item.data = {
              ...item.data,
              raw: {
                ...item.data.raw,
                name: parentName,
              },
            };
            break;
          }
        }
      }
      items.push(...childItems);
      continue;
    }

    items.push({
      id: nodeId,
      type: 'tree-item',
      indent,
      hasChildren,
      isExpanded,
      data: node,
      isSelected,
      isDescendantOfSelected
    });

    // Recursively add children if expanded
    if (hasChildren && isExpanded && children) {
      items.push(...flattenModelTree(
        children as ExplorerNode[],
        expandedNodes,
        selectedObjectIds,
        indent + 1
      ));
    }
  }

  return items;
}

/**
 * Whether a node is a pure geometry object (Mesh/Brep) rather than a container.
 */
function isPureGeometryNode(node: any): boolean {
  const raw = node?.raw || node?.model?.raw || {};
  const speckleType = raw.speckle_type || '';
  return speckleType.includes('Mesh') || speckleType.includes('Brep');
}

/**
 * Count geometry leaf objects in a subtree (mirrors useSpeckleSurfaceMaterials).
 */
function countGeometryObjectsInNode(node: any): number {
  if (!node) return 0;
  let count = isPureGeometryNode(node) ? 1 : 0;
  const children = node?.model?.children || node?.children || [];
  for (const child of children) {
    count += countGeometryObjectsInNode(child);
  }
  return count;
}

/**
 * Count the number of top-level selectable layers in a world tree.
 *
 * Mirrors the layer definition in useSpeckleSurfaceMaterials.collectLayerNodesRecursive:
 * a layer is a non-geometry container node at depth >= 2 (root -> model container -> layer)
 * that contains at least one geometry leaf. When this returns 1, the model is a single-layer
 * model and can be treated as the whole acoustic model (no layer filtering).
 */
function collectTopLevelLayerNodes(node: any, depth: number, out: ExplorerNode[]): void {
  if (!node) return;
  if (!isPureGeometryNode(node) && depth >= 2 && countGeometryObjectsInNode(node) > 0) {
    out.push(node as ExplorerNode);
  }
  const children = node?.model?.children || node?.children || [];
  for (const child of children) {
    collectTopLevelLayerNodes(child, depth + 1, out);
  }
}

/**
 * Count top-level selectable layers for the whole world tree.
 */
export function countTopLevelLayers(worldTree: any): number {
  if (!worldTree) return 0;
  const layers: ExplorerNode[] = [];
  for (const node of getRootNodesForModel(worldTree)) {
    collectTopLevelLayerNodes(node, 0, layers);
  }
  return layers.length;
}

/**
 * Return the single top-level selectable layer when the model has exactly one,
 * otherwise null. Used to auto-define the acoustic layer for a whole-model
 * (single-layer) model so acoustic mode does not prompt the user to pick a layer.
 */
export function findSingleTopLevelLayer(worldTree: any): ExplorerNode | null {
  if (!worldTree) return null;
  const layers: ExplorerNode[] = [];
  for (const node of getRootNodesForModel(worldTree)) {
    collectTopLevelLayerNodes(node, 0, layers);
  }
  return layers.length === 1 ? layers[0] : null;
}

/**
 * Get root nodes for the model from world tree
 */
export function getRootNodesForModel(worldTree: any, modelFileName?: string | null): ExplorerNode[] {
  if (!worldTree) {
    console.log('[getRootNodesForModel] No worldTree provided');
    return [];
  }


  
  let rootNodes: ExplorerNode[] = [];
  
  // Check different possible tree structures
  // Speckle viewer v3.x structure: worldTree.tree._root.children
  if (worldTree.tree?._root?.children) {
    rootNodes = worldTree.tree._root.children as ExplorerNode[];
  } else if (worldTree._root?.children) {
    rootNodes = worldTree._root.children as ExplorerNode[];
  } else if (worldTree.root?.children) {
    rootNodes = worldTree.root.children as ExplorerNode[];
  } else if (worldTree.children) {
    rootNodes = worldTree.children as ExplorerNode[];
  } else if (worldTree.tree && typeof worldTree.tree === 'object') {
    // Try to access tree.tree if it's a TreeModel
    if (worldTree.tree.root?.children) {
      rootNodes = worldTree.tree.root.children as ExplorerNode[];
    }
  } else if (Array.isArray(worldTree)) {
    rootNodes = worldTree as ExplorerNode[];
  } else {
    console.warn('[getRootNodesForModel] Could not find children in any expected location');
    return [];
  }
  
  // Always set root node name to the model/project filename when available
  if (modelFileName && rootNodes.length > 0) {
    rootNodes = rootNodes.map(node => {
      const updatedNode = { ...node };
      if (updatedNode.model?.raw) {
        updatedNode.model = { ...updatedNode.model, raw: { ...updatedNode.model.raw, name: modelFileName } };
      }
      if (updatedNode.raw) {
        updatedNode.raw = { ...updatedNode.raw, name: modelFileName };
      }
      return updatedNode;
    });
  }
  
  return rootNodes;
}

/**
 * Find object in nodes recursively
 */
export function findObjectInNodes(nodes: ExplorerNode[], objectId: string): boolean {
  for (const node of nodes) {
    const nodeId = getExplorerNodeId(node);
    if (nodeId === objectId) return true;

    const children = node.model?.children || node.children;
    if (children) {
      if (findObjectInNodes(children as ExplorerNode[], objectId)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Expand nodes to show a specific object
 */
export function expandNodesToShowObject(
  nodes: ExplorerNode[],
  objectId: string,
  nodesToExpand: Set<string>
): { found: boolean; expandedNodes: Set<string> } {
  for (const node of nodes) {
    const nodeId = getExplorerNodeId(node);

    if (nodeId === objectId) {
      return { found: true, expandedNodes: nodesToExpand };
    }

    const children = node.model?.children || node.children;
    if (children) {
      const result = expandNodesToShowObject(
        children as ExplorerNode[],
        objectId,
        nodesToExpand
      );

      if (result.found) {
        if (nodeId) nodesToExpand.add(nodeId);
        return { found: true, expandedNodes: nodesToExpand };
      }
    }
  }

  return { found: false, expandedNodes: nodesToExpand };
}

/**
 * Walk the tree and return a Set of node IDs that should be auto-expanded.
 * Expands through chains of single-child nodes until a node with 2+ children
 * or a leaf is reached. The first multi-child node in each chain is also
 * expanded so its children are visible on panel open.
 */
export function getAutoExpandedNodes(
  nodes: ExplorerNode[]
): Set<string> {
  const result = new Set<string>();

  function walk(nodeList: ExplorerNode[]) {
    for (const node of nodeList) {
      const nodeId = getExplorerNodeId(node);
      if (!nodeId) continue;

      const children = node.model?.children || node.children;
      if (!children || children.length === 0) continue;

      if (children.length === 1) {
        result.add(nodeId);
        walk(children as ExplorerNode[]);
      } else {
        // Expand the first "interesting" multi-child node so children are visible
        result.add(nodeId);
      }
    }
  }

  walk(nodes);
  return result;
}

/**
 * Hook for managing Speckle tree state
 */
export function useSpeckleTree(worldTree: any, updateTrigger?: number, modelFileName?: string | null) {
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [selectedObjectIds, setSelectedObjectIds] = useState<string[]>([]);
  const didAutoExpandRef = useRef(false);

  const rootNodes = useMemo(() => {
    const nodes = getRootNodesForModel(worldTree, modelFileName);
    console.log('[useSpeckleTree] useMemo recalculating rootNodes:', nodes.length, 'trigger:', updateTrigger);
    return nodes;
  }, [worldTree, updateTrigger, modelFileName]);

  /**
   * Nodes that must ALWAYS stay expanded: the top-level model roots and the
   * "Received model" collection (Speckle's `artifact-root`). Collapsing everything
   * must stop at these so the layer list stays visible.
   */
  const pinnedExpandedIds = useMemo(() => {
    const pinned = new Set<string>();
    const walk = (nodes: any[], depth: number) => {
      for (const node of nodes) {
        const raw = node?.raw || node?.model?.raw || {};
        const id: string | undefined = getExplorerNodeId(node);
        if (id && (depth === 0 || raw.applicationId === 'artifact-root' || raw.name === 'Received model')) {
          pinned.add(id);
        }
        const children = node?.model?.children || node?.children || [];
        if (children.length > 0) walk(children, depth + 1);
      }
    };
    walk(rootNodes, 0);
    return pinned;
  }, [rootNodes]);

  // Auto-expand single-child chains on initial tree load
  useEffect(() => {
    if (didAutoExpandRef.current) return;
    if (!rootNodes || rootNodes.length === 0) return;
    didAutoExpandRef.current = true;
    const autoExpand = getAutoExpandedNodes(rootNodes);
    if (autoExpand.size > 0) {
      setExpandedNodes(prev => {
        const next = new Set(prev);
        autoExpand.forEach(id => next.add(id));
        return next;
      });
    }
  }, [rootNodes]);

  // Keep the pinned roots ("Received model") expanded at all times.
  useEffect(() => {
    if (pinnedExpandedIds.size === 0) return;
    setExpandedNodes(prev => {
      let changed = false;
      const next = new Set(prev);
      pinnedExpandedIds.forEach(id => {
        if (!next.has(id)) { next.add(id); changed = true; }
      });
      return changed ? next : prev;
    });
  }, [pinnedExpandedIds]);

  const virtualItems = useMemo(() => {
    const items = flattenModelTree(rootNodes, expandedNodes, selectedObjectIds);
    console.log('[useSpeckleTree] useMemo recalculating virtualItems:', items.length);
    return items;
  }, [rootNodes, expandedNodes, selectedObjectIds]);

  const toggleNodeExpansion = useCallback((nodeId: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        // Pinned roots ("Received model") can never be collapsed.
        if (pinnedExpandedIds.has(nodeId)) return prev;
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }, [pinnedExpandedIds]);

  const expandToShowObject = useCallback((objectId: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      expandNodesToShowObject(rootNodes, objectId, next);
      return next;
    });
  }, [rootNodes]);

  const setSelection = useCallback((objectIds: string[]) => {
    setSelectedObjectIds(objectIds);
  }, []);

  const selectObject = useCallback((objectId: string) => {
    setSelectedObjectIds([objectId]);
  }, []);

  const addToSelection = useCallback((objectId: string) => {
    setSelectedObjectIds(prev => prev.includes(objectId) ? prev : [...prev, objectId]);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedObjectIds([]);
  }, []);

  // Collapse every layer/object, leaving only the pinned roots ("Received model")
  // expanded so the layer list remains visible.
  const collapseToRoot = useCallback(() => {
    setExpandedNodes(new Set(pinnedExpandedIds));
  }, [pinnedExpandedIds]);

  const removeFromSelection = useCallback((objectId: string) => {
    setSelectedObjectIds(prev => prev.filter(id => id !== objectId));
  }, []);

  return {
    rootNodes,
    virtualItems,
    expandedNodes,
    selectedObjectIds,
    toggleNodeExpansion,
    expandToShowObject,
    setSelection,
    selectObject,
    addToSelection,
    clearSelection,
    collapseToRoot,
    removeFromSelection
  };
}
