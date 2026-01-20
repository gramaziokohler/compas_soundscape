/**
 * BoundingBoxManager
 * 
 * Manages the creation, update, and disposal of bounding box visualizations
 * for Resonance Audio room acoustics. Can be used with both Three.js and Speckle scenes.
 * 
 * Features:
 * - Wireframe edges visualization
 * - Semi-transparent face planes with material-based coloring
 * - Face labels with dynamic sizing
 * - Automatic disposal and cleanup
 */

import * as THREE from 'three';
import { SpeckleBasicMaterial } from '@speckle/viewer';
import { RESONANCE_AUDIO, UI_COLORS } from '@/lib/constants';
import type { ResonanceRoomMaterial } from '@/types/audio';

export interface BoundingBoxBounds {
  min: [number, number, number];
  max: [number, number, number];
}

export interface BoundingBoxConfig {
  /** Room material configuration for each face */
  roomMaterials?: ResonanceRoomMaterial;
  /** Whether to show the bounding box */
  visible?: boolean;
}

/**
 * Face configuration for bounding box visualization
 */
interface FaceConfig {
  name: string;
  normal: THREE.Vector3;
  position: THREE.Vector3;
  rotation: [number, number, number];
  material: 'left' | 'right' | 'front' | 'back' | 'down' | 'up';
  size: [number, number];
}

/**
 * BoundingBoxManager
 * 
 * Creates and manages a bounding box group for Resonance Audio room visualization.
 */
export class BoundingBoxManager {
  private boundingBoxGroup: THREE.Group | null = null;
  private scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /**
   * Calculate effective bounding box bounds
   * 
   * Priority:
   * 1. Explicit geometry bounds (from 3D model)
   * 2. Auto-calculated from sound source positions
   * 
   * @param geometryBounds - Optional explicit geometry bounds from 3D model
   * @param soundPositions - Array of sound source positions for auto-calculation
   * @returns Bounding box bounds or null if no valid bounds available
   */
  public calculateEffectiveBounds(
    geometryBounds: BoundingBoxBounds | null,
    soundPositions: THREE.Vector3[]
  ): BoundingBoxBounds | null {
    // Priority 1: Use explicit geometry bounds if available
    if (geometryBounds) {
      return geometryBounds;
    }

    // Priority 2: Calculate from sound sources if available
    if (soundPositions.length > 0) {
      const positions = soundPositions;
      
      // Calculate min/max across all sound sources
      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      
      positions.forEach(pos => {
        minX = Math.min(minX, pos.x);
        minY = Math.min(minY, pos.y);
        minZ = Math.min(minZ, pos.z);
        maxX = Math.max(maxX, pos.x);
        maxY = Math.max(maxY, pos.y);
        maxZ = Math.max(maxZ, pos.z);
      });
      
      // Add threshold padding
      const threshold = RESONANCE_AUDIO.BOUNDING_BOX.AUTO_BBOX_THRESHOLD;
      minX -= threshold;
      minY -= threshold;
      minZ -= threshold;
      maxX += threshold;
      maxY += threshold;
      maxZ += threshold;
      
      // Calculate dimensions
      const width = maxX - minX;
      const height = maxY - minY;
      const depth = maxZ - minZ;
      
      // Ensure minimum size
      const minSize = RESONANCE_AUDIO.BOUNDING_BOX.AUTO_BBOX_MIN_SIZE;
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      const centerZ = (minZ + maxZ) / 2;
      
      return {
        min: [centerX - width/2, centerY - height/2, centerZ - depth/2],
        max: [centerX + width/2, centerY + height/2, centerZ + depth/2]
      };
    }
    
    return null;
  }

  /**
   * Calculate bounding box from Speckle viewer using World API
   * 
   * Uses the Speckle viewer's World.worldBox (Box3) to get the overall bounding box
   * of all loaded objects. This is the most reliable method.
   * 
   * See: https://docs.speckle.systems/developers/viewer/viewer-api#worldclass
   * 
   * @param viewer - Speckle viewer instance
   * @returns Bounding box bounds or null if no objects available
   */
  public calculateBoundsFromSpeckleBatches(viewer: any): BoundingBoxBounds | null {
    try {
      // Use the World API to get the worldBox (Box3)
      const world = viewer.World;
      if (!world) {
        console.warn('[BoundingBoxManager] No World accessor available');
        return null;
      }

      const worldBox = world.worldBox;
      if (!worldBox) {
        console.warn('[BoundingBoxManager] No worldBox available');
        return null;
      }

      // Check if the box is valid (not empty)
      if (worldBox.isEmpty()) {
        console.warn('[BoundingBoxManager] World box is empty');
        return null;
      }

      console.log('[BoundingBoxManager] Successfully got world box:', {
        min: worldBox.min,
        max: worldBox.max
      });

      // Convert THREE.Box3 to our bounds format
      return {
        min: [worldBox.min.x, worldBox.min.y, worldBox.min.z],
        max: [worldBox.max.x, worldBox.max.y, worldBox.max.z]
      };
    } catch (error) {
      console.error('[BoundingBoxManager] Error calculating bounds from Speckle World:', error);
      return null;
    }
  }

