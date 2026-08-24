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
import { RESONANCE_AUDIO } from '@/utils/constants';
import { getCssColorHex } from '@/utils/utils';
import { createLabelSprite, updateLabelSprite, disposeLabelSprite, computeLabelWorldHeight } from './label-sprite-factory';
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
  public currentBounds: BoundingBoxBounds | null = null;
  public gumballHandles: THREE.Mesh[] = [];
  public activeGumball: THREE.Mesh | null = null;
  /** Per-face screen-space labels (Right/Left/Ceiling/Floor/Front/Back). */
  private faceLabels: THREE.Sprite[] = [];
  /** Per-face gumball arrow groups (scaled per-frame for constant screen size). */
  private gumballGroups: THREE.Group[] = [];
  /** Live dimension readout shown in the bbox middle while an arrow is dragged. */
  private dimensionLabel: THREE.Sprite | null = null;
  private dimensionLabelAxis: 'x' | 'y' | 'z' | null = null;
  /** Camera from the most recent updateScreenSpaceScale() — used to size freshly
   *  created sprites immediately so they never render one frame at the rough
   *  creation scale (which is huge relative to their correct screen-space size). */
  private lastCamera: THREE.PerspectiveCamera | null = null;

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
        return null;
      }

      const worldBox = world.worldBox;
      if (!worldBox) {
        return null;
      }

      // Check if the box is valid (not empty)
      if (worldBox.isEmpty()) {
        return null;
      }

      // Convert THREE.Box3 to our bounds format
      return {
        min: [worldBox.min.x, worldBox.min.y, worldBox.min.z],
        max: [worldBox.max.x, worldBox.max.y, worldBox.max.z]
      };
    } catch (error) {
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
    // Remove existing bounding box if no bounds
    if (!bounds) {
      this.disposeBoundingBox();
      return;
    }

    // Check if bounds changed (requires geometry recreation)
    const boundsChanged = this.currentBounds !== null && (
      this.currentBounds.min[0] !== bounds.min[0] ||
      this.currentBounds.min[1] !== bounds.min[1] ||
      this.currentBounds.min[2] !== bounds.min[2] ||
      this.currentBounds.max[0] !== bounds.max[0] ||
      this.currentBounds.max[1] !== bounds.max[1] ||
      this.currentBounds.max[2] !== bounds.max[2]
    );

    if (boundsChanged && this.boundingBoxGroup) {
      this.disposeBoundingBox();
    }

    // Store current bounds
    this.currentBounds = { min: [...bounds.min], max: [...bounds.max] };

    // Create new bounding box if it doesn't exist
    if (!this.boundingBoxGroup) {
      this.createBoundingBox(bounds, config);
    } else {
      // Update existing bounding box (materials, visibility)
      this.updateMaterials(config.roomMaterials);
      if (config.visible !== undefined) {
        this.boundingBoxGroup.visible = config.visible;

        // Also set visibility on all children to ensure they render
        this.boundingBoxGroup.traverse((child) => {
          child.visible = config.visible ?? true;
        });
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
      color: getCssColorHex('--color-info'),
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

    // Arrows/labels keep a constant apparent (screen-space) size at any zoom. The
    // per-frame scale is applied by updateScreenSpaceScale(); set a rough world
    // scale at creation so they never flash at the default sprite size for a frame.
    const roughArrowScale = Math.max(width, height, depth) / 4;

    // 2. Create face planes with materials
    const faceConfigs: FaceConfig[] = [
      { name: 'Right', normal: new THREE.Vector3(-1, 0, 0), position: new THREE.Vector3(-width/2, 0, 0), rotation: [0, Math.PI/2, 0], material: 'right', size: [depth, height] },
      { name: 'Left', normal: new THREE.Vector3(1, 0, 0), position: new THREE.Vector3(width/2, 0, 0), rotation: [0, -Math.PI/2, 0], material: 'left', size: [depth, height] },
      { name: 'Ceiling', normal: new THREE.Vector3(0, 0, 1), position: new THREE.Vector3(0, 0, depth/2), rotation: [0, 0, 0], material: 'up', size: [width, height] },
      { name: 'Floor', normal: new THREE.Vector3(0, 0, -1), position: new THREE.Vector3(0, 0, -depth/2), rotation: [0, Math.PI, 0], material: 'down', size: [width, height] },
      { name: 'Front', normal: new THREE.Vector3(0, -1, 0), position: new THREE.Vector3(0, -height/2, 0), rotation: [Math.PI/2, 0, 0], material: 'front', size: [width, depth] },
      { name: 'Back', normal: new THREE.Vector3(0, 1, 0), position: new THREE.Vector3(0, height/2, 0), rotation: [-Math.PI/2, 0, 0], material: 'back', size: [width, depth] },
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

      // 3. Create gumball double-arrow handle
      const gumballGrp = new THREE.Group();
      gumballGrp.position.copy(faceConfig.position);
      gumballGrp.scale.setScalar(roughArrowScale);

      // Make group orient such that Y points along normal
      const targetQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), faceConfig.normal);
      gumballGrp.setRotationFromQuaternion(targetQuat);

      // Geometry for the arrow (CSS-token colors, resolved at render time)
      const bodyGeo = new THREE.CylinderGeometry(
        RESONANCE_AUDIO.BOUNDING_BOX.GUMBALL_BODY_RADIUS,
        RESONANCE_AUDIO.BOUNDING_BOX.GUMBALL_BODY_RADIUS,
        RESONANCE_AUDIO.BOUNDING_BOX.GUMBALL_BODY_LENGTH,
        8
      );
      const headGeo = new THREE.ConeGeometry(
        RESONANCE_AUDIO.BOUNDING_BOX.GUMBALL_HEAD_RADIUS,
        RESONANCE_AUDIO.BOUNDING_BOX.GUMBALL_HEAD_HEIGHT,
        8
      );

      const colorNormal = getCssColorHex('--color-primary');
      const colorHover = getCssColorHex('--color-primary-hover');

      const mat = new THREE.MeshBasicMaterial({
        color: colorNormal,
        depthTest: false,
        depthWrite: false,
        transparent: true,
        opacity: 0.9
      });

      const body = new THREE.Mesh(bodyGeo, mat);
      gumballGrp.add(body);

      const topHead = new THREE.Mesh(headGeo, mat);
      topHead.position.set(0, RESONANCE_AUDIO.BOUNDING_BOX.GUMBALL_BODY_LENGTH / 2, 0);
      gumballGrp.add(topHead);

      const botHead = new THREE.Mesh(headGeo, mat);
      botHead.position.set(0, -RESONANCE_AUDIO.BOUNDING_BOX.GUMBALL_BODY_LENGTH / 2, 0);
      botHead.rotation.x = Math.PI;
      gumballGrp.add(botHead);

      // A larger invisible cylinder for easier clicking
      const hitGeo = new THREE.CylinderGeometry(
        RESONANCE_AUDIO.BOUNDING_BOX.GUMBALL_HIT_RADIUS,
        RESONANCE_AUDIO.BOUNDING_BOX.GUMBALL_HIT_RADIUS,
        RESONANCE_AUDIO.BOUNDING_BOX.GUMBALL_HIT_LENGTH,
        8
      );
      const hitMat = new THREE.MeshBasicMaterial({ visible: false, depthTest: false, depthWrite: false });
      const hitMesh = new THREE.Mesh(hitGeo, hitMat);

      hitMesh.userData = {
         isGumballHit: true,
         faceName: faceConfig.material,
         faceNormal: faceConfig.normal,
         originalColor: colorNormal,
         hoverColor: colorHover,
         visualArrowMaterial: mat
      };

      gumballGrp.add(hitMesh);

      // Face label sprite. For the four vertical faces (Right/Left/Front/Back)
      // it is placed VERTICALLY ON TOP of the arrow: offset along world-up
      // expressed in the gumball group's local frame, so it hovers directly
      // above the arrow instead of sticking out sideways at the arrow tip.
      // Ceiling and Floor keep the arrow-tip position (along their vertical
      // normal, which is the only sane reading for horizontal faces). The
      // sprite is a child of the gumball group (scaled per frame for constant
      // screen size), so its local scale must be divided by the group scale
      // each frame (updateScreenSpaceScale does this) to keep the text a
      // constant screen size.
      const labelSprite = createLabelSprite(faceConfig.name, { showBackground: false });
      const arrowTipOffset =
        RESONANCE_AUDIO.BOUNDING_BOX.GUMBALL_BODY_LENGTH / 2 +
        RESONANCE_AUDIO.BOUNDING_BOX.GUMBALL_HEAD_HEIGHT +
        RESONANCE_AUDIO.BOUNDING_BOX.GUMBALL_LABEL_CLEARANCE;
      const isHorizontalFace = faceConfig.material === 'up' || faceConfig.material === 'down';
      if (isHorizontalFace) {
        labelSprite.position.set(0, arrowTipOffset, 0);
      } else {
        const localWorldUp = new THREE.Vector3(0, 0, 1)
          .applyQuaternion(gumballGrp.quaternion.clone().invert())
          .multiplyScalar(arrowTipOffset);
        labelSprite.position.copy(localWorldUp);
      }
      labelSprite.scale.set(1, 1, 1); // rough; corrected immediately + per frame
      labelSprite.frustumCulled = false; // Disable frustum culling
      labelSprite.userData.speckleType = 'BoundingBoxLabel'; // Mark as Speckle object
      gumballGrp.add(labelSprite);
      this.faceLabels.push(labelSprite);

      // Force all parts onto overlay layers and top renderOrder
      gumballGrp.traverse(c => {
         c.renderOrder = 9999;
         c.layers.disableAll();
         c.layers.enable(0);
         c.layers.enable(4);
      });

      boundingBoxGroup.add(gumballGrp);
      this.gumballGroups.push(gumballGrp);
      this.gumballHandles.push(hitMesh);
    });

    // Add to scene
    this.scene.add(boundingBoxGroup);
    this.boundingBoxGroup = boundingBoxGroup;
    
    // Force matrix updates (same as sound spheres)
    boundingBoxGroup.updateMatrix();
    boundingBoxGroup.updateMatrixWorld(true);
    this.scene.updateMatrixWorld(true);

    // Dispose temporary geometry
    boxGeometry.dispose();

    // Update materials if provided
    if (config.roomMaterials) {
      this.updateMaterials(config.roomMaterials);
    }

    // Set visibility
    if (config.visible !== undefined) {
      this.boundingBoxGroup.visible = config.visible;
    }

    // Size the freshly created sprites to their correct screen-space scale NOW,
    // before the next render. The frame loop would otherwise render this group
    // once at the rough creation scale — and since the group is recreated on
    // every drag event, that flash would be visible for most frames of a drag.
    if (this.lastCamera) {
      this.updateScreenSpaceScale(this.lastCamera);
    }
  }

  /**
   * Update face colors based on room materials
   */
  private updateMaterials(roomMaterials?: BoundingBoxConfig['roomMaterials']): void {
    if (!this.boundingBoxGroup || !roomMaterials) return;

    // Gradient colors from CSS vars
    const getHexStr = (cssVar: string, fallback: string) => {
      if (typeof document === 'undefined') return fallback;
      return getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim().replace('#', '') || fallback;
    };
    const startColor = getHexStr('--color-material-start', '67bfb4');
    const endColor = getHexStr('--color-material-end', 'eb5c52');

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

  public setHoveredGumball(mesh: THREE.Mesh | null) {
    if (this.activeGumball && this.activeGumball !== mesh) {
      const mat = this.activeGumball.userData.visualArrowMaterial;
      if (mat) mat.color.setHex(this.activeGumball.userData.originalColor);
    }
    this.activeGumball = mesh;
    if (this.activeGumball) {
      const mat = this.activeGumball.userData.visualArrowMaterial;
      if (mat) mat.color.setHex(this.activeGumball.userData.hoverColor);
    }
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

    // Dispose tracked label sprites (shared factory resources).
    this.faceLabels.forEach(disposeLabelSprite);
    this.faceLabels = [];
    if (this.dimensionLabel) {
      disposeLabelSprite(this.dimensionLabel);
      this.dimensionLabel = null;
      this.dimensionLabelAxis = null;
    }
    // Gumball group meshes are disposed by the generic child loop above; just drop refs.
    this.gumballGroups = [];

    this.boundingBoxGroup = null;
    this.gumballHandles = [];
  }

  /**
   * Show the live dimension readout in the middle of the bounding box, aligned
   * with the given drag axis. Creates the label lazily and positions it at the
   * bbox center nudged just inside the box along the axis.
   */
  public showDimensionLabel(bounds: BoundingBoxBounds, axis: 'x' | 'y' | 'z'): void {
    if (!this.boundingBoxGroup) return;
    if (!this.dimensionLabel) {
      this.dimensionLabel = createLabelSprite('', { showBackground: false });
      this.dimensionLabel.scale.set(3, 1.5, 1); // rough; corrected immediately below
      this.dimensionLabel.frustumCulled = false;
      this.dimensionLabel.layers.disableAll();
      this.dimensionLabel.layers.enable(0);
      this.dimensionLabel.layers.enable(4);
      this.boundingBoxGroup.add(this.dimensionLabel);
    }
    this.dimensionLabelAxis = axis;
    this.dimensionLabel.visible = true;
    this.applyDimensionLabel(bounds, axis);
    // Size the readout to its correct screen-space scale immediately so it never
    // renders one frame at the rough (3,1.5,1) scale right after creation.
    if (this.lastCamera) {
      this.updateScreenSpaceScale(this.lastCamera);
    }
  }

  /**
   * Update the live dimension readout text + position while dragging, without
   * recreating the sprite (no flash).
   */
  public updateDimensionLabel(bounds: BoundingBoxBounds, axis: 'x' | 'y' | 'z'): void {
    if (!this.dimensionLabel) return;
    this.dimensionLabelAxis = axis;
    this.applyDimensionLabel(bounds, axis);
  }

  /** Hide the live dimension readout (kept for reuse on the next drag). */
  public hideDimensionLabel(): void {
    if (this.dimensionLabel) {
      this.dimensionLabel.visible = false;
    }
    this.dimensionLabelAxis = null;
  }

  private applyDimensionLabel(bounds: BoundingBoxBounds, axis: 'x' | 'y' | 'z'): void {
    if (!this.dimensionLabel) return;
    const dim = axis === 'x'
      ? bounds.max[0] - bounds.min[0]
      : axis === 'y'
        ? bounds.max[1] - bounds.min[1]
        : bounds.max[2] - bounds.min[2];

    updateLabelSprite(this.dimensionLabel, `${dim.toFixed(1)} m`);

    const offset = RESONANCE_AUDIO.BOUNDING_BOX.DIMENSION_READOUT_AXIS_OFFSET;
    // Position is relative to the bbox group origin (= bbox center).
    this.dimensionLabel.position.set(
      axis === 'x' ? offset : 0,
      axis === 'y' ? offset : 0,
      axis === 'z' ? offset : 0
    );
  }

  /**
   * Scale gumball arrows and label sprites every frame so they keep a constant
   * apparent size regardless of camera distance (zoom). Called by the audio
   * coordinator's per-frame loop.
   */
  public updateScreenSpaceScale(camera: THREE.PerspectiveCamera): void {
    if (!this.boundingBoxGroup) return;
    this.lastCamera = camera;
    const tmpVec = new THREE.Vector3();
    const bbox = RESONANCE_AUDIO.BOUNDING_BOX;

    for (const grp of this.gumballGroups) {
      grp.getWorldPosition(tmpVec);
      const distance = camera.position.distanceTo(tmpVec);
      if (distance < 0.01) continue;

      const rawScale = (distance * bbox.GUMBALL_SCREEN_SPACE_SIZE) / bbox.GUMBALL_BASE_HALF_LENGTH;
      const scale = Math.max(bbox.GUMBALL_MIN_SCALE, Math.min(bbox.GUMBALL_MAX_SCALE, rawScale));
      grp.scale.setScalar(scale);
    }

    for (let i = 0; i < this.faceLabels.length; i++) {
      const label = this.faceLabels[i];
      const grp = this.gumballGroups[i];
      if (!grp) continue;
      label.getWorldPosition(tmpVec);
      const distance = camera.position.distanceTo(tmpVec);
      if (distance < 0.01) continue;
      const h = computeLabelWorldHeight(camera, distance);
      // The label lives inside the (screen-space scaled) gumball group, so the
      // group's scale must be divided out to keep the text a constant screen size.
      const groupScale = grp.scale.x || 1;
      const localH = h / groupScale;
      label.scale.set(localH * (label.userData.aspectRatio as number || 2), localH, 1);
    }

    if (this.dimensionLabel && this.dimensionLabel.visible && this.boundingBoxGroup) {
      this.dimensionLabel.getWorldPosition(tmpVec);
      const distance = camera.position.distanceTo(tmpVec);
      if (distance < 0.01) return;
      const h = computeLabelWorldHeight(camera, distance);
      this.dimensionLabel.scale.set(h * (this.dimensionLabel.userData.aspectRatio as number || 2), h, 1);
    }
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
