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

/** Yaw / pitch / roll in radians (listener convention, see file header). */
export interface YawPitchRoll {
  yaw: number;
  pitch: number;
  roll: number;
}

const WORLD_TO_SOURCE_BASE = SOURCE_TO_WORLD_BASE.clone().invert();

/**
 * Inverse of `orientationQuaternion`. `B⁻¹·M = Rz(-yaw)·Ry(-pitch)·Rx(roll)`, which
 * is exactly THREE's 'ZYX' Euler order (matrix = Rz·Ry·Rx).
 */
export function orientationFromQuaternion(q: THREE.Quaternion): YawPitchRoll {
  const local = WORLD_TO_SOURCE_BASE.clone().multiply(new THREE.Matrix4().makeRotationFromQuaternion(q));
  const e = new THREE.Euler().setFromRotationMatrix(local, 'ZYX');
  return { yaw: -e.z || 0, pitch: -e.y || 0, roll: e.x || 0 };
}

/** Rotate an orientation by `angle` radians about a WORLD axis (right-hand rule). */
export function rotateOrientation(o: YawPitchRoll, worldAxis: THREE.Vector3, angle: number): YawPitchRoll {
  const start = orientationQuaternion(o.yaw, o.pitch, o.roll);
  const rot = new THREE.Quaternion().setFromAxisAngle(worldAxis.clone().normalize(), angle);
  return orientationFromQuaternion(rot.multiply(start));
}