  /**
   * Create or update bounding box visualization
   * 
   * @param bounds - Bounding box bounds
   * @param config - Bounding box configuration (materials, visibility)
   */
  public updateBoundingBox(bounds: BoundingBoxBounds | null, config: BoundingBoxConfig): void {
    console.log('[BoundingBoxManager] updateBoundingBox called:', { bounds, config });
    console.log('[BoundingBoxManager] Scene info:', {
      sceneUUID: this.scene.uuid,
      sceneChildren: this.scene.children.length,
      hasBoundingBoxGroup: !!this.boundingBoxGroup
    });
    
    // Remove existing bounding box if no bounds
    if (!bounds) {
      console.log('[BoundingBoxManager] No bounds, disposing bounding box');
      this.disposeBoundingBox();
      return;
    }

    // Create new bounding box if it doesn't exist
    if (!this.boundingBoxGroup) {
      console.log('[BoundingBoxManager] Creating new bounding box');
      this.createBoundingBox(bounds, config);
    } else {
      console.log('[BoundingBoxManager] Updating existing bounding box');
      console.log('[BoundingBoxManager] Bounding box group state:', {
        uuid: this.boundingBoxGroup.uuid,
        visible: this.boundingBoxGroup.visible,
        parent: this.boundingBoxGroup.parent?.uuid,
        children: this.boundingBoxGroup.children.length,
        position: this.boundingBoxGroup.position.toArray(),
        inScene: this.scene.children.includes(this.boundingBoxGroup)
      });
      // Update existing bounding box (materials, visibility)
      this.updateMaterials(config.roomMaterials);
      if (config.visible !== undefined) {
        this.boundingBoxGroup.visible = config.visible;
        console.log('[BoundingBoxManager] Set visibility to:', config.visible);
        console.log('[BoundingBoxManager] Verified visibility is now:', this.boundingBoxGroup.visible);
        
        // Also set visibility on all children to ensure they render
        this.boundingBoxGroup.traverse((child) => {
          child.visible = config.visible ?? true;
        });
        console.log('[BoundingBoxManager] Set visibility on all children as well');
      }
    }
  }

