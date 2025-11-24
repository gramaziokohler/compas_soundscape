import * as THREE from "three";
import type { EntityData } from "@/types";

/**
 * Website pink color for highlighting
 */
export const HIGHLIGHT_COLOR = 0xF500B8;

/**
 * Arctic Mode base color for entities
 */
export const ENTITY_BASE_COLOR = 0xf0f4f8;

/**
 * Creates a box mesh for an entity based on its bounds
 */
export function createEntityMesh(
  entity: EntityData,
  isSelected: boolean,
  isDiverse: boolean
): THREE.Mesh {
  const min = entity.bounds.min;
  const max = entity.bounds.max;

  // Calculate size and center from bounds
  const width = max[0] - min[0];
  const height = max[1] - min[1];
  const depth = max[2] - min[2];
  const centerX = (min[0] + max[0]) / 2;
  const centerY = (min[1] + max[1]) / 2;
  const centerZ = (min[2] + max[2]) / 2;

  const boxGeometry = new THREE.BoxGeometry(width, height, depth);
  const boxMaterial = createEntityMaterial(isSelected, isDiverse);

  const entityMesh = new THREE.Mesh(boxGeometry, boxMaterial);
  entityMesh.position.set(centerX, centerY, centerZ);
  entityMesh.userData.entity = entity;
  entityMesh.userData.isEntityMesh = true;

  return entityMesh;
}

/**
 * Creates material for entity mesh with appropriate highlighting
 */
export function createEntityMaterial(
  isSelected: boolean,
  isDiverse: boolean
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: isSelected ? HIGHLIGHT_COLOR : (isDiverse ? HIGHLIGHT_COLOR : ENTITY_BASE_COLOR),
    roughness: 0.5,
    metalness: 0.0,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: isSelected ? 0.9 : (isDiverse ? 0.7 : 0.6),
    emissive: (isSelected || isDiverse) ? HIGHLIGHT_COLOR : 0x000000,
    emissiveIntensity: isSelected ? 0.3 : (isDiverse ? 0.2 : 0.0)
  });
}

/**
 * Clears all meshes from a group and disposes their resources
 */
export function clearMeshGroup(group: THREE.Group): void {
  while (group.children.length > 0) {
    const mesh = group.children[0];
    if (mesh instanceof THREE.Mesh) {
      mesh.geometry.dispose();
      if (mesh.material instanceof THREE.Material) {
        mesh.material.dispose();
      }
    }
    group.remove(mesh);
  }
}

/**
 * Finds the closest entity to a given point
 */
export function findClosestEntity(
  point: THREE.Vector3,
  entities: EntityData[],
  maxDistance: number = 5
): EntityData | null {
  let closestEntity: EntityData | null = null;
  let minDist = Infinity;

  entities.forEach(entity => {
    const entityPos = new THREE.Vector3(
      entity.position[0],
      entity.position[1],
      entity.position[2]
    );
    const dist = point.distanceTo(entityPos);
    if (dist < minDist) {
      minDist = dist;
      closestEntity = entity;
    }
  });

  return (closestEntity && minDist < maxDistance) ? closestEntity : null;
}
