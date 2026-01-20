import * as THREE from "three";
import { SpeckleStandardMaterial } from "@speckle/viewer";
import { disposeMesh } from "@/lib/three/mesh-cleanup";
import { updateDraggableMeshes, disposeMeshes } from "@/lib/three/draggable-mesh-manager";
import { calculateSpiralPositions } from "@/lib/three/spiral-placement";
import type { ReceiverData } from "@/types";
import type { BoundingBoxBounds } from "@/lib/three/BoundingBoxManager";

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

  // Bounding box for spiral placement
  private boundingBox: BoundingBoxBounds | null = null;

  // Preview cube for placement
  private previewReceiver: THREE.Mesh | null = null;

  constructor(scene: THREE.Scene, scaleForSounds: number, parentGroup?: THREE.Group) {
    this.scene = scene;
    this.scaleForSounds = scaleForSounds;
    this.parentGroup = parentGroup || null;
  }

  /**
   * Set bounding box for spiral placement
   * Should be called when bounding box is calculated/updated
   */
  public setBoundingBox(bounds: BoundingBoxBounds | null): void {
    this.boundingBox = bounds;
  }

  /**
   * Update stored receiver position (called when receiver is dragged)
   * This ensures the position persists across re-renders
   */
  public updateReceiverPosition(receiverId: string, position: [number, number, number]): void {
    this.receiverPositions.set(receiverId, position);
  }

  /**
   * Update receiver cubes based on receiver data
   * Uses DraggableMeshManager utility for efficient updates
   * 
   * @param receivers - Receiver data array
   * @param useSpiralPlacement - Whether to use spiral placement (default: false)
   */
  public updateReceivers(receivers: ReceiverData[], useSpiralPlacement: boolean = false): void {
    // Clean up positions for deleted receivers
    const currentReceiverIds = new Set(receivers.map(r => r.id));
    for (const id of this.receiverPositions.keys()) {
      if (!currentReceiverIds.has(id)) {
        this.receiverPositions.delete(id);
      }
    }

    // Calculate spiral positions ONLY for NEW receivers that don't have stored positions
    // This preserves dragged positions when receivers are re-rendered
    let spiralPositionMap: Map<string, [number, number, number]> = new Map();
    const hasNewReceivers = receivers.some(r => !this.receiverPositions.has(r.id));

    if (useSpiralPlacement && this.boundingBox && hasNewReceivers) {
      const earHeight = 1.6;
      const boxCenterY = (this.boundingBox.min[1] + this.boundingBox.max[1]) / 2;
      const heightOffset = earHeight - boxCenterY;
      const allSpiralPositions = calculateSpiralPositions(this.boundingBox, receivers.length, heightOffset);

      // Map spiral positions only to new receivers
      receivers.forEach((receiver, index) => {
        if (!this.receiverPositions.has(receiver.id)) {
          spiralPositionMap.set(receiver.id, allSpiralPositions[index].toArray() as [number, number, number]);
        }
      });
    }

    // Update receiver data with correct positions (priority: stored > spiral > original)
    const updatedReceivers = receivers.map(receiver => {
      // Check for stored position first (from drag)
      const storedPosition = this.receiverPositions.get(receiver.id);
      if (storedPosition) {
        return { ...receiver, position: storedPosition };
      }

      // Check for spiral position (for new receivers)
      const spiralPosition = spiralPositionMap.get(receiver.id);
      if (spiralPosition) {
        // Store the new spiral position for future reference
        this.receiverPositions.set(receiver.id, spiralPosition);
        return { ...receiver, position: spiralPosition };
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

    // Blue color for receivers (sky-500: #0ea5e9)
    const material = new SpeckleStandardMaterial({
      color: 0x0ea5e9,
      emissive: 0x0ea5e9,
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
      color: 0x0ea5e9,
      emissive: 0x0ea5e9,
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
