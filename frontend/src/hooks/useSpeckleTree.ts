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
  const ids = new Set<string>();
  const seen = new WeakSet<object>();

  const rawHasGeometry = (raw: any): boolean => {
    if (!raw || typeof raw !== 'object') return false;
    if (raw.displayValue != null) return true; // Brep / BIM object carrying a mesh
    const t: string = raw.speckle_type || '';
    return t.includes('Mesh');
  };

  // Walk a raw Speckle object graph collecting assignable geometry ids.
  const collectFromRaw = (raw: any) => {
    if (!raw || typeof raw !== 'object' || seen.has(raw)) return;
    seen.add(raw);
    if (raw.id && rawHasGeometry(raw)) {
      ids.add(raw.id);
      return; // assignable unit — don't descend into its display meshes
    }
    for (const key of Object.keys(raw)) {
      const v = (raw as any)[key];
      if (!v || typeof v !== 'object') continue;
      if (Array.isArray(v)) {
        v.forEach((item) => { if (item && typeof item === 'object') collectFromRaw(item); });
      } else {
        collectFromRaw(v);
      }
    }
  };

  // Walk the ExplorerNode tree (viewer-known nodes) and inspect each node's raw.
  const walkNode = (n: any) => {
    if (!n || typeof n !== 'object' || seen.has(n)) return;
    seen.add(n);
    const raw = n.model?.raw || n.raw;
    if (raw) collectFromRaw(raw);
    const children = n.model?.children || n.children;
    if (Array.isArray(children)) children.forEach(walkNode);
  };

  walkNode(node);
  return Array.from(ids);
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
    // Get node ID - try multiple sources
    const nodeId = node.raw?.id || node.model?.id || node.id || String(Math.random());

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
    const nodeId = node.raw?.id || node.model?.id || node.id;
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
    const nodeId = node.raw?.id || node.model?.id || node.id;

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
        nodesToExpand.add(nodeId);
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
      const nodeId = node.raw?.id || node.model?.id || node.id;
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

  const virtualItems = useMemo(() => {
    const items = flattenModelTree(rootNodes, expandedNodes, selectedObjectIds);
    console.log('[useSpeckleTree] useMemo recalculating virtualItems:', items.length);
    return items;
  }, [rootNodes, expandedNodes, selectedObjectIds]);

  const toggleNodeExpansion = useCallback((nodeId: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }, []);

  const expandToShowObject = useCallback((objectId: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      expandNodesToShowObject(rootNodes, objectId, next);
      return next;
    });
  }, [rootNodes]);

  const selectObject = useCallback((objectId: string) => {
    setSelectedObjectIds([objectId]);
  }, []);

  const addToSelection = useCallback((objectId: string) => {
    setSelectedObjectIds(prev => [...prev, objectId]);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedObjectIds([]);
  }, []);

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
    selectObject,
    addToSelection,
    clearSelection,
    removeFromSelection
  };
}
