/**
 * Screen Projection Utilities
 * 
 * Utility functions for projecting 3D coordinates to screen space.
 * Extracted from ThreeScene.tsx to reduce code duplication.
 */

import * as THREE from "three";
import { SCREEN_PROJECTION } from "@/lib/constants";

/**
 * Project a 3D vector to 2D screen coordinates
 * 
 * @param vector - THREE.Vector3 in world space (will be modified)
 * @param camera - THREE.Camera to project from
 * @param rendererWidth - Width of the renderer in pixels
 * @param rendererHeight - Height of the renderer in pixels
 * @returns Object with x, y coordinates and isBehindCamera flag
 */
export function projectToScreen(
  vector: THREE.Vector3,
  camera: THREE.Camera,
  rendererWidth: number,
  rendererHeight: number
): { x: number; y: number; isBehindCamera: boolean } {
  // Project vector to normalized device coordinates (-1 to 1)
  vector.project(camera);

  // Check if behind camera
  const isBehindCamera = vector.z > SCREEN_PROJECTION.CAMERA_BEHIND_THRESHOLD;

  // Convert from NDC to screen coordinates
  const x = (vector.x * SCREEN_PROJECTION.SCALE + SCREEN_PROJECTION.OFFSET) * rendererWidth;
  const y = (-(vector.y * SCREEN_PROJECTION.SCALE) + SCREEN_PROJECTION.OFFSET) * rendererHeight;

  return { x, y, isBehindCamera };
}

/**
 * Check if screen coordinates are within viewport with margin
 * 
 * @param x - Screen x coordinate
 * @param y - Screen y coordinate
 * @param rendererWidth - Width of the renderer in pixels
 * @param rendererHeight - Height of the renderer in pixels
 * @param margin - Margin in pixels to extend the viewport bounds
 * @returns True if coordinates are within viewport (including margin)
 */
export function isInViewport(
  x: number,
  y: number,
  rendererWidth: number,
  rendererHeight: number,
  margin: number
): boolean {
  return (
    x >= -margin &&
    x <= rendererWidth + margin &&
    y >= -margin &&
    y <= rendererHeight + margin
  );
}

/**
 * Project a 3D position to screen coordinates and check visibility
 * 
 * Combines projection and viewport checking into a single function.
 * 
 * @param position - [x, y, z] array in world space
 * @param camera - THREE.Camera to project from
 * @param rendererWidth - Width of the renderer in pixels
 * @param rendererHeight - Height of the renderer in pixels
 * @param margin - Margin in pixels for viewport bounds
 * @returns Object with screen coordinates and visibility flags
 */
export function projectPositionToScreen(
  position: [number, number, number],
  camera: THREE.Camera,
  rendererWidth: number,
  rendererHeight: number,
  margin: number
): {
  x: number;
  y: number;
  isBehindCamera: boolean;
  isInViewport: boolean;
  isVisible: boolean;
} {
  const vector = new THREE.Vector3(position[0], position[1], position[2]);
  const { x, y, isBehindCamera } = projectToScreen(vector, camera, rendererWidth, rendererHeight);
  const inViewport = isInViewport(x, y, rendererWidth, rendererHeight, margin);
  const isVisible = !isBehindCamera && inViewport;

  return { x, y, isBehindCamera, isInViewport: inViewport, isVisible };
}