  /**
   * Create bounding box group with all visualizations
   */
  private createBoundingBox(bounds: BoundingBoxBounds, config: BoundingBoxConfig): void {
    const [minX, minY, minZ] = bounds.min;
    const [maxX, maxY, maxZ] = bounds.max;
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const centerZ = (minZ + maxZ) / 2;
    const width = maxX - minX;
    const height = maxY - minY;
    const depth = maxZ - minZ;

    // Create group to hold all bounding box elements
    const boundingBoxGroup = new THREE.Group();
    boundingBoxGroup.name = 'BoundingBoxGroup';
    boundingBoxGroup.position.set(centerX, centerY, centerZ);
    
    // Configure layers for Speckle compatibility (same as sound spheres)
    boundingBoxGroup.layers.enableAll(); // Enable all layers for Speckle
    boundingBoxGroup.visible = true; // Force visibility

    // 1. Create wireframe edges
    const boxGeometry = new THREE.BoxGeometry(width, height, depth);
    const edgesGeometry = new THREE.EdgesGeometry(boxGeometry);
    const wireframeMaterial = new THREE.LineBasicMaterial({ 
      color: RESONANCE_AUDIO.BOUNDING_BOX.WIREFRAME_COLOR,
      linewidth: RESONANCE_AUDIO.BOUNDING_BOX.WIREFRAME_WIDTH,
      depthTest: false,
      depthWrite: false
    });
    const wireframe = new THREE.LineSegments(edgesGeometry, wireframeMaterial);
    wireframe.renderOrder = RESONANCE_AUDIO.BOUNDING_BOX.WIREFRAME_RENDER_ORDER;
    wireframe.frustumCulled = false; // Disable frustum culling
    
    // Configure layers for Speckle compatibility
    wireframe.layers.disableAll();
    wireframe.layers.enable(0); // Default layer
    wireframe.layers.enable(4); // OVERLAY layer
    
    boundingBoxGroup.add(wireframe);

    // Calculate label size based on bounding box dimensions
    const maxDimension = Math.max(width, height, depth);
    const labelWidth = maxDimension * RESONANCE_AUDIO.BOUNDING_BOX.LABEL_SCALE_FACTOR;
    const labelHeight = labelWidth / RESONANCE_AUDIO.BOUNDING_BOX.LABEL_ASPECT_RATIO;

    // 2. Create face planes with materials
    const faceConfigs: FaceConfig[] = [
      { name: 'Right', normal: new THREE.Vector3(-1, 0, 0), position: new THREE.Vector3(-width/2, 0, 0), rotation: [0, Math.PI/2, 0], material: 'left', size: [depth, height] },
      { name: 'Left', normal: new THREE.Vector3(1, 0, 0), position: new THREE.Vector3(width/2, 0, 0), rotation: [0, -Math.PI/2, 0], material: 'right', size: [depth, height] },
      { name: 'Ceiling', normal: new THREE.Vector3(0, 0, 1), position: new THREE.Vector3(0, 0, depth/2), rotation: [0, 0, 0], material: 'front', size: [width, height] },
      { name: 'Floor', normal: new THREE.Vector3(0, 0, -1), position: new THREE.Vector3(0, 0, -depth/2), rotation: [0, Math.PI, 0], material: 'back', size: [width, height] },
      { name: 'Front', normal: new THREE.Vector3(0, -1, 0), position: new THREE.Vector3(0, -height/2, 0), rotation: [Math.PI/2, 0, 0], material: 'down', size: [width, depth] },
      { name: 'Back', normal: new THREE.Vector3(0, 1, 0), position: new THREE.Vector3(0, height/2, 0), rotation: [-Math.PI/2, 0, 0], material: 'up', size: [width, depth] },
    ];

    faceConfigs.forEach(faceConfig => {
      // Create semi-transparent plane using Speckle material
      const planeGeometry = new THREE.PlaneGeometry(faceConfig.size[0], faceConfig.size[1]);
      const planeMaterial = new SpeckleBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: RESONANCE_AUDIO.BOUNDING_BOX.FACE_BASE_OPACITY,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false
      });
      
      // Configure material to skip problematic MRT render passes (same as sound spheres)
      const originalOnBeforeRender = planeMaterial.onBeforeRender.bind(planeMaterial);
      planeMaterial.onBeforeRender = (renderer: any, scene: any, camera: any, geometry: any, object: any) => {
        const renderTarget = renderer.getRenderTarget();
        if (renderTarget && renderTarget.texture && Array.isArray(renderTarget.texture)) {
          return; // Skip MRT passes
        }
        if (originalOnBeforeRender) {
          originalOnBeforeRender(renderer, scene, camera, geometry, object);
        }
      };
      
      const plane = new THREE.Mesh(planeGeometry, planeMaterial);
      plane.position.copy(faceConfig.position);
      plane.rotation.set(faceConfig.rotation[0], faceConfig.rotation[1], faceConfig.rotation[2]);
      plane.renderOrder = RESONANCE_AUDIO.BOUNDING_BOX.FACE_RENDER_ORDER;
      plane.frustumCulled = false; // Disable frustum culling
      plane.userData.faceName = faceConfig.material; // Store for updates
      plane.userData.speckleType = 'BoundingBoxFace'; // Mark as Speckle object
      
      // Configure layers for Speckle compatibility (same as sound spheres)
      plane.layers.disableAll();
      plane.layers.enable(0); // Default layer
      plane.layers.enable(4); // OVERLAY layer
      
      boundingBoxGroup.add(plane);

      // Create text sprite for label
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d')!;
      canvas.width = RESONANCE_AUDIO.BOUNDING_BOX.LABEL_CANVAS_WIDTH;
      canvas.height = RESONANCE_AUDIO.BOUNDING_BOX.LABEL_CANVAS_HEIGHT;
      context.fillStyle = RESONANCE_AUDIO.BOUNDING_BOX.LABEL_BG_COLOR;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.font = RESONANCE_AUDIO.BOUNDING_BOX.LABEL_FONT;
      context.fillStyle = RESONANCE_AUDIO.BOUNDING_BOX.LABEL_TEXT_COLOR;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(faceConfig.name, canvas.width / 2, canvas.height / 2);

      const texture = new THREE.CanvasTexture(canvas);
      const spriteMaterial = new THREE.SpriteMaterial({ 
        map: texture,
        depthTest: false,
        depthWrite: false
      });
      const sprite = new THREE.Sprite(spriteMaterial);
      sprite.position.copy(faceConfig.position);
      sprite.scale.set(labelWidth, labelHeight, 1);
      sprite.renderOrder = RESONANCE_AUDIO.BOUNDING_BOX.LABEL_RENDER_ORDER;
      sprite.frustumCulled = false; // Disable frustum culling
      sprite.userData.speckleType = 'BoundingBoxLabel'; // Mark as Speckle object
      
      // Configure layers for Speckle compatibility
      sprite.layers.disableAll();
      sprite.layers.enable(0); // Default layer
      sprite.layers.enable(4); // OVERLAY layer
      
      boundingBoxGroup.add(sprite);
    });

    // Add to scene
    this.scene.add(boundingBoxGroup);
    this.boundingBoxGroup = boundingBoxGroup;
    
    // Force matrix updates (same as sound spheres)
    boundingBoxGroup.updateMatrix();
    boundingBoxGroup.updateMatrixWorld(true);
    this.scene.updateMatrixWorld(true);
    
    console.log('[BoundingBoxManager] ✅ Created bounding box:', {
      groupUUID: boundingBoxGroup.uuid,
      childrenCount: boundingBoxGroup.children.length,
      position: boundingBoxGroup.position.toArray(),
      visible: boundingBoxGroup.visible,
      layers: boundingBoxGroup.layers.mask,
      sceneChildrenCount: this.scene.children.length,
      inScene: this.scene.children.includes(boundingBoxGroup)
    });

    // Dispose temporary geometry
    boxGeometry.dispose();

    // Update materials if provided
    if (config.roomMaterials) {
      this.updateMaterials(config.roomMaterials);
    }

    // Set visibility
    if (config.visible !== undefined) {
      this.boundingBoxGroup.visible = config.visible;
      console.log('[BoundingBoxManager] Initial visibility set to:', config.visible);
    }
  }

  /**
   * Update face colors based on room materials
   */
  private updateMaterials(roomMaterials?: BoundingBoxConfig['roomMaterials']): void {
    if (!this.boundingBoxGroup || !roomMaterials) return;

    // Gradient colors from constants
    const startColor = UI_COLORS.MATERIAL_GRADIENT_START.replace("#", "");
    const endColor = UI_COLORS.MATERIAL_GRADIENT_END.replace("#", "");

    this.boundingBoxGroup.children.forEach(child => {
      if (child instanceof THREE.Mesh && child.userData.faceName) {
        const faceMaterial = roomMaterials[child.userData.faceName as keyof typeof roomMaterials];
        const absorption = RESONANCE_AUDIO.MATERIAL_ABSORPTION[faceMaterial as keyof typeof RESONANCE_AUDIO.MATERIAL_ABSORPTION] || 0;

        // Interpolate between teal (low absorption) and orange (high absorption)
        const r = (parseInt(startColor.slice(0, 2), 16) + (parseInt(endColor.slice(0, 2), 16) - parseInt(startColor.slice(0, 2), 16)) * absorption) / 255;
        const g = (parseInt(startColor.slice(2, 4), 16) + (parseInt(endColor.slice(2, 4), 16) - parseInt(startColor.slice(2, 4), 16)) * absorption) / 255;
        const b = (parseInt(startColor.slice(4, 6), 16) + (parseInt(endColor.slice(4, 6), 16) - parseInt(startColor.slice(4, 6), 16)) * absorption) / 255;

        // Handle both SpeckleBasicMaterial and THREE.MeshBasicMaterial
        const material = child.material as THREE.MeshBasicMaterial | SpeckleBasicMaterial;
        material.color.setRGB(r, g, b);
        material.opacity =
          RESONANCE_AUDIO.BOUNDING_BOX.FACE_BASE_OPACITY +
          absorption * RESONANCE_AUDIO.BOUNDING_BOX.FACE_ABSORPTION_OPACITY_SCALE;
      }
    });
  }

  /**
   * Dispose of bounding box and clean up resources
   */
  public disposeBoundingBox(): void {
    if (!this.boundingBoxGroup) return;

    this.scene.remove(this.boundingBoxGroup);
    this.boundingBoxGroup.children.forEach(child => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      } else if (child instanceof THREE.LineSegments) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      } else if (child instanceof THREE.Sprite) {
        (child.material as THREE.SpriteMaterial).map?.dispose();
        (child.material as THREE.Material).dispose();
      }
    });
    this.boundingBoxGroup = null;
  }

  /**
   * Set visibility of bounding box
   */
  public setVisible(visible: boolean): void {
    if (this.boundingBoxGroup) {
      this.boundingBoxGroup.visible = visible;
    }
  }

  /**
   * Get current bounding box group
   */
  public getBoundingBoxGroup(): THREE.Group | null {
    return this.boundingBoxGroup;
  }

  /**
   * Clean up on destroy
   */
  public dispose(): void {
    this.disposeBoundingBox();
  }
}
