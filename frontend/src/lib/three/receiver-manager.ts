import * as THREE from "three";
import { SpeckleStandardMaterial } from "@speckle/viewer";
import { disposeMesh } from "@/lib/three/mesh-cleanup";
import { updateDraggableMeshes, disposeMeshes } from "@/lib/three/draggable-mesh-manager";
// import { calculateSpiralPositions } from "@/lib/three/spiral-placement"; // Replaced by camera-based placement
import type { ReceiverData } from "@/types";
// import type { BoundingBoxBounds } from "@/lib/three/BoundingBoxManager"; // Unused after spiral placement removal
import { RECEIVER_CONFIG, OBJECT_LABEL } from "@/utils/constants";
import { createLabelSprite, disposeLabelSprite } from "@/lib/three/label-sprite-factory";

/**
 * ReceiverManager
 * 
 * Manages receiver creation, placement, position updates, and visual representation.
 * 
 * Responsibilities:
 * - Receiver cube creation and updates
 * - Preview cube for placement mode
 * - Position tracking and updates
 * - Visual styling (blue cubes)
 * - Resource cleanup
 * 
 * Architecture:
 * - Uses DraggableMeshManager utility for efficient mesh updates
 * - Preserves mesh references for DragControls compatibility
 */
export class ReceiverManager {
  private scene: THREE.Scene;
  private parentGroup: THREE.Group | null;
  private scaleForSounds: number;

  // Receiver tracking
  private receiverMeshes: THREE.Mesh[] = [];
  private draggableObjects: THREE.Object3D[] = [];

  // Position tracking - stores positions by receiver ID to preserve dragged positions
  private receiverPositions: Map<string, [number, number, number]> = new Map();

  // Label sprites — one per receiver, keyed by receiver ID
  private labelSprites: Map<string, THREE.Sprite> = new Map();

  // Bounding box (retained for potential future use; not used by current placement strategy)
  // private boundingBox: BoundingBoxBounds | null = null;

  // Preview cube for placement
  private previewReceiver: THREE.Mesh | null = null;

  constructor(scene: THREE.Scene, scaleForSounds: number, parentGroup?: THREE.Group) {
    this.scene = scene;
    this.scaleForSounds = scaleForSounds;
    this.parentGroup = parentGroup || null;
  }

  // setBoundingBox removed — spiral/bounding-box placement replaced by camera-based placement.
  // public setBoundingBox(bounds: BoundingBoxBounds | null): void {
  //   this.boundingBox = bounds;
  // }

  /**
   * Update stored receiver position (called when receiver is dragged)
   * This ensures the position persists across re-renders
   */
  public updateReceiverPosition(receiverId: string, position: [number, number, number]): void {
    this.receiverPositions.set(receiverId, position);
  }

  /**
   * Update receiver cubes based on receiver data.
   * New receivers are placed at the position provided in their data
   * (caller is responsible for setting position, e.g. 2 m in front of camera).
   *
   * @param receivers - Receiver data array
   */
  public updateReceivers(receivers: ReceiverData[]): void {
    // Clean up positions for deleted receivers
    const currentReceiverIds = new Set(receivers.map(r => r.id));
    for (const id of this.receiverPositions.keys()) {
      if (!currentReceiverIds.has(id)) {
        this.receiverPositions.delete(id);
      }
    }

    // On first call (empty map), seed positions from receiver data.
    // This preserves restored/saved positions after a page reload.
    if (this.receiverPositions.size === 0 && receivers.length > 0) {
      for (const r of receivers) {
        this.receiverPositions.set(r.id, [...r.position] as [number, number, number]);
      }
    }

    // ── Spiral / bounding-box placement removed ──────────────────────────────
    // Receivers are now placed 2 m in front of the camera by the caller
    // (see handleAddReceiver in page.tsx using RECEIVER_CONFIG.CAMERA_PLACEMENT_DISTANCE_M).
    // let spiralPositionMap: Map<string, [number, number, number]> = new Map();
    // const hasNewReceivers = receivers.some(r => !this.receiverPositions.has(r.id));
    // if (useSpiralPlacement && this.boundingBox && hasNewReceivers) {
    //   const allSpiralPositions = calculateSpiralPositions(this.boundingBox, receivers.length);
    //   receivers.forEach((receiver, index) => {
    //     if (!this.receiverPositions.has(receiver.id)) {
    //       spiralPositionMap.set(receiver.id, allSpiralPositions[index].toArray() as [number, number, number]);
    //     }
    //   });
    // }
    // ─────────────────────────────────────────────────────────────────────────

    // Update receiver data with correct positions (priority: stored > original)
    const updatedReceivers = receivers.map(receiver => {
      // Check for stored position first (from drag)
      const storedPosition = this.receiverPositions.get(receiver.id);
      if (storedPosition) {
        return { ...receiver, position: storedPosition };
      }

      // Use original position and store it
      this.receiverPositions.set(receiver.id, receiver.position);
      return receiver;
    });

    const target = this.parentGroup || this.scene;
    const result = updateDraggableMeshes(
      target,
      this.receiverMeshes,
      updatedReceivers,
      (receiver) => this.createReceiverCube(receiver),
      (mesh) => mesh.userData.receiverId
    );

    this.receiverMeshes = result.meshes;
    this.draggableObjects = result.draggableObjects;

    // Sync label sprites with the current receiver set
    this.syncLabelSprites(result.meshes);
  }

