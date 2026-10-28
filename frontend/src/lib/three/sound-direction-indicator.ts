/**
 * Direction indicator of a directional sound sphere: a small cone parented to
 * the sphere mesh, pointing along the source's forward vector (yaw / pitch /
 * roll, see lib/three/orientation.ts). Parenting makes it follow the sphere's
 * drags and its per-frame screen-space scale for free; omnidirectional sounds
 * carry no indicator.
 *
 * Usage (sound-sphere-manager.ts):
 * ```ts
 * syncDirectionIndicator(sphereMesh, soundEvent, baseRadius, colorHex);
 * ```
 */

import * as THREE from 'three';
import { DIRECTIVITY } from '@/utils/constants';
import { isOmniDirectivity } from '@/utils/positionKey';
import { orientationQuaternion } from '@/lib/three/orientation';
import type { SoundEvent } from '@/types';

export const DIRECTION_INDICATOR_NAME = 'soundDirectionIndicator';

/** Unit cone (height 1, radius 1) whose axis is the local +x (the source front); shared, never disposed. */
let unitCone: THREE.ConeGeometry | null = null;
function coneGeometry(): THREE.ConeGeometry {
  if (!unitCone) {
    unitCone = new THREE.ConeGeometry(1, 1, DIRECTIVITY.INDICATOR.SEGMENTS);
    unitCone.rotateZ(-Math.PI / 2); // +Y axis -> +X
  }
  return unitCone;
}

function findIndicator(sphere: THREE.Object3D): THREE.Mesh | undefined {
  return sphere.children.find((c) => c.name === DIRECTION_INDICATOR_NAME) as THREE.Mesh | undefined;
}

/** Remove (and dispose the material of) the indicator of a sphere, if any. */
export function removeDirectionIndicator(sphere: THREE.Object3D): void {
  const cone = findIndicator(sphere);
  if (!cone) return;
  sphere.remove(cone);
  (cone.material as THREE.Material).dispose();
}

/**
 * Create / update / remove the indicator so it matches `soundEvent.directivity`.
 * `baseRadius` is the sphere's unscaled radius (local units); `colorHex` the sphere colour.
 */
export function syncDirectionIndicator(
  sphere: THREE.Mesh,
  soundEvent: SoundEvent,
  baseRadius: number,
  colorHex: number,
  opaque: boolean,
): void {
  const directivity = soundEvent.directivity;
  if (isOmniDirectivity(directivity) || !directivity) {
    removeDirectionIndicator(sphere);
    return;
  }
  let cone = findIndicator(sphere);
  if (!cone) {
    const material = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: !opaque,
      opacity: opaque ? 1 : DIRECTIVITY.INDICATOR_OPACITY,
      depthWrite: true,
      depthTest: true,
    });
    cone = new THREE.Mesh(coneGeometry(), material);
    cone.name = DIRECTION_INDICATOR_NAME;
    cone.layers.mask = sphere.layers.mask;
    cone.renderOrder = sphere.renderOrder;
    cone.userData.customObjectType = 'soundDirection';
    sphere.add(cone);
  } else {
    (cone.material as THREE.MeshBasicMaterial).color.setHex(colorHex);
  }
  const length = baseRadius * DIRECTIVITY.INDICATOR.LENGTH_MULT;
  const radius = baseRadius * DIRECTIVITY.INDICATOR.RADIUS_MULT;
  cone.scale.set(length, radius, radius);
  cone.quaternion.copy(orientationQuaternion(directivity.yaw ?? 0, directivity.pitch ?? 0, directivity.roll ?? 0));
  // Base of the cone on the sphere surface, tip pointing forward.
  cone.position.set(1, 0, 0).applyQuaternion(cone.quaternion).multiplyScalar(baseRadius + length / 2);
  cone.visible = sphere.visible;
}
