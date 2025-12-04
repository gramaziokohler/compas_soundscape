import * as THREE from "three";
import { DragControls } from "three/examples/jsm/controls/DragControls.js";
import type { CompasGeometry, EntityData } from "@/types";

/**
 * InputHandler
 * 
 * Manages all user input interactions: click handling, drag operations, raycasting, and keyboard input.
 * 
 * Responsibilities:
 * - Click and double-click detection
 * - Entity selection via raycasting
 * - Receiver placement
 * - First-person mode activation (double-click receiver)
 * - Drag controls for sounds and receivers
 * - Mouse movement tracking
 * - Keyboard input (arrow keys, Escape)
 */
export class InputHandler {
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private raycaster: THREE.Raycaster;
  private mouse: THREE.Vector2;
  
  // Drag controls
  private dragControls: DragControls | null = null;
  private isDragging: boolean = false;
  
  // Click detection
  private clickTimeout: NodeJS.Timeout | null = null;
  private clickCount: number = 0;
  
  // Mouse movement tracking (to distinguish click from drag/orbit)
  private mouseDownPosition: { x: number; y: number } | null = null;
  private mouseUpPosition: { x: number; y: number } | null = null;
  
  // Callbacks
  private onEntitySelected: ((entity: EntityData | null) => void) | null = null;
  private onFaceSelected: ((faceIndex: number, entityIndex: number) => void) | null = null;
  private onReceiverPlaced: ((position: [number, number, number]) => void) | null = null;
  private onFirstPersonModeEnabled: ((position: THREE.Vector3, yaw: number, pitch: number) => void) | null = null;
  private onFirstPersonModeDisabled: (() => void) | null = null;
  private onFirstPersonRotate: ((deltaYaw: number, deltaPitch: number) => void) | null = null;
  private onSpherePositionUpdated: ((promptKey: string, position: THREE.Vector3) => void) | null = null;
  private onReceiverPositionUpdated: ((receiverId: string, position: [number, number, number]) => void) | null = null;
  private onPlacementCanceled: (() => void) | null = null;
  private onPreviewPositionUpdated: ((position: THREE.Vector3) => void) | null = null;
  private onSphereClicked: ((promptKey: string) => void) | null = null;
  
  // Refs for data access
  private getGeometryData: (() => CompasGeometry | null) | null = null;
  private getModelEntities: (() => EntityData[]) | null = null;
  private getContentGroup: (() => THREE.Group | null) | null = null;
  private getReceiverMeshes: (() => THREE.Mesh[]) | null = null;
  private getPreviewReceiver: (() => THREE.Mesh | null) | null = null;
  private getOrbitControls: (() => THREE.Object3D | null) | null = null;
  private getSoundSpheresAverage: (() => THREE.Vector3 | null) | null = null;
  private getFirstPersonMode: (() => boolean) | null = null;
  private getSoundSphereMeshes: (() => THREE.Mesh[]) | null = null;
  private getTriangleToFaceMap: (() => number[] | null) | null = null;
  private getAudioRenderingMode: (() => string) | null = null;

  constructor(
    camera: THREE.PerspectiveCamera,
    renderer: THREE.WebGLRenderer
  ) {
    this.camera = camera;
    this.renderer = renderer;
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
  }

  /**
   * Setup click event listener
   */
  public setupClickHandler(): void {
    this.renderer.domElement.addEventListener('mousedown', this.handleMouseDown);
    this.renderer.domElement.addEventListener('mouseup', this.handleMouseUp);
    this.renderer.domElement.addEventListener('click', this.handleClick);
  }

  /**
   * Setup mouse move event listener
   */
  public setupMouseMoveHandler(): void {
    this.renderer.domElement.addEventListener('mousemove', this.handleMouseMove);
  }

  /**
   * Setup keyboard event listener
   */
  public setupKeyboardHandler(): void {
    window.addEventListener('keydown', this.handleKeyDown);
  }

