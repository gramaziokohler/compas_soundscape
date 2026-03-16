import * as THREE from "three";
import { SpeckleStandardMaterial } from "@speckle/viewer";
import { disposeMesh } from "@/lib/three/mesh-cleanup";
import { updateDraggableMeshes, disposeMeshes } from "@/lib/three/draggable-mesh-manager";
// import { calculateSpiralPositions } from "@/lib/three/spiral-placement"; // Replaced by camera-based placement
import type { ReceiverData } from "@/types";
// import type { BoundingBoxBounds } from "@/lib/three/BoundingBoxManager"; // Unused after spiral placement removal
import { RECEIVER_CONFIG } from "@/utils/constants";

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

  /**
   * Dispose of all resources
   */
  public dispose(): void {
    // Remove all receiver cubes
    disposeMeshes(this.scene, this.receiverMeshes);
    this.receiverMeshes = [];
    this.draggableObjects = [];

    // Clear position tracking
    this.receiverPositions.clear();

    // Remove preview cube
    this.disablePreview();
  }
}
