/**
 * Gumball pivot: center of the bounding box of the selected element(s).
 *
 * An element's box covers its own meshes only: label sprites (screen-space
 * sized) and a directional sound's indicator cone are left out, so the pivot of
 * a single sound sphere stays its center while the cone turns around it.
 * Surface markers are invisible proxies and count as their position.
 *
 * Usage:
 * ```ts
 * const pivot = selectionPivot(selectedObjects); // gizmo anchor + rotation center
 * ```
 */

import * as THREE from 'three';
import { DIRECTION_INDICATOR_NAME } from './sound-direction-indicator';

const _tmpBox = new THREE.Box3();

/** World-space bounding box of one selectable element. */
export function elementBounds(object: THREE.Object3D): THREE.Box3 {
  const box = new THREE.Box3();
  object.updateWorldMatrix(true, true);

  if (!object.userData?.isSurfaceMarker) {
    const visit = (node: THREE.Object3D): void => {
      if ((node as THREE.Sprite).isSprite || node.name === DIRECTION_INDICATOR_NAME) return;
      const mesh = node as THREE.Mesh;
      if (mesh.isMesh && mesh.geometry) {
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        if (mesh.geometry.boundingBox) {
          box.union(_tmpBox.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld));
        }
      }
      node.children.forEach(visit);
    };
    visit(object);
  }

  if (box.isEmpty()) box.expandByPoint(object.getWorldPosition(new THREE.Vector3()));
  return box;
}

/** Center of the union of the elements' bounding boxes. */
export function selectionPivot(objects: THREE.Object3D[]): THREE.Vector3 {
  const union = new THREE.Box3();
  for (const object of objects) union.union(elementBounds(object));
  return union.isEmpty() ? new THREE.Vector3() : union.getCenter(new THREE.Vector3());
}
