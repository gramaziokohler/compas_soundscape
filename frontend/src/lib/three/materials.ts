/**
 * Three.js Material Definitions
 *
 * Centralized material configurations for consistent 3D rendering.
 * Extracted from ThreeScene.tsx to reduce duplication and improve maintainability.
 */

import * as THREE from "three";
import { PRIMARY_COLOR_HEX } from "@/lib/constants";

/**
 * Color constants for the scene
 */
export const COLORS = {
  PRIMARY: PRIMARY_COLOR_HEX,
  RECEIVER: 0x0ea5e9, // Sky-500: #0ea5e9 (blue for receivers)
  SOUND_SPHERE: PRIMARY_COLOR_HEX,
  ENTITY_HIGHLIGHT: PRIMARY_COLOR_HEX,
  DIVERSE_ENTITY: PRIMARY_COLOR_HEX,
} as const;

/**
 * Material opacity levels
 */
export const OPACITY = {
  DIVERSE_ENTITY: 0.5,
  HIGHLIGHT_DIVERSE: 0.6,
  HIGHLIGHT_REGULAR: 0.35,
  RECEIVER_HOVER: 0.5,
  SOUND_SPHERE: 0.6,
} as const;

/**
 * Material configurations
 */
export const MATERIAL_CONFIG = {
  roughness: 0.3,
  metalness: 0.7,
  emissiveIntensity: 0.3,
} as const;

/**
 * Create material for diverse entity highlighting.
 *
 * Used to highlight entities selected for diverse sound generation.
 *
 * @returns MeshStandardMaterial with semi-transparent pink color
 */
export function createDiverseEntityMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: COLORS.DIVERSE_ENTITY,
    roughness: MATERIAL_CONFIG.roughness,
    metalness: 0.0,
    transparent: true,
    opacity: OPACITY.DIVERSE_ENTITY,
  });
}

/**
 * Create material for entity highlighting on hover/selection.
 *
 * @param isDiverse - Whether the entity is in the diverse selection
 * @returns MeshStandardMaterial with appropriate opacity
 */
export function createHighlightMaterial(isDiverse: boolean = false): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: COLORS.ENTITY_HIGHLIGHT,
    roughness: MATERIAL_CONFIG.roughness,
    metalness: 0.0,
    transparent: true,
    opacity: isDiverse ? OPACITY.HIGHLIGHT_DIVERSE : OPACITY.HIGHLIGHT_REGULAR,
  });
}

/**
 * Create material for sound sphere visualization.
 *
 * Used for the spheres that represent sound sources in the scene.
 *
 * @returns MeshStandardMaterial with emissive properties
 */
export function createSoundSphereMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: COLORS.SOUND_SPHERE,
    emissive: COLORS.SOUND_SPHERE,
    emissiveIntensity: MATERIAL_CONFIG.emissiveIntensity,
    roughness: MATERIAL_CONFIG.roughness,
    metalness: MATERIAL_CONFIG.metalness,
  });
}

/**
 * Create material for receiver visualization.
 *
 * Used for both the sphere and cube representations of receivers.
 *
 * @param transparent - Whether the material should be transparent
 * @param opacity - Opacity level (0-1), only used if transparent is true
 * @returns MeshStandardMaterial with blue emissive color
 */
export function createReceiverMaterial(
  transparent: boolean = false,
  opacity: number = 1.0
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: COLORS.RECEIVER,
    emissive: COLORS.RECEIVER,
    emissiveIntensity: MATERIAL_CONFIG.emissiveIntensity,
    roughness: MATERIAL_CONFIG.roughness,
    metalness: MATERIAL_CONFIG.metalness,
    transparent,
    opacity,
  });
}

/**
 * Dispose of a material properly.
 *
 * Handles both single materials and material arrays.
 *
 * @param material - Material or array of materials to dispose
 */
export function disposeMaterial(
  material: THREE.Material | THREE.Material[]
): void {
  if (Array.isArray(material)) {
    material.forEach(m => m.dispose());
  } else {
    material.dispose();
  }
}
