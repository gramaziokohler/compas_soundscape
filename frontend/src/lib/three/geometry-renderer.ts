import * as THREE from "three";
import { triangulate } from "@/lib/utils";
import { PRIMARY_COLOR_HEX } from "@/lib/constants";
import { createArcticModeMaterial } from "@/lib/three/sceneSetup";
import { disposeMesh } from "@/lib/three/mesh-cleanup";
import type { CompasGeometry, EntityData } from "@/types";

/**
 * GeometryRenderer
 * 
 * Manages entity rendering, highlighting, mesh creation/updates, and geometry visualization.
 * 
 * Responsibilities:
 * - Main geometry mesh rendering
 * - Diverse entity highlighting
 * - Individual entity selection highlighting
 * - Mesh visibility management
 * - Resource cleanup
 */
export class GeometryRenderer {
  private scene: THREE.Scene;
  private contentGroup: THREE.Group;
  private diverseHighlightsGroup: THREE.Group;

  // Mesh references
  private highlightMesh: THREE.Mesh | null = null;
  private remainingMesh: THREE.Mesh | null = null;

  // Triangle to face mapping for click detection
  private triangleToFaceMap: number[] | null = null;

  // Face highlight for precise acoustics mode
  private faceHighlightMesh: THREE.Mesh | null = null;

  constructor(
    scene: THREE.Scene,
    contentGroup: THREE.Group,
    diverseHighlightsGroup: THREE.Group
  ) {
    this.scene = scene;
    this.contentGroup = contentGroup;
    this.diverseHighlightsGroup = diverseHighlightsGroup;
  }

