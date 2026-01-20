/**
 * SpeckleEventBridge
 *
 * Bridges Speckle viewer selection events to application callbacks.
 * Handles custom object selection with gizmo display and receiver double-click for first-person mode.
 */

import * as THREE from 'three';
import type { Viewer, SelectionExtension } from '@speckle/viewer';
import type { SpeckleSceneAdapter } from './speckle-scene-adapter';
import type { SpeckleDragHandler } from './speckle-drag-handler';
export class SpeckleEventBridge {
  private viewer: Viewer;
  private adapter: SpeckleSceneAdapter;
  private selectionExtension: SelectionExtension;
  private dragHandler: SpeckleDragHandler | null = null;
  private raycaster: THREE.Raycaster;
  private mouse: THREE.Vector2;
  private onCustomObjectSelected: ((object: THREE.Object3D, type: 'sound' | 'receiver') => void) | null = null;
  private onSelectionCleared: (() => void) | null = null;
  private onReceiverDoubleClicked: ((receiverId: string) => void) | null = null;
  private onSpeckleObjectSelected: ((objectIds: string[], intersectionPoint?: THREE.Vector3) => void) | null = null;
  private lastIntersectionPoint: THREE.Vector3 | null = null;
  private onSoundSphereClicked: ((promptKey: string) => void) | null = null;
  private lastClickTime: number = 0;
  private lastClickedObject: THREE.Object3D | null = null;
  private doubleClickDelay: number = 300;

  constructor(
    viewer: Viewer,
    adapter: SpeckleSceneAdapter,
    selectionExtension: SelectionExtension
  ) {
    this.viewer = viewer;
    this.adapter = adapter;
    this.selectionExtension = selectionExtension;
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
  }

  public setupEventListeners(): void {
    // Listen to selection changes via viewer's selection state
    // The SelectionExtension modifies the viewer's internal selection state
    // We'll poll this state or use an alternative approach
    const canvas = this.viewer.getRenderer().renderer.domElement;
    canvas.addEventListener('click', this.handleCanvasClick, true);
    window.addEventListener('keydown', this.handleKeyDown);
  }

  private handleSelectionChange = (): void => {
    // This method is kept for potential future use
    // Currently selection is handled via canvas click detection
    if (this.onSelectionCleared) {
      this.onSelectionCleared();
    }
  };

  private handleCanvasClick = (event: MouseEvent): void => {
    const currentTime = Date.now();
    const timeSinceLastClick = currentTime - this.lastClickTime;

    if (this.dragHandler && this.dragHandler.getIsDragging()) {
      return;
    }

    if (this.dragHandler && this.dragHandler.getJustFinishedDragging()) {
      return;
    }

    const canvas = this.viewer.getRenderer().renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    if (this.isClickOnGizmo()) {
      return;
    }

    const customHit = this.raycastCustomObjects();

    if (customHit) {
      event.stopPropagation();
      event.preventDefault();
      
      // Clear all selections before selecting custom object
      this.clearAllSelections();

      if (this.onCustomObjectSelected) {
        this.onCustomObjectSelected(customHit.object, customHit.type);
      }

      // If sound sphere clicked, notify callback to expand sound card
      if (customHit.type === 'sound' && this.onSoundSphereClicked) {
        const promptKey = customHit.object.userData.promptKey;
        if (promptKey) {
          this.onSoundSphereClicked(promptKey);
        }
      }

      if (timeSinceLastClick < this.doubleClickDelay && customHit.object === this.lastClickedObject) {
        this.handleDoubleClick(customHit.object);
      }

      this.lastClickTime = currentTime;
      this.lastClickedObject = customHit.object;
    } else {
      // No custom object hit - let Speckle handle the selection
      // We'll detect the selection change by polling the viewer's world tree selection
      // Schedule a check after Speckle has processed the click
      setTimeout(() => {
        this.checkSpeckleSelection();
      }, 50);

      // Clear custom object selection if clicked on empty space
      if (this.lastClickedObject) {
        if (this.onSelectionCleared) {
          this.onSelectionCleared();
        }
        this.lastClickedObject = null;
      }

      this.lastClickTime = currentTime;
    }
  };

