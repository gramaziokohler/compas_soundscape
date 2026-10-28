/**
 * Source orientation → world rotation (three.js twin of backend/utils/orientation.py).
 *
 * World frame: right-handed Z-up. Listener convention: yaw=0 faces -Y, +yaw turns
 * toward -X, +pitch tilts up (+Z), roll about the forward axis. The balloon /
 * indicator frame has +x front, +y left, +z up, so at rest the frame's +x maps to
 * world -Y. `rotationMatrix(y, p, r) * (1,0,0)` equals the camera forward vector
 * of speckle-camera-controller.ts for every yaw / pitch.
 */

import * as THREE from 'three';

/** Columns = world images of the source axes at rest: x→-Y, y→+X, z→+Z. */
const SOURCE_TO_WORLD_BASE = new THREE.Matrix4().set(
  0, 1, 0, 0,
  -1, 0, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
);

/** 4x4 rotation taking source-frame vectors to the world frame. */
export function rotationMatrix(yaw: number, pitch: number, roll: number): THREE.Matrix4 {
  const rz = new THREE.Matrix4().makeRotationZ(-yaw);
  const ry = new THREE.Matrix4().makeRotationY(-pitch);
  const rx = new THREE.Matrix4().makeRotationX(roll);
  return new THREE.Matrix4().copy(SOURCE_TO_WORLD_BASE).multiply(rz).multiply(ry).multiply(rx);
}

/** World unit vector the source points at. */
export function forwardVector(yaw: number, pitch: number): THREE.Vector3 {
  return new THREE.Vector3(1, 0, 0).applyMatrix4(rotationMatrix(yaw, pitch, 0)).normalize();
}

/** Quaternion of `rotationMatrix` (for objects modelled in the source frame). */
export function orientationQuaternion(yaw: number, pitch: number, roll: number): THREE.Quaternion {
  return new THREE.Quaternion().setFromRotationMatrix(rotationMatrix(yaw, pitch, roll));
}