  /**
   * Update main geometry mesh
   */
  public updateGeometryMesh(
    positions: Float32Array | null,
    indices: Uint32Array | null,
    triangleToFaceMap: number[] | null = null
  ): void {
    // Remove existing geometry mesh
    const existingMesh = this.contentGroup.children.find(child =>
      child instanceof THREE.Mesh && child.userData.isGeometry === true
    );
    
    if (existingMesh) {
      disposeMesh(existingMesh as THREE.Mesh);
      this.contentGroup.remove(existingMesh);
    }

    // Create new geometry mesh if data is provided
    if (positions && indices) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geometry.setIndex(Array.from(indices));
      geometry.computeVertexNormals();

      const mesh = new THREE.Mesh(geometry, createArcticModeMaterial());
      mesh.userData.isGeometry = true;
      this.contentGroup.add(mesh);

      // Store the triangle-to-face mapping
      this.triangleToFaceMap = triangleToFaceMap;
    } else {
      this.triangleToFaceMap = null;
    }
  }

  /**
   * Get the triangle-to-face mapping
   */
  public getTriangleToFaceMap(): number[] | null {
    return this.triangleToFaceMap;
  }

  /**
   * Update diverse entity highlighting
   * Shows naked/boundary edges in primary color on top of the normal grey mesh
   * Can also show solid highlights for entities with linked sounds
   * @param entitiesWithLinkedSounds - Set of entity indices that have linked sounds (will be solid highlighted)
   * @param selectedSoundEntityIndices - Set of entity indices whose sound cards are selected (will be highlighted in secondary color)
   */
  public updateDiverseHighlights(
    geometryData: CompasGeometry | null,
    selectedDiverseEntities: EntityData[],
    entitiesWithLinkedSounds: Set<number> = new Set(),
    selectedSoundEntityIndices: Set<number> = new Set()
  ): void {
    // Clear existing diverse highlights (line segments and meshes)
    while (this.diverseHighlightsGroup.children.length > 0) {
      const object = this.diverseHighlightsGroup.children[0];
      if (object instanceof THREE.Mesh) {
        disposeMesh(object);
      } else if (object instanceof THREE.LineSegments) {
        // Dispose LineSegments geometry and material
        object.geometry.dispose();
        if (object.material instanceof THREE.Material) {
          object.material.dispose();
        }
      }
      this.diverseHighlightsGroup.remove(object);
    }

    // Find the main geometry mesh - always keep it visible
    const mainGeometryMesh = this.contentGroup.children.find(child =>
      child instanceof THREE.Mesh && child.userData.isGeometry === true
    ) as THREE.Mesh | undefined;

    // Always show main grey mesh
    if (mainGeometryMesh) {
      mainGeometryMesh.visible = true;
    }

    // Create highlights for diverse entities
    if (
      selectedDiverseEntities.length > 0 &&
      geometryData?.face_entity_map &&
      geometryData.vertices &&
      geometryData.faces
    ) {
      const diverseEntityIndices = new Set(selectedDiverseEntities.map(e => e.index));

      // Separate entities into two groups:
      // 1. Entities with linked sounds (solid highlight)
      // 2. Entities without linked sounds (wireframe edges)
      const solidHighlightFaces: number[][] = [];
      const wireframeHighlightFaces: number[][] = [];

      // Collect faces for each group
      geometryData.face_entity_map.forEach((entityIndex, faceIndex) => {
        if (diverseEntityIndices.has(entityIndex)) {
          if (entitiesWithLinkedSounds.has(entityIndex)) {
            solidHighlightFaces.push(geometryData.faces[faceIndex]);
          } else {
            wireframeHighlightFaces.push(geometryData.faces[faceIndex]);
          }
        }
      });

      // Create solid mesh highlights for entities with linked sounds
      // Separate by color: selected sound entities get SECONDARY color, others get PRIMARY
      if (solidHighlightFaces.length > 0) {
        // Group faces by whether their entity's sound is selected
        const selectedSoundFaces: number[][] = [];
        const unselectedSoundFaces: number[][] = [];

        geometryData.face_entity_map.forEach((entityIndex, faceIndex) => {
          if (diverseEntityIndices.has(entityIndex) && entitiesWithLinkedSounds.has(entityIndex)) {
            if (selectedSoundEntityIndices.has(entityIndex)) {
              selectedSoundFaces.push(geometryData.faces[faceIndex]);
            } else {
              unselectedSoundFaces.push(geometryData.faces[faceIndex]);
            }
          }
        });

        // Create mesh for selected sound entities (SECONDARY color)
        if (selectedSoundFaces.length > 0) {
          const secondaryColorHex = 0xff6b9d; // Parse SECONDARY color to hex
          const selectedIndices = triangulate(selectedSoundFaces);
          const selectedGeom = new THREE.BufferGeometry();
          const positions = new Float32Array(geometryData.vertices.flat());
          selectedGeom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
          selectedGeom.setIndex(selectedIndices);
          selectedGeom.computeVertexNormals();

          const selectedMaterial = new THREE.MeshStandardMaterial({
            color: secondaryColorHex,
            roughness: 0.3,
            metalness: 0.0,
            transparent: true,
            opacity: 0.6,
            emissive: secondaryColorHex,
            emissiveIntensity: 0.5,
            side: THREE.DoubleSide,
            depthTest: true,
            depthWrite: false
          });

          const selectedMesh = new THREE.Mesh(selectedGeom, selectedMaterial);
          selectedMesh.renderOrder = 1000;
          this.diverseHighlightsGroup.add(selectedMesh);
        }

        // Create mesh for unselected sound entities (PRIMARY color)
        if (unselectedSoundFaces.length > 0) {
          const unselectedIndices = triangulate(unselectedSoundFaces);
          const unselectedGeom = new THREE.BufferGeometry();
          const positions = new Float32Array(geometryData.vertices.flat());
          unselectedGeom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
          unselectedGeom.setIndex(unselectedIndices);
          unselectedGeom.computeVertexNormals();

          const unselectedMaterial = new THREE.MeshStandardMaterial({
            color: PRIMARY_COLOR_HEX,
            roughness: 0.3,
            metalness: 0.0,
            transparent: true,
            opacity: 0.6,
            emissive: PRIMARY_COLOR_HEX,
            emissiveIntensity: 0.5,
            side: THREE.DoubleSide,
            depthTest: true,
            depthWrite: false
          });

          const unselectedMesh = new THREE.Mesh(unselectedGeom, unselectedMaterial);
          unselectedMesh.renderOrder = 1000;
          this.diverseHighlightsGroup.add(unselectedMesh);
        }
      }

      // Create wireframe edges for entities without linked sounds (existing behavior)
      if (wireframeHighlightFaces.length > 0) {
        const wireframeIndices = triangulate(wireframeHighlightFaces);
        const wireframeGeom = new THREE.BufferGeometry();
        const positions = new Float32Array(geometryData.vertices.flat());
        wireframeGeom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        wireframeGeom.setIndex(wireframeIndices);
        wireframeGeom.computeVertexNormals();

        // Create edges geometry for boundary/naked edges only
        // Use angle threshold of 1 degree to capture only sharp/boundary edges (naked edges)
        const edgesGeometry = new THREE.EdgesGeometry(wireframeGeom, 1);
        const edgesMaterial = new THREE.LineBasicMaterial({
          color: PRIMARY_COLOR_HEX,
          linewidth: 3, // Slightly thicker for visibility
          transparent: false,
          depthTest: true,
          depthWrite: false // Don't write to depth buffer so edges appear on top
        });

        const edgesMesh = new THREE.LineSegments(edgesGeometry, edgesMaterial);
        edgesMesh.renderOrder = 999; // Render on top of geometry
        this.diverseHighlightsGroup.add(edgesMesh);

        // Dispose temporary geometry
        wireframeGeom.dispose();
      }
    }
  }

  /**
   * Update individual entity selection highlighting
   * @param entitiesWithLinkedSounds - Set of entity indices that have linked sounds (will skip highlighting to avoid conflicts)
   */
  public updateEntitySelection(
    geometryData: CompasGeometry | null,
    selectedEntity: EntityData | null,
    selectedDiverseEntities: EntityData[],
    entitiesWithLinkedSounds: Set<number> = new Set()
  ): void {
    // Remove existing highlight and remaining meshes
    if (this.highlightMesh) {
      this.scene.remove(this.highlightMesh);
      disposeMesh(this.highlightMesh);
      this.highlightMesh = null;
    }

    if (this.remainingMesh) {
      this.scene.remove(this.remainingMesh);
      disposeMesh(this.remainingMesh);
      this.remainingMesh = null;
    }

    // Find the main geometry mesh
    const mainGeometryMesh = this.contentGroup.children.find(child =>
      child instanceof THREE.Mesh && child.userData.isGeometry === true
    ) as THREE.Mesh | undefined;

    // Create new highlight if entity is selected AND entity doesn't have a linked sound
    // (Skip highlighting for sound-linked entities to avoid conflicts with sound card selection coloring)
    const hasLinkedSound = selectedEntity && entitiesWithLinkedSounds.has(selectedEntity.index);

    if (
      selectedEntity &&
      !hasLinkedSound &&
      geometryData?.face_entity_map &&
      geometryData.vertices &&
      geometryData.faces
    ) {
      // Hide the main gray mesh and diverse highlights
      if (mainGeometryMesh) {
        mainGeometryMesh.visible = false;
      }
      if (this.diverseHighlightsGroup) {
        this.diverseHighlightsGroup.visible = false;
      }

      // Check if this is a diverse entity (brighter pink)
      const isDiverse = selectedDiverseEntities.some(
        de => de.index === selectedEntity.index
      );

      // Separate faces into selected entity and others
      const selectedEntityFaces: number[][] = [];
      const otherFaces: number[][] = [];

      geometryData.face_entity_map.forEach((entityIndex, faceIndex) => {
        if (entityIndex === selectedEntity.index) {
          selectedEntityFaces.push(geometryData.faces[faceIndex]);
        } else {
          otherFaces.push(geometryData.faces[faceIndex]);
        }
      });

      // Create pink highlight mesh for selected entity
      if (selectedEntityFaces.length > 0) {
        const entityIndices = triangulate(selectedEntityFaces);
        const highlightGeom = new THREE.BufferGeometry();
        const positions = new Float32Array(geometryData.vertices.flat());
        highlightGeom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        highlightGeom.setIndex(entityIndices);
        highlightGeom.computeVertexNormals();

        const highlightMaterial = new THREE.MeshStandardMaterial({
          color: PRIMARY_COLOR_HEX,
          roughness: 0.3,
          metalness: 0.0,
          transparent: true,
          opacity: isDiverse ? 0.6 : 0.35,
          emissive: PRIMARY_COLOR_HEX,
          emissiveIntensity: isDiverse ? 0.5 : 0.25,
          side: THREE.DoubleSide,
          depthTest: true,
          depthWrite: false
        });

        const highlightMesh = new THREE.Mesh(highlightGeom, highlightMaterial);
        highlightMesh.renderOrder = 1000;
        this.scene.add(highlightMesh);
        this.highlightMesh = highlightMesh;
      }

      // Create gray mesh for remaining entities
      if (otherFaces.length > 0) {
        const remainingIndices = triangulate(otherFaces);
        const remainingGeom = new THREE.BufferGeometry();
        const positions = new Float32Array(geometryData.vertices.flat());
        remainingGeom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        remainingGeom.setIndex(remainingIndices);
        remainingGeom.computeVertexNormals();

        const remainingMaterial = createArcticModeMaterial();
        const remainingMesh = new THREE.Mesh(remainingGeom, remainingMaterial);
        this.scene.add(remainingMesh);
        this.remainingMesh = remainingMesh;
      }
    } else {
      // Show appropriate meshes when nothing is selected
      // ALWAYS show main grey mesh (contains all entities)
      if (mainGeometryMesh) {
        mainGeometryMesh.visible = true;
      }

      // Show diverse highlights (edge overlays) if they exist
      if (this.diverseHighlightsGroup && this.diverseHighlightsGroup.children.length > 0) {
        this.diverseHighlightsGroup.visible = true;
      } else {
        if (this.diverseHighlightsGroup) {
          this.diverseHighlightsGroup.visible = false;
        }
      }
    }
  }

  /**
   * Get the main geometry mesh
   */
  public getMainGeometryMesh(): THREE.Mesh | undefined {
    return this.contentGroup.children.find(child =>
      child instanceof THREE.Mesh && child.userData.isGeometry === true
    ) as THREE.Mesh | undefined;
  }

  /**
   * Get the highlight mesh for the currently selected entity
   * Used for mode visualization in Impact Mode
   */
  public getHighlightMesh(): THREE.Mesh | null {
    return this.highlightMesh;
  }

  /**
   * Highlight a single face (for precise acoustics mode)
   * @param faceIndex - Index of the face to highlight (-1 to clear)
   * @param geometryData - Geometry data containing vertices and faces
   */
  public highlightFace(faceIndex: number, geometryData: CompasGeometry | null): void {
    // Clear existing face highlight
    if (this.faceHighlightMesh) {
      disposeMesh(this.faceHighlightMesh);
      this.scene.remove(this.faceHighlightMesh);
      this.faceHighlightMesh = null;
    }

    // If faceIndex is -1 or no geometry data, just clear and return
    if (faceIndex === -1 || !geometryData || !geometryData.faces || !geometryData.vertices) {
      return;
    }

    // Get the face vertices
    const face = geometryData.faces[faceIndex];
    if (!face || face.length < 3) {
      console.warn('[GeometryRenderer] Invalid face index or face data:', faceIndex);
      return;
    }

    // Triangulate the face (it might be a polygon with more than 3 vertices)
    const faceIndices = triangulate([face]);
    
    // Create geometry for the face
    const faceGeom = new THREE.BufferGeometry();
    const positions = new Float32Array(geometryData.vertices.flat());
    faceGeom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    faceGeom.setIndex(faceIndices);
    faceGeom.computeVertexNormals();

    // Create material for face highlight (secondary color - sky blue)
    const highlightMaterial = new THREE.MeshStandardMaterial({
      color: 0x0ea5e9, // UI_COLORS.SECONDARY
      roughness: 0.3,
      metalness: 0.0,
      transparent: true,
      opacity: 0.7,
      emissive: 0x0ea5e9,
      emissiveIntensity: 0.6,
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: false
    });

    // Create mesh
    this.faceHighlightMesh = new THREE.Mesh(faceGeom, highlightMaterial);
    this.faceHighlightMesh.renderOrder = 1001; // Render on top of everything
    this.scene.add(this.faceHighlightMesh);

    console.log('[GeometryRenderer] Face highlighted:', faceIndex);
  }

  /**
   * Highlight multiple faces (for entity/layer selection in precise acoustics mode)
   * @param faceIndices - Array of face indices to highlight
   * @param geometryData - Geometry data containing vertices and faces
   */
  public highlightFaces(faceIndices: number[], geometryData: CompasGeometry | null): void {
    // Clear existing face highlight
    if (this.faceHighlightMesh) {
      disposeMesh(this.faceHighlightMesh);
      this.scene.remove(this.faceHighlightMesh);
      this.faceHighlightMesh = null;
    }

    // If no faces or no geometry data, just clear and return
    if (!faceIndices || faceIndices.length === 0 || !geometryData || !geometryData.faces || !geometryData.vertices) {
      return;
    }

    // Collect all faces to highlight
    const facesToHighlight: number[][] = [];
    faceIndices.forEach(faceIndex => {
      if (faceIndex >= 0 && faceIndex < geometryData.faces.length) {
        const face = geometryData.faces[faceIndex];
        if (face && face.length >= 3) {
          facesToHighlight.push(face);
        }
      }
    });

    if (facesToHighlight.length === 0) {
      return;
    }

    // Triangulate all faces
    const allIndices = triangulate(facesToHighlight);
    
    // Create geometry for all faces
    const faceGeom = new THREE.BufferGeometry();
    const positions = new Float32Array(geometryData.vertices.flat());
    faceGeom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    faceGeom.setIndex(allIndices);
    faceGeom.computeVertexNormals();

    // Create material for face highlight (secondary color - sky blue)
    const highlightMaterial = new THREE.MeshStandardMaterial({
      color: 0x0ea5e9, // UI_COLORS.SECONDARY
      roughness: 0.3,
      metalness: 0.0,
      transparent: true,
      opacity: 0.7,
      emissive: 0x0ea5e9,
      emissiveIntensity: 0.6,
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: false
    });

    // Create mesh
    this.faceHighlightMesh = new THREE.Mesh(faceGeom, highlightMaterial);
    this.faceHighlightMesh.renderOrder = 1001; // Render on top of everything
    this.scene.add(this.faceHighlightMesh);

  }

  /**
   * Dispose of all resources
   */
  public dispose(): void {
    if (this.highlightMesh) {
      disposeMesh(this.highlightMesh);
      this.scene.remove(this.highlightMesh);
      this.highlightMesh = null;
    }

    if (this.remainingMesh) {
      disposeMesh(this.remainingMesh);
      this.scene.remove(this.remainingMesh);
      this.remainingMesh = null;
    }

    if (this.faceHighlightMesh) {
      disposeMesh(this.faceHighlightMesh);
      this.scene.remove(this.faceHighlightMesh);
      this.faceHighlightMesh = null;
    }

    // Clear diverse highlights (meshes and line segments)
    while (this.diverseHighlightsGroup.children.length > 0) {
      const object = this.diverseHighlightsGroup.children[0];
      if (object instanceof THREE.Mesh) {
        disposeMesh(object);
      } else if (object instanceof THREE.LineSegments) {
        // Dispose LineSegments geometry and material
        object.geometry.dispose();
        if (object.material instanceof THREE.Material) {
          object.material.dispose();
        }
      }
      this.diverseHighlightsGroup.remove(object);
    }
  }
}
