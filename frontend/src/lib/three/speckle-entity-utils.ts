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

  const objectName = objectData?.model?.name || objectData?.raw?.name || 'Unnamed Object';
  const objectType = objectData?.raw?.speckle_type || 'Speckle Object';

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
    applicationId: objectData?.raw?.applicationId || undefined,
    speckle_type: objectType,
    raw: objectData?.raw,
  };
}