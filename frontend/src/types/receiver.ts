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
 * - hiddenForSimulation: When true, this receiver is excluded from acoustic simulations
 */
export interface ReceiverData {
  id: string;
  name: string;
  position: [number, number, number];
  mesh?: THREE.Mesh; // Populated by ThreeScene, not serializable
  hiddenForSimulation?: boolean;
}

/**
 * GridListenerData
 *
 * Represents a grid of listeners distributed evenly on selected surface(s).
 * Grid listeners are a special type that don't appear as individual Listener cards
 * but are detected by acoustic simulations.
 */
export interface GridListenerData {
  id: string;
  name: string;
  xSpacing: number;       // Spacing along X axis (m), default 2
  ySpacing: number;       // Spacing along Z axis (m), default 2
  zOffset: number;        // Vertical offset above mid-plane (m), default 1.5
  showListeners: boolean; // Whether to render listener dots when expanded
  hiddenForSimulation: boolean; // Whether to exclude from acoustic simulations
  selectedObjectIds: string[];  // Speckle object IDs used for bounding box
  boundingBox: { min: [number, number, number]; max: [number, number, number] } | null;
  points: [number, number, number][]; // Computed grid points
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
