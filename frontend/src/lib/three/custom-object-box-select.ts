/**
 * Screen-space helpers for box-select (left-drag rectangle) in the Speckle viewer.
 *
 * Shared by SpeckleEventBridge for both Speckle meshes (BatchObject AABBs) and
 * custom audio objects (sound spheres, surface markers, listeners).
 */

import * as THREE from 'three';

/** Projected screen-space bounds of a world-space box (client px). */
export interface ProjectedScreenRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** All 8 corners are in front of the camera. */
  allCornersVisible: boolean;
}

/** Client-px selection rectangle. */
export interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** A selectable custom object: `target` is what gets selected, `probe` what gets projected. */
export interface SelectableCustomObject {
  target: THREE.Object3D;
  probe: THREE.Object3D;
}

/**
 * Project a world-space box to client-px screen bounds. Corners behind the
 * camera are skipped. Returns null when no corner is in front of the camera.
 */
export function projectBoxToScreenRect(
  box: THREE.Box3,
  camera: THREE.Camera,
  canvasRect: DOMRect
): ProjectedScreenRect | null {
  const corner = new THREE.Vector3();
  const viewPos = new THREE.Vector3();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let anyVisible = false;
  let allCornersVisible = true;

  for (let i = 0; i < 8; i++) {
    corner.set(
      i & 1 ? box.max.x : box.min.x,
      i & 2 ? box.max.y : box.min.y,
      i & 4 ? box.max.z : box.min.z
    );

    viewPos.copy(corner).applyMatrix4(camera.matrixWorldInverse);
    if (viewPos.z > 0) {
      allCornersVisible = false;
      continue; // behind the camera — skip this corner
    }

    anyVisible = true;
    const ndc = corner.clone().project(camera);
    const sx = canvasRect.left + (ndc.x * 0.5 + 0.5) * canvasRect.width;
    const sy = canvasRect.top + (-ndc.y * 0.5 + 0.5) * canvasRect.height;
    if (sx < minX) minX = sx;
    if (sx > maxX) maxX = sx;
    if (sy < minY) minY = sy;
    if (sy > maxY) maxY = sy;
  }

  return anyVisible ? { minX, minY, maxX, maxY, allCornersVisible } : null;
}

/**
 * Test projected bounds against the selection rect.
 *  - strict:   the full projected box must fit inside (and be fully in front of the camera)
 *  - crossing: any overlap qualifies
 */
export function isProjectedRectSelected(
  projected: ProjectedScreenRect,
  rect: ScreenRect,
  strictContainment: boolean
): boolean {
  if (strictContainment) {
    if (!projected.allCornersVisible) return false;
    return (
      projected.minX >= rect.left && projected.maxX <= rect.right &&
      projected.minY >= rect.top && projected.maxY <= rect.bottom
    );
  }
  return !(
    projected.maxX < rect.left || projected.minX > rect.right ||
    projected.maxY < rect.top || projected.minY > rect.bottom
  );
}

/** The object the drag gizmo should attach to (large-object labels proxy an invisible marker group). */
export function resolveCustomDragTarget(object: THREE.Object3D): THREE.Object3D {
  return (object.userData?.markerTarget as THREE.Object3D | undefined) ?? object;
}

/**
 * Collect visible, selectable sound spheres / surface markers / listeners under
 * the given roots. Stops descending at the first typed node (a receiver's child
 * meshes are part of that receiver). Grid listener points (InstancedMesh) and
 * the receiver placement preview (no receiverId) are excluded.
 */
export function collectSelectableCustomObjects(roots: THREE.Object3D[]): SelectableCustomObject[] {
  const result: SelectableCustomObject[] = [];
  const seenTargets = new Set<THREE.Object3D>();

  const walk = (node: THREE.Object3D): void => {
    if (!node.visible) return;
    const type = node.userData?.customObjectType;
    if (type === 'sound' || type === 'receiver') {
      const isKeyed = type === 'sound' ? !!node.userData.promptKey : !!node.userData.receiverId;
      if (isKeyed) {
        const target = resolveCustomDragTarget(node);
        if (!seenTargets.has(target)) {
          seenTargets.add(target);
          result.push({ target, probe: node });
        }
      }
      return;
    }
    if (type === 'grid-receiver') return;
    for (const child of node.children) walk(child);
  };

  for (const root of roots) walk(root);
  return result;
}

/**
 * Projected screen bounds of a custom object. Objects without geometry (e.g.
 * an empty marker group) collapse to their world position.
 */
export function projectObjectToScreenRect(
  object: THREE.Object3D,
  camera: THREE.Camera,
  canvasRect: DOMRect
): ProjectedScreenRect | null {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) {
    const p = object.getWorldPosition(new THREE.Vector3());
    box.set(p, p.clone());
  }
  return projectBoxToScreenRect(box, camera, canvasRect);
}
