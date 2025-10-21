/**
 * Receiver Types
 *
 * Type definitions for acoustic receiver spheres in the 3D scene.
 * Receivers represent listening positions that can be placed in the scene.
 */

import type * as THREE from 'three';

/**
 * ReceiverData
 *
 * Represents a receiver sphere in the scene.
 * - id: Unique identifier for the receiver
 * - name: User-defined name for the receiver
 * - position: [x, y, z] coordinates in 3D space
 * - mesh: Reference to the Three.js mesh object (populated at runtime)
 */
export interface ReceiverData {
  id: string;
  name: string;
  position: [number, number, number];
  mesh?: THREE.Mesh; // Populated by ThreeScene, not serializable
}

/**
 * ReceiverOverlay
 *
 * UI overlay data for displaying receiver information in 2D.
 * Used for projecting 3D receiver positions to screen space.
 */
export interface ReceiverOverlay {
  id: string;
  x: number;
  y: number;
  visible: boolean;
  receiver: ReceiverData;
}
