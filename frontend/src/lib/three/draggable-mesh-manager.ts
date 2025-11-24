import * as THREE from "three";
import { disposeMesh } from "@/lib/three/mesh-cleanup";

/**
 * DraggableMeshManager
 * 
 * Utility class for managing draggable mesh objects with efficient updates.
 * Provides common patterns for mesh lifecycle management that preserves object references.
 * 
 * This is a composition utility, not a base class. Managers use it to handle mesh updates
 * without recreating objects unnecessarily, which is critical for DragControls integration.
 * 
 * Key Benefits:
 * - Preserves mesh object references during position updates
 * - Efficient add/update/remove operations using Map-based tracking
 * - Works seamlessly with DragControls (no stale references)
 * - Reusable across different mesh types (receivers, markers, etc.)
 */

export interface MeshData {
  id: string;
  position: [number, number, number];
}

export type MeshFactory<T extends MeshData> = (data: T) => THREE.Mesh;

/**
 * Update meshes efficiently by reusing existing objects
 * 
 * @param scene - Three.js scene to add/remove meshes
 * @param currentMeshes - Current array of mesh objects
 * @param newData - New data array to sync meshes with
 * @param meshFactory - Factory function to create new meshes
 * @param getIdFromMesh - Function to extract ID from mesh userData
 * @returns Updated arrays of meshes and draggable objects
 */
export function updateDraggableMeshes<T extends MeshData>(
  scene: THREE.Scene | THREE.Group,
  currentMeshes: THREE.Mesh[],
  newData: T[],
  meshFactory: MeshFactory<T>,
  getIdFromMesh: (mesh: THREE.Mesh) => string
): { meshes: THREE.Mesh[]; draggableObjects: THREE.Object3D[] } {
  // Create a map of existing meshes by ID for O(1) lookup
  const existingMeshesMap = new Map<string, THREE.Mesh>();
  currentMeshes.forEach(mesh => {
    const id = getIdFromMesh(mesh);
    if (id) {
      existingMeshesMap.set(id, mesh);
    }
  });

  // Track updated meshes
  const updatedMeshes: THREE.Mesh[] = [];
  const updatedDraggableObjects: THREE.Object3D[] = [];

  // Update or create meshes
  newData.forEach(data => {
    const existingMesh = existingMeshesMap.get(data.id);

    if (existingMesh) {
      // Reuse existing mesh
      // IMPORTANT: Skip position update if mesh is currently being dragged
      // This prevents fighting between DragControls and state updates
      if (!existingMesh.userData.isDragging) {
        existingMesh.position.fromArray(data.position);
      }
      updatedMeshes.push(existingMesh);
      updatedDraggableObjects.push(existingMesh);
      existingMeshesMap.delete(data.id); // Mark as processed
    } else {
      // Create new mesh
      const newMesh = meshFactory(data);
      scene.add(newMesh);
      updatedMeshes.push(newMesh);
      updatedDraggableObjects.push(newMesh);
    }
  });

  // Remove meshes that no longer exist
  existingMeshesMap.forEach(mesh => {
    disposeMesh(mesh);
    scene.remove(mesh);
  });

  return {
    meshes: updatedMeshes,
    draggableObjects: updatedDraggableObjects
  };
}

/**
 * Batch dispose and remove meshes
 */
export function disposeMeshes(
  scene: THREE.Scene | THREE.Group,
  meshes: THREE.Mesh[]
): void {
  meshes.forEach(mesh => {
    disposeMesh(mesh);
    scene.remove(mesh);
  });
}

/**
 * Find mesh by ID in array
 */
export function findMeshById(
  meshes: THREE.Mesh[],
  id: string,
  getIdFromMesh: (mesh: THREE.Mesh) => string
): THREE.Mesh | null {
  return meshes.find(mesh => getIdFromMesh(mesh) === id) || null;
}

/**
 * Update position of a specific mesh by ID
 */
export function updateMeshPosition(
  meshes: THREE.Mesh[],
  id: string,
  position: [number, number, number],
  getIdFromMesh: (mesh: THREE.Mesh) => string
): boolean {
  const mesh = findMeshById(meshes, id, getIdFromMesh);
  if (mesh) {
    mesh.position.fromArray(position);
    return true;
  }
  return false;
}
