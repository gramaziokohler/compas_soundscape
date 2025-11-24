/**
 * Mode Visualizer Service
 *
 * Visualizes modal analysis resonance modes on 3D meshes using vertex colors.
 * Shows displacement patterns for each vibration mode.
 */

import * as THREE from 'three';
import type { ModeShapeVisualization } from '@/types/modal';
import { UI_COLORS, ARCTIC_THEME } from '@/lib/constants';

export interface ModeVisualizationOptions {
  nodalThreshold?: number;  // Threshold for nodal lines (default: 0.1)
}

/**
 * Service for visualizing modal analysis results on Three.js meshes
 */
export class ModeVisualizer {
  private originalColors: Float32Array | null = null;
  private originalGeometry: THREE.BufferGeometry | null = null;
  private originalMaterialColor: THREE.Color | null = null;
  private currentMeshId: number | null = null;  // Track which mesh we're visualizing

  /**
   * Apply mode visualization to a mesh
   *
   * @param mesh - Three.js mesh to visualize on
   * @param modeData - Mode shape visualization data
   * @param options - Visualization options
   */
  applyModeVisualization(
    mesh: THREE.Mesh,
    modeData: ModeShapeVisualization,
    options: ModeVisualizationOptions = {}
  ): void {
    const geometry = mesh.geometry as THREE.BufferGeometry;
    const meshId = mesh.id;

    // Reset state if we're visualizing a different mesh
    if (this.currentMeshId !== null && this.currentMeshId !== meshId) {
      this.reset();
    }

    // Store original colors and material color if first time or after reset
    if (!this.originalColors) {
      this.storeOriginalColors(geometry);
      this.originalGeometry = geometry;
      this.currentMeshId = meshId;

      const material = mesh.material as THREE.MeshStandardMaterial;
      this.originalMaterialColor = material.color.clone();
    }

    // Get displacement magnitudes
    const { displacement_magnitudes } = modeData;
    
    // Get actual vertex count from geometry
    const positionAttr = geometry.getAttribute('position');
    const vertexCount = positionAttr.count;
    
    // Handle vertex count mismatch (geometry may have duplicated vertices from computeVertexNormals)
    let vertexDisplacements: number[];
    
    if (vertexCount === displacement_magnitudes.length) {
      vertexDisplacements = displacement_magnitudes;
    } else if (vertexCount > displacement_magnitudes.length) {
      // Map mode data to all vertices using modulo
      vertexDisplacements = new Array(vertexCount);
      for (let i = 0; i < vertexCount; i++) {
        vertexDisplacements[i] = displacement_magnitudes[i % displacement_magnitudes.length];
      }
    } else {
      vertexDisplacements = displacement_magnitudes.slice(0, vertexCount);
    }

    // Create color gradient: Grey (low displacement) → Primary Pink (high displacement)
    const lowColor = new THREE.Color(ARCTIC_THEME.GEOMETRY_COLOR);  // Grey for nodal lines
    const highColor = new THREE.Color(UI_COLORS.PRIMARY_HEX);  // Pink for vibrating regions

    // Create vertex colors with smooth gradient
    const colors = new Float32Array(vertexDisplacements.length * 3);

    for (let i = 0; i < vertexDisplacements.length; i++) {
      const magnitude = vertexDisplacements[i];
      const color = lowColor.clone().lerp(highColor, magnitude);

      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }

    // Apply colors to geometry
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    // Ensure material uses vertex colors
    const material = mesh.material as THREE.MeshStandardMaterial;
    material.vertexColors = true;

    // Set base color to white so vertex colors show properly
    material.color.setHex(0xFFFFFF);
    material.needsUpdate = true;
  }

  /**
   * Clear mode visualization and restore original colors
   */
  clearVisualization(mesh: THREE.Mesh): void {
    const geometry = mesh.geometry as THREE.BufferGeometry;
    const meshId = mesh.id;

    // Only restore colors if this is the same mesh we visualized
    if (this.currentMeshId === meshId) {
      if (this.originalColors) {
        geometry.setAttribute(
          'color',
          new THREE.BufferAttribute(this.originalColors, 3)
        );
      } else {
        geometry.deleteAttribute('color');
      }

      // Restore material settings
      const material = mesh.material as THREE.MeshStandardMaterial;
      material.vertexColors = false;

      if (this.originalMaterialColor) {
        material.color.copy(this.originalMaterialColor);
      }

      material.needsUpdate = true;
    }

    // Reset state after clearing
    this.reset();
  }

  /**
   * Store original vertex colors from geometry
   */
  private storeOriginalColors(geometry: THREE.BufferGeometry): void {
    const colorAttr = geometry.getAttribute('color');
    if (colorAttr) {
      this.originalColors = new Float32Array(colorAttr.array);
    } else {
      this.originalColors = null;
    }
  }

  /**
   * Reset internal state
   */
  reset(): void {
    this.originalColors = null;
    this.originalGeometry = null;
    this.originalMaterialColor = null;
    this.currentMeshId = null;
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.reset();
  }
}