  /**
   * Create a single receiver cube
   */
  private createReceiverCube(receiver: ReceiverData): THREE.Mesh {
    // Use same sizing logic as sound spheres (0.3 * scaleForSounds)
    const cubeSize = 0.3 * this.scaleForSounds;
    const cubeGeom = new THREE.BoxGeometry(cubeSize, cubeSize, cubeSize);

  
    const material = new SpeckleStandardMaterial({
      color: RECEIVER_CONFIG.COLOR,
      emissive: RECEIVER_CONFIG.COLOR,
      emissiveIntensity: 0.3,
      roughness: 0.3,
      metalness: 0.7,
      transparent: false,
      depthWrite: true,
      depthTest: true,
      side: THREE.FrontSide,
    });

    // Configure material to skip problematic MRT render passes
    const originalOnBeforeRender = material.onBeforeRender.bind(material);
    material.onBeforeRender = (renderer: any, scene: any, camera: any, geometry: any, object: any) => {
      const renderTarget = renderer.getRenderTarget();
      if (renderTarget && renderTarget.texture && Array.isArray(renderTarget.texture)) {
        return; // Skip MRT passes
      }
      if (originalOnBeforeRender) {
        originalOnBeforeRender(renderer, scene, camera, geometry, object);
      }
    };

    const cubeMesh = new THREE.Mesh(cubeGeom, material);
    cubeMesh.position.fromArray(receiver.position);
    cubeMesh.userData.receiverId = receiver.id;
    cubeMesh.userData.receiverName = receiver.name;
    cubeMesh.userData.isReceiver = true;
    cubeMesh.userData.speckleType = 'Receiver'; // Mark as custom Speckle object
    cubeMesh.userData.customObjectType = 'receiver'; // CRITICAL: Required for drag handler and event bridge

    // Set specific layers for Speckle compatibility
    // Use OVERLAY layer (4) to avoid problematic render passes
    cubeMesh.layers.disableAll();
    cubeMesh.layers.enable(0); // Default layer for basic rendering
    cubeMesh.layers.enable(4); // OVERLAY layer for custom objects

    // CRITICAL: Force update matrix to ensure proper rendering
    cubeMesh.updateMatrix();
    
    console.log('[ReceiverManager] ✅ Created receiver:', {
      id: receiver.id,
      position: receiver.position,
      visible: cubeMesh.visible,
      layers: cubeMesh.layers.mask,
      matrixAutoUpdate: cubeMesh.matrixAutoUpdate
    });

    // Note: Scene.add() is handled by updateDraggableMeshes utility
    // This factory only creates the mesh
    return cubeMesh;
  }

  /**
   * Enable preview receiver cube for placement mode
   */
  public enablePreview(): void {
    if (this.previewReceiver) return; // Already enabled

    const cubeSize = 0.3 * this.scaleForSounds;
    const cubeGeom = new THREE.BoxGeometry(cubeSize, cubeSize, cubeSize);

    const material = new SpeckleStandardMaterial({
      color: RECEIVER_CONFIG.COLOR,
      emissive: RECEIVER_CONFIG.COLOR,
      emissiveIntensity: 0.3,
      roughness: 0.3,
      metalness: 0.7,
      transparent: true,
      opacity: 0.5,
      depthWrite: true,
      depthTest: true,
      side: THREE.FrontSide,
    });

    // Configure material to skip problematic MRT render passes
    const originalOnBeforeRender = material.onBeforeRender.bind(material);
    material.onBeforeRender = (renderer: any, scene: any, camera: any, geometry: any, object: any) => {
      const renderTarget = renderer.getRenderTarget();
      if (renderTarget && renderTarget.texture && Array.isArray(renderTarget.texture)) {
        return; // Skip MRT passes
      }
      if (originalOnBeforeRender) {
        originalOnBeforeRender(renderer, scene, camera, geometry, object);
      }
    };

    const previewMesh = new THREE.Mesh(cubeGeom, material);
    previewMesh.position.set(0, 1.6, 0); // Default ear height
    previewMesh.userData.isPreview = true;
    previewMesh.userData.speckleType = 'ReceiverPreview';
    previewMesh.userData.customObjectType = 'receiver'; // CRITICAL: Required for drag handler

    // Set specific layers for Speckle compatibility
    previewMesh.layers.disableAll();
    previewMesh.layers.enable(0); // Default layer for basic rendering
    previewMesh.layers.enable(4); // OVERLAY layer for custom objects

    // Add to parent group or scene
    const target = this.parentGroup || this.scene;
    target.add(previewMesh);
    this.previewReceiver = previewMesh;
  }

