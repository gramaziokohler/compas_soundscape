/**
 * Home stage (no Speckle model) helpers: stage / resonance bounds, camera
 * framing and a finite far plane. Speckle Z-up: width → X, depth → Y,
 * height → Z, floor at z = 0.
 *
 * Speckle's CameraController.updateFarCameraPlane() reads renderer.sceneBox,
 * which is empty without loadObject. That sets camera.far = Infinity and
 * Three r140 then writes NaN into projectionMatrix[10,14] — the canvas stays
 * transparent. Sandbox far-plane patching keeps a finite far from this AABB.
 */

import * as THREE from 'three';
import type { CameraController, Viewer } from '@speckle/viewer';
import { HOME_STAGE, RESONANCE_AUDIO } from '@/utils/constants';
import type { BoundingBoxBounds } from '@/lib/three/BoundingBoxManager';

type CameraPlanesController = CameraController & {
  updateFarCameraPlane: () => void;
  updateCameraPlanes: (box?: THREE.Box3, scale?: number) => void;
  controls?: {
    world?: {
      expandWorld: (box: THREE.Box3) => void;
      reduceWorld: (box: THREE.Box3) => void;
    };
  };
};

export function getPlaceholderRoomBounds(): BoundingBoxBounds {
  const { width, height, depth } = RESONANCE_AUDIO.DEFAULT_ROOM_DIMENSIONS;
  return {
    min: [-width / 2, -depth / 2, 0],
    max: [width / 2, depth / 2, height],
  };
}

/**
 * Resonance room bounds fitted around the Home stage sound spheres.
 *
 * The Home Speckle World only contains the expanded ground-grid stage box
 * (installed by `installSandboxCameraFarPlane` for the far plane), so it must
 * not be used to size the resonance room — doing so produces a stage-sized room
 * that never tracks the sounds. Instead the room is fitted to the sphere AABB
 * plus a logical buffer (`AUTO_BBOX_THRESHOLD` on each side), with its floor
 * pinned to the Home ground plane and minimum interior dimensions enforced
 * (`AUTO_BBOX_MIN_SIZE`). With no sound sources it falls back to the fixed
 * centred placeholder room.
 */
export function getSandboxResonanceBounds(soundPositions: THREE.Vector3[]): BoundingBoxBounds {
  const fallback = getPlaceholderRoomBounds();
  if (soundPositions.length === 0) return fallback;

  const buffer = RESONANCE_AUDIO.BOUNDING_BOX.AUTO_BBOX_THRESHOLD;
  const minSize = RESONANCE_AUDIO.BOUNDING_BOX.AUTO_BBOX_MIN_SIZE;

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const p of soundPositions) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    minZ = Math.min(minZ, p.z);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
    maxZ = Math.max(maxZ, p.z);
  }

  // Logical buffer around the sound spheres.
  minX -= buffer;
  minY -= buffer;
  maxX += buffer;
  maxY += buffer;

  // Pin the floor to the Home ground plane (or lower if a sphere sits below it)
  // so the room never clips the spheres, then add ceiling clearance above the
  // highest sphere.
  const floorZ = Math.min(fallback.min[2], minZ);
  const ceilingZ = Math.max(maxZ + buffer, floorZ + minSize);

  // Keep the footprint centred on the sphere AABB and enforce a minimum size.
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const halfW = Math.max((maxX - minX) / 2, minSize / 2);
  const halfD = Math.max((maxY - minY) / 2, minSize / 2);

  return {
    min: [centerX - halfW, centerY - halfD, floorZ],
    max: [centerX + halfW, centerY + halfD, ceilingZ],
  };
}

/**
 * Bounds covering the Home ground grid (HOME_STAGE.GRID_SIZE_M, centred on the
 * origin) plus a framing margin. The default camera view and the reset-zoom
 * button frame this, so the whole grid is visible.
 */
export function getSandboxStageBounds(): BoundingBoxBounds {
  const { height } = RESONANCE_AUDIO.DEFAULT_ROOM_DIMENSIONS;
  const half = (HOME_STAGE.GRID_SIZE_M / 2) * HOME_STAGE.CAMERA_MARGIN;
  return {
    min: [-half, -half, 0],
    max: [half, half, height],
  };
}

/**
 * Flat (zero-height) bounds on the Home ground plane, same footprint as
 * `getSandboxStageBounds`. Framing the camera on this box makes its target the
 * grid centre, so the grid sits at the middle of the page. The taller stage box
 * would target 1.5 m above the floor and push the grid below the page centre.
 */