  /**
   * Setup drag controls for sounds and receivers
   */
  public setupDragControls(
    draggableObjects: THREE.Object3D[],
    orbitControls: any
  ): void {

    // Filter out objects that aren't properly attached to the scene and have valid matrixWorld
    const validObjects = draggableObjects.filter(obj => {
      // Check if object has a parent
      if (obj.parent === null) {
        console.log('[InputHandler] Filtering out object with no parent:', obj.userData);
        return false;
      }

      // Check if parent has matrixWorld (deep check)
      let currentParent: THREE.Object3D | null = obj.parent;
      while (currentParent !== null) {
        if (currentParent.matrixWorld === null || currentParent.matrixWorld === undefined) {
          console.log('[InputHandler] Filtering out object with invalid parent matrixWorld:', obj.userData);
          return false;
        }
        currentParent = currentParent.parent;
      }

      // Ensure matrixWorld is updated before adding to drag controls
      // This prevents "Cannot read properties of null (reading 'matrixWorld')" errors
      try {
        obj.updateMatrixWorld(true);
        return true;
      } catch (error) {
        console.error('[InputHandler] Error updating matrixWorld for object:', obj.userData, error);
        return false;
      }
    });

    // Always dispose and recreate drag controls to ensure clean state
    // Reusing causes issues with stale object references
    if (this.dragControls) {
      try {
        this.dragControls.dispose();
      } catch (error) {
        console.warn('[InputHandler] Error disposing drag controls:', error);
      }
      this.dragControls = null;
    }

    if (validObjects.length === 0) {
      return;
    }

    try {
      const dragControls = new DragControls(
        validObjects,
        this.camera,
        this.renderer.domElement
      );

      (dragControls as any).transformGroup = false;

      dragControls.addEventListener('dragstart', (event) => {
        this.isDragging = true;
        if (orbitControls) {
          orbitControls.enabled = false;
        }
        if (event.object) {
          event.object.userData.isDragging = true;
        }
      });

      dragControls.addEventListener('drag', (event) => {
        if (event.object && event.object.userData.promptKey) {
          // Sound sphere dragging - update position during drag
          if (this.onSpherePositionUpdated) {
            this.onSpherePositionUpdated(event.object.userData.promptKey, event.object.position.clone());
          }
        } else if (event.object && event.object.userData.receiverId) {
          // Receiver dragging - update position during drag (same as sound spheres)
          if (this.onReceiverPositionUpdated) {
            const receiverId = event.object.userData.receiverId;
            const position: [number, number, number] = [
              event.object.position.x,
              event.object.position.y,
              event.object.position.z
            ];
            this.onReceiverPositionUpdated(receiverId, position);
          }
        }
      });

      dragControls.addEventListener('dragend', (event) => {
        this.isDragging = false;
        if (orbitControls) {
          orbitControls.enabled = true;
        }
        if (event.object) {
          event.object.userData.isDragging = false;
        }
      });

      this.dragControls = dragControls;
    } catch (error) {
      console.error('[InputHandler] Error creating drag controls:', error);
      this.dragControls = null;
    }
  }

