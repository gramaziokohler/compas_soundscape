import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

/**
 * Arctic Mode scene configuration
 * Mimics the Rhino 3D Arctic Mode visual style
 */
export function createArcticModeScene(): THREE.Scene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xe8edf2); // Arctic Mode background
  return scene;
}

/**
 * Creates Arctic Mode lighting setup
 * Provides bright, even illumination similar to Rhino 3D Arctic Mode
 */
export function setupArcticModeLighting(scene: THREE.Scene): void {
  // Bright ambient light for even illumination
  const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
  scene.add(ambientLight);

  // Primary directional light
  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.6);
  directionalLight.position.set(10, 10, 10);
  scene.add(directionalLight);

  // Secondary directional light for fill
  const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.4);
  directionalLight2.position.set(-10, 10, -10);
  scene.add(directionalLight2);
}

/**
 * Creates the Arctic Mode grid helper
 */
export function createArcticModeGrid(): THREE.GridHelper {
  return new THREE.GridHelper(20, 20, 0xb0b8c0, 0xd0d8e0);
}

/**
 * Creates Arctic Mode material for geometry
 */
export function createArcticModeMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0xf0f4f8, // Arctic Mode geometry color
    roughness: 0.5,
    metalness: 0.0,
    side: THREE.DoubleSide
  });
}

/**
 * Sets up orbit controls with default settings
 */
export function setupOrbitControls(
  camera: THREE.Camera,
  domElement: HTMLElement
): OrbitControls {
  const controls = new OrbitControls(camera, domElement);
  controls.enableDamping = true;
  controls.target.set(0, 0, 0);
  controls.update();
  return controls;
}

/**
 * Positions camera to frame the given object
 */
export function frameCameraToObject(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  object: THREE.Object3D,
  multiplier: number = 0.95
): void {
  const box = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  const maxDim = Math.max(size.x, size.y, size.z);
  const fov = camera.fov * (Math.PI / 180);
  let cameraDistance = Math.abs(maxDim / (2 * Math.tan(fov / 2)));
  cameraDistance *= multiplier;

  const angle = Math.PI / 4;
  camera.position.set(
    center.x + cameraDistance * Math.cos(angle),
    center.y + cameraDistance * Math.sin(angle),
    center.z + cameraDistance * 0.7
  );
  controls.target.copy(center);
  controls.update();
}
