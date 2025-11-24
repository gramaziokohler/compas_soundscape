import * as THREE from "three";
import { disposeMesh } from "@/lib/three/mesh-cleanup";
import { updateDraggableMeshes, disposeMeshes } from "@/lib/three/draggable-mesh-manager";
import type { ReceiverData } from "@/types";

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
  private scaleForSounds: number;
  
  // Receiver tracking
  private receiverMeshes: THREE.Mesh[] = [];
  private draggableObjects: THREE.Object3D[] = [];
  
  // Preview cube for placement
  private previewReceiver: THREE.Mesh | null = null;

  constructor(scene: THREE.Scene, scaleForSounds: number) {
    this.scene = scene;
    this.scaleForSounds = scaleForSounds;
  }

  /**
   * Update receiver cubes based on receiver data
   * Uses DraggableMeshManager utility for efficient updates
   */
  public updateReceivers(receivers: ReceiverData[]): void {
    const result = updateDraggableMeshes(
      this.scene,
      this.receiverMeshes,
      receivers,
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
    const material = new THREE.MeshStandardMaterial({
      color: 0x0ea5e9,
      emissive: 0x0ea5e9,
      emissiveIntensity: 0.3,
      roughness: 0.3,
      metalness: 0.7
    });

    const cubeMesh = new THREE.Mesh(cubeGeom, material);
    cubeMesh.position.fromArray(receiver.position);
    cubeMesh.userData.receiverId = receiver.id;
    cubeMesh.userData.isReceiver = true;

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

    const material = new THREE.MeshStandardMaterial({
      color: 0x0ea5e9,
      emissive: 0x0ea5e9,
      emissiveIntensity: 0.3,
      roughness: 0.3,
      metalness: 0.7,
      transparent: true,
      opacity: 0.5
    });

    const previewMesh = new THREE.Mesh(cubeGeom, material);
    previewMesh.position.set(0, 1.6, 0); // Default ear height
    previewMesh.userData.isPreview = true;

    this.scene.add(previewMesh);
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

    // Remove preview cube
    this.disablePreview();
  }
}