  /**
   * Disable preview receiver cube
   */
  public disablePreview(): void {
    if (this.previewReceiver) {
      disposeMesh(this.previewReceiver);
      this.scene.remove(this.previewReceiver);
      this.previewReceiver = null;
    }
  }

  /**
   * Update preview receiver position
   */
  public updatePreviewPosition(position: THREE.Vector3): void {
    if (this.previewReceiver) {
      this.previewReceiver.position.copy(position);
    }
  }

  /**
   * Get preview receiver position (for placement)
   */
  public getPreviewPosition(): [number, number, number] | null {
    if (!this.previewReceiver) return null;
    const pos = this.previewReceiver.position;
    return [pos.x, pos.y, pos.z];
  }

  /**
   * Get all draggable receiver objects
   */
  public getDraggableObjects(): THREE.Object3D[] {
    return this.draggableObjects;
  }

  /**
   * Get all receiver mesh objects
   */
  public getReceiverMeshes(): THREE.Mesh[] {
    return this.receiverMeshes;
  }

  /**
   * Get preview receiver mesh (if active)
   */
  public getPreviewReceiver(): THREE.Mesh | null {
    return this.previewReceiver;
  }

  /**
   * Update scale for sounds (affects receiver size)
   */
  public updateScale(scaleForSounds: number): void {
    this.scaleForSounds = scaleForSounds;
  }

  // ============================================================================
  // Screen-Space Sizing + Labels
  // ============================================================================

  /**
   * Sync label sprites with the current set of receiver meshes.
   * Creates, updates (on name change), or removes labels as needed.
   */
  private syncLabelSprites(meshes: THREE.Mesh[]): void {
    const target = this.parentGroup || this.scene;
    const currentIds = new Set(
      meshes.map(m => m.userData.receiverId as string).filter(Boolean)
    );

    // Remove labels for deleted receivers
    for (const [id, sprite] of this.labelSprites) {
      if (!currentIds.has(id)) {
        target.remove(sprite);
        disposeLabelSprite(sprite);
        this.labelSprites.delete(id);
      }
    }

    // Create or refresh labels
    for (const mesh of meshes) {
      const id = mesh.userData.receiverId as string;
      if (!id) continue;

      const text = (mesh.userData.receiverName as string) || id;
      const existing = this.labelSprites.get(id);

      if (existing) {
        if (existing.userData.labelText === text) continue;
        target.remove(existing);
        disposeLabelSprite(existing);
        this.labelSprites.delete(id);
      }

      const sprite = createLabelSprite(text);
      sprite.position.copy(mesh.position);
      target.add(sprite);
      this.labelSprites.set(id, sprite);
    }
  }

  /**
   * Update receiver mesh scales and label positions every frame so objects
   * appear at a constant screen size regardless of camera distance (zoom).
   *
   * Called by SpeckleAudioCoordinator's per-frame callback.
   */
  public updateScreenSpaceScale(camera: THREE.PerspectiveCamera): void {
    const baseHalfSize = RECEIVER_CONFIG.CUBE_SIZE_MULTIPLIER * this.scaleForSounds;
    const target = this.parentGroup || this.scene;

    this.receiverMeshes.forEach(mesh => {
      const distance = camera.position.distanceTo(mesh.position);
      if (distance < 0.01) return;

      // Scale cube so world half-size = distance × SCREEN_SPACE_SIZE, clamped to min/max
      const rawScale = (distance * RECEIVER_CONFIG.SCREEN_SPACE_SIZE) / baseHalfSize;
      const scale = Math.max(RECEIVER_CONFIG.MIN_SCALE, Math.min(RECEIVER_CONFIG.MAX_SCALE, rawScale));
      mesh.scale.setScalar(scale);

      // Position and scale label (use same clamped ratio)
      const id = mesh.userData.receiverId as string;
      const label = id ? this.labelSprites.get(id) : null;
      if (label) {
        const clampRatio = scale / rawScale;
        const zOffset = distance * RECEIVER_CONFIG.SCREEN_SPACE_SIZE * OBJECT_LABEL.Z_OFFSET_FACTOR * clampRatio;
        label.position.set(mesh.position.x, mesh.position.y, mesh.position.z + zOffset);
        const h = distance * OBJECT_LABEL.SCREEN_SPACE_HEIGHT * clampRatio;
        label.scale.set(h * (label.userData.aspectRatio as number || 3), h, 1);
      }
    });
  }

  /**
   * Dispose of all resources
   */
  public dispose(): void {
    const target = this.parentGroup || this.scene;

    // Remove all receiver cubes
    disposeMeshes(this.scene, this.receiverMeshes);
    this.receiverMeshes = [];
    this.draggableObjects = [];

    // Dispose all label sprites
    this.labelSprites.forEach((sprite) => {
      target.remove(sprite);
      disposeLabelSprite(sprite);
    });
    this.labelSprites.clear();

    // Clear position tracking
    this.receiverPositions.clear();

    // Remove preview cube
    this.disablePreview();
  }
}
