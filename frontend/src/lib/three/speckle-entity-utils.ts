import * as THREE from 'three';
import type { SoundEntity } from '@/types';

function findObjectInTree(tree: any, id: string): any {
  if (!tree) return null;

  const checkNode = (node: any): any => {
    const nodeId = node?.raw?.id || node?.model?.id || node?.id;
    if (nodeId === id) return node;
    const children = node?.model?.children || node?.children;
    if (children) {
      for (const child of children) {
        const found = checkNode(child);
        if (found) return found;
      }
    }
    return null;
  };

  const rootChildren =
    tree.tree?._root?.children ||
    tree._root?.children ||
    tree.root?.children ||
    tree.children;
  if (rootChildren) {
    for (const child of rootChildren) {
      const found = checkNode(child);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Find a node by id AND return its ancestor chain (child → … → root).
 * Needed because Speckle model trees often expose geometry as a `displayValue`
 * child `Mesh` that carries NO `applicationId`; the stable `applicationId` (the
 * Rhino GUID) lives on the host `DataObject` one level up.
 */
function findObjectWithChain(tree: any, id: string): { node: any; chain: any[] } | null {
  if (!tree) return null;

  const checkNode = (node: any, chain: any[]): { node: any; chain: any[] } | null => {
    const nodeId = node?.raw?.id || node?.model?.id || node?.id;
    const nextChain = [node, ...chain];
    if (nodeId === id) return { node, chain: nextChain };
    const children = node?.model?.children || node?.children;
    if (children) {
      for (const child of children) {
        const found = checkNode(child, nextChain);
        if (found) return found;
      }
    }
    return null;
  };

  const rootChildren =
    tree.tree?._root?.children ||
    tree._root?.children ||
    tree.root?.children ||
    tree.children;
  if (rootChildren) {
    for (const child of rootChildren) {
      const found = checkNode(child, []);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Resolve the stable identity of a clicked Speckle node.
 *
 * A clicked render node is frequently a `displayValue` mesh whose
 * `applicationId` was stripped during bundle materialization. Walk up the
 * ancestor chain (self first) to the nearest node that carries an
 * `applicationId` — the only id that survives a model republish — and return
 * both it and the current tree id of that node.
 *
 * @returns `{ treeId, applicationId, node }` or `null` when the id is unknown.
 *          `applicationId` is `undefined` when no ancestor carries one.
 */
export function resolveStableEntityId(
  worldTree: any,
  clickedId: string,
): { treeId: string; applicationId?: string; node: any } | null {
  const found = findObjectWithChain(worldTree, clickedId);
  if (!found) return null;

  for (const node of found.chain) {
    const appId: string | undefined =
      node?.raw?.applicationId || node?.model?.raw?.applicationId || undefined;
    if (appId) {
      const treeId: string =
        node?.model?.id || node?.raw?.id || node?.id || clickedId;
      return { treeId, applicationId: appId, node };
    }
  }

  // No ancestor carries an applicationId — fall back to the clicked node id.
  return { treeId: clickedId, applicationId: undefined, node: found.node };
}

function isContainerNode(node: any): boolean {
  const raw = node?.raw || node?.model?.raw;
  if (!raw) return false;
  const hasDisplay = raw.displayValue !== undefined && raw.displayValue !== null;
  const isMesh = (raw.speckle_type || '').includes('Mesh');
  return !!raw.name && !hasDisplay && !isMesh;
}

/**
 * Build the layer path for a node from its ancestor chain (root → node),
 * joining container names with `::` to mirror the backend's layer strings
 * (e.g. `Received model::Project …::3D::3D_Möbel`).
 */
export function computeLayerPath(chain: any[]): string {
  const names = chain
    .filter(isContainerNode)
    .map((n) => (n?.raw || n?.model?.raw)?.name as string)
    .filter(Boolean);
  return names.join('::');
}

/**
 * Fallback resolver used when a persisted `applicationId` no longer exists in
 * the updated model (e.g. the object was replaced). Matches by object name,
 * disambiguated by layer path. Returns the node only when the match is
 * unambiguous — never guesses.
 */
export function resolveEntityByNameLayer(
  worldTree: any,
  name: string,
  layer?: string,
): any | null {
  if (!name) return null;

  const matches: { node: any; layer: string }[] = [];
  const walk = (node: any, chain: any[]) => {
    const raw = node?.raw || node?.model?.raw;
    const nodeName: string | undefined = node?.model?.name || raw?.name;
    if (nodeName === name) {
      matches.push({ node, layer: computeLayerPath(chain) });
    }
    const children = node?.model?.children || node?.children || [];
    const nextChain = [node, ...chain];
    for (const child of children) walk(child, nextChain);
  };

  const rootChildren =
    worldTree?.tree?._root?.children ||
    worldTree?._root?.children ||
    worldTree?.root?.children ||
    worldTree?.children;
  if (rootChildren) {
    for (const child of rootChildren) walk(child, []);
  }

  if (matches.length === 0) return null;
  if (layer) {
    const layerMatch = matches.filter(
      (m) => m.layer && (m.layer === layer || m.layer.endsWith(layer) || layer.endsWith(m.layer)),
    );
    if (layerMatch.length === 1) return layerMatch[0].node;
  }
  if (matches.length === 1) return matches[0].node;
  return null;
}

function collectDescendantAabbs(node: any): THREE.Box3[] {
  const boxes: THREE.Box3[] = [];
  const rv = node?.model?.renderView || node?.renderView;
  if (rv?.aabb) boxes.push(rv.aabb as THREE.Box3);
  const children: any[] = node?.model?.children || node?.children || [];
  for (const child of children) {
    boxes.push(...collectDescendantAabbs(child));
  }
  return boxes;
}

export function findNodeInWorldTree(tree: any, id: string): any {
  return findObjectInTree(tree, id);
}

/**
 * Build a `SoundEntity` from a Speckle object id, resolving its position/bounds
 * from the renderView AABB (raw bounds, then union of descendant AABBs as fallback).
 * Shared by the entity-linking selection flow (page-level commit).
 */
export function buildEntityFromObjectId(
  worldTree: any,
  objectId: string,
  existingEntities: SoundEntity[] = [],
): SoundEntity | null {
  const objectData = findObjectInTree(worldTree, objectId);
  if (!objectData) return null;

  // Resolve the stable applicationId by walking up to the host DataObject when
  // the clicked node is a display mesh (see resolveStableEntityId).
  const stable = resolveStableEntityId(worldTree, objectId);
  const applicationId = stable?.applicationId;

  const objectName = objectData?.model?.name || objectData?.raw?.name || 'Unnamed Object';
  const objectType = objectData?.raw?.speckle_type || 'Speckle Object';
  const foundWithChain = findObjectWithChain(worldTree, objectId);
  const layer = foundWithChain ? computeLayerPath(foundWithChain.chain) : undefined;

  let position: [number, number, number] = [0, 0, 0];
  let entityBounds:
    | { min: [number, number, number]; max: [number, number, number]; center: [number, number, number] }
    | undefined;

  try {
    const renderView = objectData?.model?.renderView || objectData?.renderView;
    if (renderView?.aabb) {
      const aabb = renderView.aabb as THREE.Box3;
      const center = new THREE.Vector3();
      aabb.getCenter(center);
      position = [center.x, center.y, center.z];
      entityBounds = {
        min: [aabb.min.x, aabb.min.y, aabb.min.z],
        max: [aabb.max.x, aabb.max.y, aabb.max.z],
        center: position,
      };
    }
  } catch (boundsError) {
    console.warn('[speckle-entity-utils] Could not read render bounds:', boundsError);
  }

  // Fallback: raw bounds
  if (position[0] === 0 && position[1] === 0 && position[2] === 0) {
    const rawBounds = objectData?.raw?.bounds || objectData?.model?.bounds;
    if (rawBounds && rawBounds.min && rawBounds.max) {
      position = [
        (rawBounds.min.x + rawBounds.max.x) / 2,
        (rawBounds.min.y + rawBounds.max.y) / 2,
        (rawBounds.min.z + rawBounds.max.z) / 2,
      ];
      entityBounds = {
        min: [rawBounds.min.x, rawBounds.min.y, rawBounds.min.z],
        max: [rawBounds.max.x, rawBounds.max.y, rawBounds.max.z],
        center: position,
      };
    }
  }

  // Fallback: union descendant aabbs (parent layer nodes)
  if (position[0] === 0 && position[1] === 0 && position[2] === 0) {
    const allBoxes = collectDescendantAabbs(objectData);
    if (allBoxes.length > 0) {
      const unionBox = new THREE.Box3();
      for (const box of allBoxes) unionBox.union(box);
      const center = new THREE.Vector3();
      unionBox.getCenter(center);
      position = [center.x, center.y, center.z];
      entityBounds = {
        min: [unionBox.min.x, unionBox.min.y, unionBox.min.z],
        max: [unionBox.max.x, unionBox.max.y, unionBox.max.z],
        center: position,
      };
    }
  }

  const existingIndices = existingEntities.map(e => e.index).filter(i => i !== undefined);
  const nextIndex = existingIndices.length > 0 ? Math.max(...existingIndices) + 1 : 0;

  return {
    index: nextIndex,
    type: objectType,
    name: objectName,
    position,
    bounds: entityBounds,
    nodeId: objectId,
    id: objectId,
    applicationId,
    layer,
    speckle_type: objectType,
    raw: objectData?.raw,
  };
}