  private handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      this.clearAllSelections();
    }
  };

  private isClickOnGizmo(): boolean {
    if (!this.dragHandler) return false;
    const transformControls = this.dragHandler.getTransformControls();
    if (!transformControls) return false;
    const camera = this.adapter.getCamera();
    this.raycaster.setFromCamera(this.mouse, camera);
    const intersects = this.raycaster.intersectObject(transformControls as any, true);
    return intersects.length > 0;
  }

  private raycastCustomObjects(): { type: 'sound' | 'receiver'; object: THREE.Object3D } | null {
    const camera = this.adapter.getCamera();
    this.raycaster.setFromCamera(this.mouse, camera);
    const customObjects = this.adapter.getCustomObjects();
    const intersects = this.raycaster.intersectObjects(customObjects, true);

    if (intersects.length === 0) return null;

    for (const intersect of intersects) {
      let currentObject: THREE.Object3D | null = intersect.object;
      while (currentObject) {
        const objectType = currentObject.userData.customObjectType;
        if (objectType === 'sound' || objectType === 'receiver') {
          return { type: objectType, object: currentObject };
        }
        currentObject = currentObject.parent;
      }
    }

    return null;
  }

  private handleDoubleClick(object: THREE.Object3D): void {
    const objectType = object.userData.customObjectType;
    if (objectType === 'receiver') {
      const receiverId = object.userData.receiverId;
      if (receiverId && this.onReceiverDoubleClicked) {
        this.onReceiverDoubleClicked(receiverId);
      }
    }
  }

  /**
   * Clear all selections (both custom objects and Speckle objects)
   * This ensures only one type of object can be selected at a time
   */
  private clearAllSelections(): void {
    // Clear custom object selection
    if (this.lastClickedObject) {
      if (this.onSelectionCleared) {
        this.onSelectionCleared();
      }
      this.lastClickedObject = null;
    }

    // Clear Speckle object selection
    this.selectionExtension.clearSelection();
    if (this.onSpeckleObjectSelected) {
      this.onSpeckleObjectSelected([]);
    }
  }

  public setOnSoundSphereClicked(callback: (promptKey: string) => void): void {
    this.onSoundSphereClicked = callback;
  }

  /**
   * Check Speckle object selection from SelectionExtension
   * This is called after a click to detect if a Speckle object was selected
   */
  private checkSpeckleSelection(): void {
    try {
      // Get selected object IDs directly from SelectionExtension
      const selectedObjects = this.selectionExtension.getSelectedObjects() || [];
      
      // Extract IDs from the selected objects
      // The viewer can return either strings or objects with an 'id' property
      const selectedIds: string[] = selectedObjects.map((obj: any) => {
        if (typeof obj === 'string') {
          return obj;
        }
        return obj?.id || String(obj);
      });

      // If Speckle objects are selected, clear custom object selection
      if (selectedIds.length > 0) {
        if (this.lastClickedObject) {
          if (this.onSelectionCleared) {
            this.onSelectionCleared();
          }
          this.lastClickedObject = null;
        }
      }

      // Notify callback
      if (this.onSpeckleObjectSelected) {
        this.onSpeckleObjectSelected(selectedIds);
      }
    } catch (error) {
      console.error('[SpeckleEventBridge] Error checking selection:', error);
    }
  }

  public setDragHandler(dragHandler: SpeckleDragHandler): void {
    this.dragHandler = dragHandler;
  }

  public setOnCustomObjectSelected(callback: (object: THREE.Object3D, type: 'sound' | 'receiver') => void): void {
    this.onCustomObjectSelected = callback;
  }

  public setOnSelectionCleared(callback: () => void): void {
    this.onSelectionCleared = callback;
  }

  public setOnReceiverDoubleClicked(callback: (receiverId: string) => void): void {
    this.onReceiverDoubleClicked = callback;
  }

  public setOnSpeckleObjectSelected(callback: (objectIds: string[]) => void): void {
    this.onSpeckleObjectSelected = callback;
  }

  public dispose(): void {
    const canvas = this.viewer.getRenderer().renderer.domElement;
    canvas.removeEventListener('click', this.handleCanvasClick, true);
    window.removeEventListener('keydown', this.handleKeyDown);
    this.onCustomObjectSelected = null;
    this.onSelectionCleared = null;
    this.onReceiverDoubleClicked = null;
    this.onSpeckleObjectSelected = null;
    this.lastClickedObject = null;
  }
}