  /**
   * Handle mouse down events (track initial position)
   */
  private handleMouseDown = (event: MouseEvent): void => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouseDownPosition = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  };

  /**
   * Handle mouse up events (track final position)
   */
  private handleMouseUp = (event: MouseEvent): void => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouseUpPosition = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  };

  /**
   * Check if the mouse movement was minimal (a true click, not a drag/orbit)
   */
  private wasMinimalMovement(): boolean {
    if (!this.mouseDownPosition || !this.mouseUpPosition) {
      return true; // If we don't have positions, assume it was a click
    }

    const dx = this.mouseUpPosition.x - this.mouseDownPosition.x;
    const dy = this.mouseUpPosition.y - this.mouseDownPosition.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // Threshold: 5 pixels - allows for small jitter but prevents drag/orbit from triggering selection
    const CLICK_THRESHOLD = 5;
    return distance < CLICK_THRESHOLD;
  }

  /**
   * Handle click events
   */
  private handleClick = (event: MouseEvent): void => {
    // Only process click if there was minimal mouse movement
    // This prevents entity selection when orbiting the camera
    if (!this.wasMinimalMovement()) {
      // User was dragging/orbiting - don't process as a click
      return;
    }

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);

    // Check if in placing mode
    const previewReceiver = this.getPreviewReceiver?.();
    if (this.onReceiverPlaced && previewReceiver) {
      const position = previewReceiver.position;
      this.onReceiverPlaced([position.x, position.y, position.z]);
      return;
    }

    // Check for sound sphere click (single click to show overlay if hidden)
    const soundSphereMeshes = this.getSoundSphereMeshes?.() || [];
    const sphereIntersects = this.raycaster.intersectObjects(soundSphereMeshes, false);
    
    if (sphereIntersects.length > 0 && this.onSphereClicked) {
      const sphereMesh = sphereIntersects[0].object as THREE.Mesh;
      const promptKey = sphereMesh.userData.promptKey;
      if (promptKey) {
        this.onSphereClicked(promptKey);
        return;
      }
    }

    // Check for receiver double-click
    const receiverMeshes = this.getReceiverMeshes?.() || [];
    const receiverIntersects = this.raycaster.intersectObjects(receiverMeshes, false);
    
    if (receiverIntersects.length > 0) {
      this.clickCount++;

      if (this.clickCount === 1) {
        this.clickTimeout = setTimeout(() => {
          this.clickCount = 0;
        }, 300);
      } else if (this.clickCount === 2) {
        // Double-click detected
        if (this.clickTimeout) clearTimeout(this.clickTimeout);
        this.clickCount = 0;

        // Enable first-person mode at receiver position
        const receiverMesh = receiverIntersects[0].object as THREE.Mesh;
        const receiverPosition = receiverMesh.position.clone();

        // Calculate initial look-at target
        const soundSpheresAvg = this.getSoundSpheresAverage?.() || null;
        const initialTarget = soundSpheresAvg || new THREE.Vector3(
          receiverPosition.x,
          receiverPosition.y,
          receiverPosition.z - 5
        );

        // Calculate initial rotation angles
        const direction = new THREE.Vector3().subVectors(initialTarget, receiverPosition).normalize();
        const initialYaw = Math.atan2(direction.x, direction.z);
        const initialPitch = Math.asin(direction.y);

        if (this.onFirstPersonModeEnabled) {
          this.onFirstPersonModeEnabled(receiverPosition, initialYaw, initialPitch);
        }

        console.log('[InputHandler] First-person mode enabled', {
          receiverPos: receiverPosition.toArray(),
          initialYaw,
          initialPitch
        });

        return;
      }

      // Single click on receiver - ignore
      return;
    }

    // Check for entity selection
    const geometryData = this.getGeometryData?.();
    const modelEntities = this.getModelEntities?.() || [];
    const contentGroup = this.getContentGroup?.();
    const audioRenderingMode = this.getAudioRenderingMode?.() || 'anechoic';

    if (contentGroup && contentGroup.children.length > 0) {
      const geometryMesh = contentGroup.children.find(child =>
        child instanceof THREE.Mesh && child.userData.isGeometry === true
      );

      if (geometryMesh) {
        const intersects = this.raycaster.intersectObject(geometryMesh, false);

        if (intersects.length > 0) {
          const intersection = intersects[0];

          // Use face-entity mapping if available
          if (
            geometryData?.face_entity_map &&
            intersection.faceIndex !== undefined &&
            intersection.faceIndex !== null &&
            modelEntities.length > 0
          ) {
            const triangleIndex = intersection.faceIndex;

            // Get the triangle-to-face mapping to find the original face index
            const triangleToFaceMap = this.getTriangleToFaceMap?.() || null;

            let faceIndex: number;
            if (triangleToFaceMap && triangleIndex < triangleToFaceMap.length) {
              // Use the mapping to get the original face index
              faceIndex = triangleToFaceMap[triangleIndex];
            } else {
              // Fallback: assume each triangle is a separate face (no mapping available)
              faceIndex = triangleIndex;
            }

            if (faceIndex < geometryData.face_entity_map.length) {
              const entityIndex = geometryData.face_entity_map[faceIndex];
              const entity = modelEntities.find(e => e.index === entityIndex);

              // In precise mode, highlight face only (no entity UI)
              if (audioRenderingMode === 'precise') {
                if (this.onFaceSelected) {
                  this.onFaceSelected(faceIndex, entityIndex);
                  return;
                }
              } else {
                // Normal mode: show entity UI
                if (entity && this.onEntitySelected) {
                  this.onEntitySelected(entity);
                  return;
                }
              }
            }
          }

          // Fallback: use bounding box method (only in non-precise mode)
          if (audioRenderingMode !== 'precise') {
            const clickPoint = intersection.point;
            let closestEntity = null;
            let minDistance = Infinity;

            modelEntities.forEach(entity => {
              const min = entity.bounds.min;
              const max = entity.bounds.max;
              const isInside =
                clickPoint.x >= min[0] && clickPoint.x <= max[0] &&
                clickPoint.y >= min[1] && clickPoint.y <= max[1] &&
                clickPoint.z >= min[2] && clickPoint.z <= max[2];

              if (isInside) {
                const entityPos = new THREE.Vector3(
                  entity.position[0],
                  entity.position[1],
                  entity.position[2]
                );
                const distance = clickPoint.distanceTo(entityPos);

                if (distance < minDistance) {
                  minDistance = distance;
                  closestEntity = entity;
                }
              }
            });

            if (this.onEntitySelected) {
              this.onEntitySelected(closestEntity);
            }
            return;
          }
        }
      }
    }

    // No geometry clicked - deselect
    if (audioRenderingMode === 'precise') {
      // In precise mode, deselect face
      if (this.onFaceSelected) {
        // Signal deselection by calling with -1, -1
        this.onFaceSelected(-1, -1);
      }
    } else {
      // Normal mode: deselect entity
      if (this.onEntitySelected) {
        this.onEntitySelected(null);
      }
    }
  };

  /**
   * Handle mouse move events
   */
  private handleMouseMove = (event: MouseEvent): void => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    const previewReceiver = this.getPreviewReceiver?.();
    if (previewReceiver) {
      this.raycaster.setFromCamera(this.mouse, this.camera);

      // Raycast against plane at ear height
      const planeY = 1.6;
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY);
      const intersectPoint = new THREE.Vector3();
      this.raycaster.ray.intersectPlane(plane, intersectPoint);

      if (intersectPoint && this.onPreviewPositionUpdated) {
        this.onPreviewPositionUpdated(intersectPoint);
      }
    }
  };

  /**
   * Handle keyboard events
   */
  private handleKeyDown = (event: KeyboardEvent): void => {
    const isFirstPersonMode = this.getFirstPersonMode?.() || false;

    // Arrow key rotation in first-person mode
    if (isFirstPersonMode) {
      const rotationSpeed = 0.05; // Radians per keypress
      const pitchSpeed = 0.03; // Slower vertical rotation

      let deltaYaw = 0;
      let deltaPitch = 0;

      switch (event.key) {
        case 'ArrowLeft':
          deltaYaw = rotationSpeed;
          event.preventDefault();
          break;
        case 'ArrowRight':
          deltaYaw = -rotationSpeed;
          event.preventDefault();
          break;
        case 'ArrowUp':
          deltaPitch = pitchSpeed;
          event.preventDefault();
          break;
        case 'ArrowDown':
          deltaPitch = -pitchSpeed;
          event.preventDefault();
          break;
      }

      if ((deltaYaw !== 0 || deltaPitch !== 0) && this.onFirstPersonRotate) {
        this.onFirstPersonRotate(deltaYaw, deltaPitch);
      }
    }

    // Escape key - cancel placement or exit first-person mode
    if (event.key === 'Escape') {
      if (this.onPlacementCanceled) {
        this.onPlacementCanceled();
      }
      if (this.onFirstPersonModeDisabled) {
        this.onFirstPersonModeDisabled();
      }
    }
  };

  // ============================================================================
  // Callback Setters
  // ============================================================================

  public setOnEntitySelected(callback: (entity: EntityData | null) => void): void {
    this.onEntitySelected = callback;
  }

  public setOnFaceSelected(callback: (faceIndex: number, entityIndex: number) => void): void {
    this.onFaceSelected = callback;
  }

  public setOnReceiverPlaced(callback: (position: [number, number, number]) => void): void {
    this.onReceiverPlaced = callback;
  }

  public setOnFirstPersonModeEnabled(callback: (position: THREE.Vector3, yaw: number, pitch: number) => void): void {
    this.onFirstPersonModeEnabled = callback;
  }

  public setOnFirstPersonModeDisabled(callback: () => void): void {
    this.onFirstPersonModeDisabled = callback;
  }

  public setOnFirstPersonRotate(callback: (deltaYaw: number, deltaPitch: number) => void): void {
    this.onFirstPersonRotate = callback;
  }

  public setOnSpherePositionUpdated(callback: (promptKey: string, position: THREE.Vector3) => void): void {
    this.onSpherePositionUpdated = callback;
  }

  public setOnReceiverPositionUpdated(callback: (receiverId: string, position: [number, number, number]) => void): void {
    this.onReceiverPositionUpdated = callback;
  }

  public setOnPlacementCanceled(callback: () => void): void {
    this.onPlacementCanceled = callback;
  }

  public setOnPreviewPositionUpdated(callback: (position: THREE.Vector3) => void): void {
    this.onPreviewPositionUpdated = callback;
  }

  public setOnSphereClicked(callback: (promptKey: string) => void): void {
    this.onSphereClicked = callback;
  }

  // ============================================================================
  // Data Getter Setters
  // ============================================================================

  public setGeometryDataGetter(getter: () => CompasGeometry | null): void {
    this.getGeometryData = getter;
  }

  public setModelEntitiesGetter(getter: () => EntityData[]): void {
    this.getModelEntities = getter;
  }

  public setContentGroupGetter(getter: () => THREE.Group | null): void {
    this.getContentGroup = getter;
  }

  public setReceiverMeshesGetter(getter: () => THREE.Mesh[]): void {
    this.getReceiverMeshes = getter;
  }

  public setPreviewReceiverGetter(getter: () => THREE.Mesh | null): void {
    this.getPreviewReceiver = getter;
  }

  public setOrbitControlsGetter(getter: () => THREE.Object3D | null): void {
    this.getOrbitControls = getter;
  }

  public setSoundSpheresAverageGetter(getter: () => THREE.Vector3 | null): void {
    this.getSoundSpheresAverage = getter;
  }

  public setFirstPersonModeGetter(getter: () => boolean): void {
    this.getFirstPersonMode = getter;
  }

  public setSoundSphereMeshesGetter(getter: () => THREE.Mesh[]): void {
    this.getSoundSphereMeshes = getter;
  }

  public setTriangleToFaceMapGetter(getter: () => number[] | null): void {
    this.getTriangleToFaceMap = getter;
  }

  public setAudioRenderingModeGetter(getter: () => string): void {
    this.getAudioRenderingMode = getter;
  }

  /**
   * Dispose of all resources
   */
  public dispose(): void {
    // Remove event listeners
    this.renderer.domElement.removeEventListener('mousedown', this.handleMouseDown);
    this.renderer.domElement.removeEventListener('mouseup', this.handleMouseUp);
    this.renderer.domElement.removeEventListener('click', this.handleClick);
    this.renderer.domElement.removeEventListener('mousemove', this.handleMouseMove);
    window.removeEventListener('keydown', this.handleKeyDown);

    // Clear click timeout
    if (this.clickTimeout) {
      clearTimeout(this.clickTimeout);
      this.clickTimeout = null;
    }

    // Dispose drag controls
    if (this.dragControls) {
      this.dragControls.dispose();
      this.dragControls = null;
    }

    // Clear callbacks
    this.onEntitySelected = null;
    this.onReceiverPlaced = null;
    this.onFirstPersonModeEnabled = null;
    this.onFirstPersonModeDisabled = null;
    this.onFirstPersonRotate = null;
    this.onSpherePositionUpdated = null;
    this.onReceiverPositionUpdated = null;
    this.onPlacementCanceled = null;
    this.onPreviewPositionUpdated = null;
  }
}
