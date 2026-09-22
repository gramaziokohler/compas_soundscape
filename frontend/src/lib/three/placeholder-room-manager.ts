/**
 * PlaceholderRoomManager
 *
 * Overlay shoebox drawn into the Speckle viewer's Three.js scene when no
 * Speckle model is loaded. Speckle Z-up: width → X, depth → Y, height → Z,
 * floor at z = 0.
 *
 * Speckle's CameraController.updateFarCameraPlane() reads renderer.sceneBox,
 * which is empty without loadObject. That sets camera.far = Infinity and
 * Three r140 then writes NaN into projectionMatrix[10,14] — the canvas stays
 * transparent. Sandbox far-plane patching keeps a finite far from this AABB.
 */

import * as THREE from 'three';
import type { CameraController, Viewer } from '@speckle/viewer';
import {
  RESONANCE_AUDIO,
  SANDBOX_GRID_MIN_EXTENT,
  SANDBOX_GRID_EXTENT_FRACTION,
  SANDBOX_GRID_CAMERA_MARGIN,
} from '@/utils/constants';
import { getCssColorHex } from '@/utils/utils';
import type { BoundingBoxBounds } from '@/lib/three/BoundingBoxManager';

const SPECKLE_OVERLAY_LAYER = 4;

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
 * Bounds covering the whole Home ground grid. The camera default view and the
 * reset-zoom button frame this (not the tighter placeholder room AABB), so the
 * entire "SOUND IS BLUE" stage is visible.
 */
export function getSandboxStageBounds(): BoundingBoxBounds {
  const { width, height, depth } = RESONANCE_AUDIO.DEFAULT_ROOM_DIMENSIONS;
  const half =
    Math.max(width, depth, SANDBOX_GRID_MIN_EXTENT) *
    SANDBOX_GRID_EXTENT_FRACTION *
    SANDBOX_GRID_CAMERA_MARGIN;
  return {
    min: [-half, -half, 0],
    max: [half, half, height],
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

export function fitCameraToBounds(
  cameraController: CameraController | null | undefined,
  bounds: BoundingBoxBounds,
): boolean {
  if (!cameraController?.setCameraView) return false;
  const box = boundsToBox3(bounds);
  // Jump immediately — empty-scene damping otherwise settles on a clipped view.
  cameraController.setCameraView(box, false);
  const cc = cameraController as CameraPlanesController;
  cc.updateCameraPlanes?.(box);
  return true;
}

function enableOverlayLayers(obj: THREE.Object3D): void {
  obj.layers.enable(0);
  obj.layers.enable(SPECKLE_OVERLAY_LAYER);
  obj.traverse((child) => {
    child.layers.enable(0);
    child.layers.enable(SPECKLE_OVERLAY_LAYER);
  });
}

function makeFaceMaterial(hex: number, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: hex,
    transparent: opacity < 1,
    opacity,
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: opacity >= 1,
  });
}

export class PlaceholderRoomManager {
  private scene: THREE.Scene;
  private requestRender: () => void;
  private group: THREE.Group | null = null;

  constructor(scene: THREE.Scene, requestRender: () => void) {
    this.scene = scene;
    this.requestRender = requestRender;
  }

  public add(): BoundingBoxBounds {
    this.dispose();
    const bounds = getPlaceholderRoomBounds();
    const [minX, minY, minZ] = bounds.min;
    const [maxX, maxY, maxZ] = bounds.max;
    // Speckle AABB: X = width, Y = depth, Z = height (Z-up)
    const width = maxX - minX;
    const height = maxY - minY;
    const depth = maxZ - minZ;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const cz = (minZ + maxZ) / 2;

    const group = new THREE.Group();
    group.name = 'PlaceholderRoom';
    group.position.set(cx, cy, cz);
    group.visible = true;
    group.frustumCulled = false;
    group.layers.enableAll();

    const floorHex = getCssColorHex('--color-surface');
    const wallHex = getCssColorHex('--color-secondary-light');
    const edgeHex = getCssColorHex('--color-secondary-hover');

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      makeFaceMaterial(floorHex, 1),
    );
    floor.position.set(0, 0, -depth / 2);
    floor.rotation.set(0, Math.PI, 0);
    floor.renderOrder = 1;
    floor.frustumCulled = false;
    group.add(floor);

    const wallMat = makeFaceMaterial(wallHex, 0.55);
    const walls: Array<{ size: [number, number]; pos: THREE.Vector3; rot: [number, number, number] }> = [
      { size: [depth, height], pos: new THREE.Vector3(-width / 2, 0, 0), rot: [0, Math.PI / 2, 0] },
      { size: [depth, height], pos: new THREE.Vector3(width / 2, 0, 0), rot: [0, -Math.PI / 2, 0] },
      { size: [width, depth], pos: new THREE.Vector3(0, -height / 2, 0), rot: [Math.PI / 2, 0, 0] },
      { size: [width, depth], pos: new THREE.Vector3(0, height / 2, 0), rot: [-Math.PI / 2, 0, 0] },
    ];
    for (const wall of walls) {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(wall.size[0], wall.size[1]), wallMat);
      mesh.position.copy(wall.pos);
      mesh.rotation.set(...wall.rot);
      mesh.renderOrder = 2;
      mesh.frustumCulled = false;
      group.add(mesh);
    }

    const boxGeom = new THREE.BoxGeometry(width, height, depth);
    const edgesGeom = new THREE.EdgesGeometry(boxGeom);
    boxGeom.dispose();
    const edges = new THREE.LineSegments(
      edgesGeom,
      new THREE.LineBasicMaterial({ color: edgeHex, depthTest: false, depthWrite: false }),
    );
    edges.renderOrder = 3;
    edges.frustumCulled = false;
    group.add(edges);

    enableOverlayLayers(group);
    this.scene.add(group);
    this.group = group;
    this.requestRender();
    return bounds;
  }

  public dispose(): void {
    if (!this.group) return;
    try {
      this.scene.remove(this.group);
    } catch {
      /* scene may already be disposed during viewer teardown */
    }
    this.group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      mesh.geometry?.dispose();
      const mat = mesh.material;
      if (!mat) return;
      const mats = Array.isArray(mat) ? mat : [mat];
      mats.forEach((m) => m.dispose());
    });
    this.group = null;
    this.requestRender();
  }
}