export function getSandboxFramingBounds(): BoundingBoxBounds {
  const half = (HOME_STAGE.GRID_SIZE_M / 2) * HOME_STAGE.CAMERA_MARGIN;
  return {
    min: [-half, -half, 0],
    max: [half, half, 0],
  };
}

function boundsToBox3(bounds: BoundingBoxBounds): THREE.Box3 {
  return new THREE.Box3(
    new THREE.Vector3(bounds.min[0], bounds.min[1], bounds.min[2]),
    new THREE.Vector3(bounds.max[0], bounds.max[1], bounds.max[2]),
  );
}

/** Same corner-distance rule as Speckle's updateFarCameraPlane, with a finite floor. */
function applyFarFromBox(camera: THREE.PerspectiveCamera, box: THREE.Box3): void {
  const pos = camera.position;
  const corner = new THREE.Vector3();
  let radius = 0;
  const { min, max } = box;
  for (const x of [min.x, max.x]) {
    for (const y of [min.y, max.y]) {
      for (const z of [min.z, max.z]) {
        radius = Math.max(radius, pos.distanceTo(corner.set(x, y, z)));
      }
    }
  }
  camera.far = Math.max(2 * radius, camera.near + 1, 10);
  camera.updateProjectionMatrix();
}

/**
 * Publish the placeholder AABB into Speckle's orbit World (so max radius is
 * not clamped to 10) and keep a finite far plane while renderer.sceneBox is
 * empty. Restores both on dispose.
 */
export function installSandboxCameraFarPlane(
  viewer: Viewer,
  cameraController: CameraController | null | undefined,
  bounds: BoundingBoxBounds,
): () => void {
  if (!cameraController) return () => {};
  const cc = cameraController as CameraPlanesController;
  const box = boundsToBox3(bounds);
  const world = cc.controls?.world;
  world?.expandWorld(box);

  const originalFar =
    typeof cc.updateFarCameraPlane === 'function'
      ? cc.updateFarCameraPlane.bind(cc)
      : null;

  if (originalFar) {
    cc.updateFarCameraPlane = () => {
      const sceneBox = viewer.getRenderer()?.sceneBox;
      if (sceneBox && !sceneBox.isEmpty()) {
        originalFar();
        return;
      }
      const cam = viewer.getRenderer()?.renderingCamera as THREE.PerspectiveCamera | undefined;
      if (!cam?.isPerspectiveCamera) return;
      applyFarFromBox(cam, box);
    };
  }

  cc.updateCameraPlanes?.(box);
  const cam = viewer.getRenderer()?.renderingCamera as THREE.PerspectiveCamera | undefined;
  if (cam?.isPerspectiveCamera) applyFarFromBox(cam, box);

  return () => {
    if (originalFar) cc.updateFarCameraPlane = originalFar;
    world?.reduceWorld(box);
  };
}

/**
 * Frame `bounds`; near/far planes are computed from `planesBounds` (defaults to
 * `bounds`) so a flat framing box doesn't degrade the clip planes.
 */
export function fitCameraToBounds(
  cameraController: CameraController | null | undefined,
  bounds: BoundingBoxBounds,
  planesBounds: BoundingBoxBounds = bounds,
): boolean {
  if (!cameraController?.setCameraView) return false;
  // Jump immediately — empty-scene damping otherwise settles on a clipped view.
  cameraController.setCameraView(boundsToBox3(bounds), false);
  const cc = cameraController as CameraPlanesController;
  cc.updateCameraPlanes?.(boundsToBox3(planesBounds));
  return true;
}

/** Minimal structural view of Speckle's SmoothOrbitControls (not exported by the package). */
interface OrbitAdjustable {
  adjustOrbit: (deltaTheta: number, deltaPhi: number, deltaZoom: number) => void;
}

/**
 * Rotate the camera around its orbit target by `deltaAzimuth` radians (about the
 * world up axis). Returns false if the active controls can't be orbited.
 */
export function rotateCameraAzimuth(
  cameraController: CameraController | null | undefined,
  deltaAzimuth: number,
): boolean {
  const controls = cameraController?.controls as Partial<OrbitAdjustable> | undefined;
  if (typeof controls?.adjustOrbit !== 'function') return false;
  controls.adjustOrbit(deltaAzimuth, 0, 0);
  return true;
}
