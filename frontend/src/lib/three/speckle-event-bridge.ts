/**
 * SpeckleEventBridge
 *
 * Bridges Speckle viewer selection events to application callbacks.
 * Handles custom object selection with gizmo display and receiver double-click for first-person mode.
 */

import * as THREE from 'three';
import type { Viewer, SelectionExtension } from '@speckle/viewer';
import { FilteringExtension, CameraController } from '@speckle/viewer';
import type { SpeckleSceneAdapter } from './speckle-scene-adapter';
import type { SpeckleDragHandler } from './speckle-drag-handler';

/**
 * Snapshot of FilteringExtension state, captured before a click
 * so we can restore it if Speckle's internal handling corrupts it.
 */
interface FilterSnapshot {
  hiddenObjects: string[];
  isolatedObjects: string[];
}

export class SpeckleEventBridge {
  private viewer: Viewer;
  private adapter: SpeckleSceneAdapter;
  private selectionExtension: SelectionExtension;
  private filteringExtension: FilteringExtension | null = null;
  private dragHandler: SpeckleDragHandler | null = null;
  private raycaster: THREE.Raycaster;
  private mouse: THREE.Vector2;
  private onCustomObjectSelected: ((object: THREE.Object3D, type: 'sound' | 'receiver') => void) | null = null;
  private onSelectionCleared: (() => void) | null = null;
  private onReceiverDoubleClicked: ((receiverId: string) => void) | null = null;
  private onCustomObjectDoubleClicked: ((position: THREE.Vector3, type: 'sound' | 'receiver') => void) | null = null;
  private onSpeckleObjectSelected: ((objectIds: string[], intersectionPoint?: THREE.Vector3) => void) | null = null;
  private lastIntersectionPoint: THREE.Vector3 | null = null;
  private onSoundSphereClicked: ((promptKey: string) => void) | null = null;
  private onReceiverSingleClicked: ((receiverId: string) => void) | null = null;
  private lastClickTime: number = 0;
  private lastClickedObject: THREE.Object3D | null = null;
  private lastClickedObjectKey: string | null = null;
  private doubleClickDelay: number = 300;
  private singleClickTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingSingleClickData: { object: THREE.Object3D; type: 'sound' | 'receiver' } | null = null;

  // Saved state for unified selection correction after Speckle processes a click
  private savedFilterSnapshot: FilterSnapshot | null = null;
  private expectedSpeckleHitId: string | null = null;

  // Orbit/drag detection to prevent selection while orbiting the camera
  private static readonly DRAG_THRESHOLD_PX = 4;
  private pointerDownPos: { x: number; y: number } | null = null;
  private wasOrbiting = false;

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

  // ============================================================================
  // Unified selection helpers (mode-agnostic)
  // ============================================================================

  /**
   * Set the FilteringExtension for mode-agnostic hidden/isolated object handling.
   * Called by SpeckleAudioCoordinator after initialization.
   */
  public setFilteringExtension(ext: FilteringExtension): void {
    this.filteringExtension = ext;
  }

  /**
   * Check if an object ID is currently hidden or excluded by isolation.
   * Mode-agnostic — same result in default, dark, and acoustic modes.
   */
  private isObjectFilteredOut(objectId: string): boolean {
    if (!this.filteringExtension || !objectId) return false;
    const state = this.filteringExtension.filteringState;
    const isHidden = state?.hiddenObjects?.includes(objectId) ?? false;
    const isExcludedByIsolation =
      (state?.isolatedObjects?.length ?? 0) > 0 &&
      !state?.isolatedObjects?.includes(objectId);
    return isHidden || isExcludedByIsolation;
  }

  /**
   * Check against a *saved* snapshot (pre-click) rather than live state,
   * because Speckle's click handling may have corrupted the live state.
   */
  private wasFilteredInSnapshot(objectId: string, snap: FilterSnapshot | null): boolean {
    if (!snap || !objectId) return false;
    const wasHidden = snap.hiddenObjects.includes(objectId);
    const wasExcluded =
      snap.isolatedObjects.length > 0 && !snap.isolatedObjects.includes(objectId);
    return wasHidden || wasExcluded;
  }

  /**
   * Find the first visible Speckle object at the current mouse position.
   * Uses Speckle's own intersection API and walks all hits, skipping
   * hidden / non-isolated objects.  Returns the object ID or null.
   */
  private findVisibleSpeckleHit(): string | null {
    try {
      const renderer = this.viewer.getRenderer();
      const camera = this.adapter.getCamera();

      const intersections = (renderer as any).intersections.intersect(
        renderer.scene,
        camera,
        this.mouse,
        undefined,  // layers
        false,      // firstOnly — we need all hits to walk past hidden ones
        undefined   // clippingVolume
      );

      if (!intersections || intersections.length === 0) return null;

      for (const intersection of intersections) {
        const pair = (renderer as any).renderViewFromIntersection(intersection);
        if (!pair) continue;
        const rv = pair[0];
        const objectId: string | undefined = rv?.renderData?.id;
        if (objectId && !this.isObjectFilteredOut(objectId)) {
          return objectId;
        }
      }
      return null;
    } catch (error) {
      console.error('[SpeckleEventBridge] findVisibleSpeckleHit error:', error);
      return null;
    }
  }

  /** Capture current filtering state before a click is processed. */
  private captureFilterSnapshot(): FilterSnapshot | null {
    if (!this.filteringExtension) return null;
    const s = this.filteringExtension.filteringState;
    return {
      hiddenObjects: [...(s?.hiddenObjects || [])],
      isolatedObjects: [...(s?.isolatedObjects || [])],
    };
  }

  /**
   * Restore filtering state from a snapshot if Speckle corrupted it
   * (e.g. selecting a hidden object reset FilteringExtension draw ranges).
   */
  private restoreFilterSnapshot(snap: FilterSnapshot | null): void {
    if (!snap || !this.filteringExtension) return;
    try {
      const cur = this.filteringExtension.filteringState;
      const hiddenChanged = (cur?.hiddenObjects?.length || 0) !== snap.hiddenObjects.length;
      const isolatedChanged = (cur?.isolatedObjects?.length || 0) !== snap.isolatedObjects.length;

      if (!hiddenChanged && !isolatedChanged) return;

      console.log('[SpeckleEventBridge] Restoring corrupted filtering state');
      if (snap.hiddenObjects.length > 0) {
        this.filteringExtension.hideObjects(snap.hiddenObjects, undefined, true, false);
      }
      if (snap.isolatedObjects.length > 0) {
        this.filteringExtension.isolateObjects(snap.isolatedObjects, undefined, true, true);
      }
    } catch (error) {
      console.error('[SpeckleEventBridge] restoreFilterSnapshot error:', error);
    }
  }

  /**
   * Unified Speckle object selection handler.
   *
   * Called ~50 ms after a click to let Speckle's internal handling run first.
   * Verifies the result and corrects it when:
   *   1. A hidden/non-isolated object was selected  → correct to the visible one
   *   2. Nothing was selected but a visible object exists → select it
   *
   * This replaces the old checkSpeckleSelection() and is mode-agnostic.
   */
  private handleSpeckleSelection(): void {
    try {
      const selectedObjects = this.selectionExtension.getSelectedObjects() || [];
      const selectedIds: string[] = selectedObjects.map((obj: any) => {
        if (typeof obj === 'string') return obj;
        return obj?.id || String(obj);
      });

      const snap = this.savedFilterSnapshot;
      const expectedId = this.expectedSpeckleHitId;

      // Clear saved state
      this.savedFilterSnapshot = null;
      this.expectedSpeckleHitId = null;

      // ---- Case 1: Speckle selected a filtered object ----
      const hasFilteredSelection = selectedIds.some(
        (id) => this.wasFilteredInSnapshot(id, snap) || this.isObjectFilteredOut(id)
      );

      if (hasFilteredSelection) {
        this.selectionExtension.clearSelection();
        this.restoreFilterSnapshot(snap);

        if (expectedId) {
          this.selectionExtension.selectObjects([expectedId]);
        }
        if (this.onSpeckleObjectSelected) {
          this.onSpeckleObjectSelected(expectedId ? [expectedId] : []);
        }
        return;
      }

      // ---- Case 2: Nothing selected, but a visible object was expected ----
      if (selectedIds.length === 0 && expectedId) {
        this.selectionExtension.selectObjects([expectedId]);
        if (this.onSpeckleObjectSelected) {
          this.onSpeckleObjectSelected([expectedId]);
        }
        return;
      }

      // ---- Case 3: Selection is valid — pass through ----
      if (selectedIds.length > 0 && this.lastClickedObject) {
        if (this.onSelectionCleared) {
          this.onSelectionCleared();
        }
        this.lastClickedObject = null;
      }

      if (this.onSpeckleObjectSelected) {
        this.onSpeckleObjectSelected(selectedIds);
      }
    } catch (error) {
      console.error('[SpeckleEventBridge] handleSpeckleSelection error:', error);
    }
  }

  public setupEventListeners(): void {
    const canvas = this.viewer.getRenderer().renderer.domElement;
    canvas.addEventListener('pointerdown', this.handlePointerDown, true);
    canvas.addEventListener('pointerup', this.handlePointerUp, true);
    canvas.addEventListener('click', this.handleCanvasClick, true);
    canvas.addEventListener('dblclick', this.handleCanvasDblClick, true);
    window.addEventListener('keydown', this.handleKeyDown);
  }

  private handlePointerDown = (e: PointerEvent): void => {
    this.pointerDownPos = { x: e.clientX, y: e.clientY };
    this.wasOrbiting = false;
  };

  private handlePointerUp = (e: PointerEvent): void => {
    if (this.pointerDownPos) {
      const dx = e.clientX - this.pointerDownPos.x;
      const dy = e.clientY - this.pointerDownPos.y;
      if (dx * dx + dy * dy > SpeckleEventBridge.DRAG_THRESHOLD_PX * SpeckleEventBridge.DRAG_THRESHOLD_PX) {
        this.wasOrbiting = true;
      }
    }
    this.pointerDownPos = null;
  };

  private handleSelectionChange = (): void => {
    // This method is kept for potential future use
    // Currently selection is handled via canvas click detection
    if (this.onSelectionCleared) {
      this.onSelectionCleared();
    }
  };

  private handleCanvasClick = (event: MouseEvent): void => {
    if (this.wasOrbiting) {
      this.wasOrbiting = false;
      return;
    }

    if (this.dragHandler && this.dragHandler.getIsDragging()) {
      return;
    }

    if (this.dragHandler && this.dragHandler.getJustFinishedDragging()) {
      return;
    }

    this.updateMouseFromEvent(event);

    if (this.isClickOnGizmo()) {
      return;
    }

    const customHit = this.raycastCustomObjects();

    if (customHit) {
      event.stopPropagation();
      event.preventDefault();

      // Only clear visuals (Speckle highlight + drag gizmo) without notifying React,
      // to avoid cascading state updates (bounding box, timeline, etc.)
      this.clearVisualSelections();
      if (this.onCustomObjectSelected) {
        this.onCustomObjectSelected(customHit.object, customHit.type);
      }

      // Debounce single-click side effects (card expansion, entity panel, etc.)
      // so they are cancelled if a double-click follows within 300ms.
      if (this.singleClickTimer) {
        clearTimeout(this.singleClickTimer);
      }
      this.pendingSingleClickData = { object: customHit.object, type: customHit.type };
      this.singleClickTimer = setTimeout(() => {
        this.fireSingleClickCallbacks();
      }, this.doubleClickDelay);

      this.lastClickedObject = customHit.object;
      this.lastClickedObjectKey = customHit.object.userData.promptKey || customHit.object.userData.receiverId || customHit.object.uuid;
    } else {
      // UNIFIED SELECTION (mode-agnostic):
      // Pre-compute the correct visible hit while filtering state is still valid,
      // then let Speckle process the click and correct if needed after 50 ms.
      this.savedFilterSnapshot = this.captureFilterSnapshot();
      this.expectedSpeckleHitId = this.findVisibleSpeckleHit();

      setTimeout(() => {
        this.handleSpeckleSelection();
      }, 50);

      // Clear custom object selection if one was active
      if (this.lastClickedObject) {
        if (this.onSelectionCleared) {
          this.onSelectionCleared();
        }
        this.lastClickedObject = null;
        this.lastClickedObjectKey = null;
      }
    }
  };

  /**
   * Native dblclick handler — fires reliably for double-clicks.
   * Cancels pending single-click side effects and triggers zoom.
   */
  private handleCanvasDblClick = (event: MouseEvent): void => {
    if (this.wasOrbiting) {
      return;
    }

    if (this.dragHandler && this.dragHandler.getIsDragging()) {
      return;
    }

    this.updateMouseFromEvent(event);

    const customHit = this.raycastCustomObjects();

    if (customHit) {
      event.stopPropagation();
      event.preventDefault();

      // Cancel pending single-click callbacks (card expansion, etc.)
      if (this.singleClickTimer) {
        clearTimeout(this.singleClickTimer);
        this.singleClickTimer = null;
        this.pendingSingleClickData = null;
      }

      this.handleDoubleClick(customHit.object);
    } else {
      // UNIFIED ZOOM (mode-agnostic): find the correct visible object and zoom to it.
      // Prevents zooming to a hidden object that Speckle might hit in dark mode.
      const visibleId = this.findVisibleSpeckleHit();
      if (visibleId) {
        event.stopPropagation();
        event.preventDefault();
        try {
          const cameraCtrl = this.viewer.getExtension(CameraController) as any;
          if (cameraCtrl?.setCameraView) {
            cameraCtrl.setCameraView([visibleId], true);
          }
        } catch { /* non-critical */ }
      }
      // If no visible hit, let dblclick propagate to Speckle for default zoom-extents
    }
  };

  /**
   * Fire debounced single-click callbacks (sound card expansion, receiver info, etc.)
   */
  private fireSingleClickCallbacks(): void {
    const data = this.pendingSingleClickData;
    this.singleClickTimer = null;
    this.pendingSingleClickData = null;
    if (!data) return;

    if (data.type === 'sound' && this.onSoundSphereClicked) {
      const promptKey = data.object.userData.promptKey;
      if (promptKey) {
        this.onSoundSphereClicked(promptKey);
      }
    }

    if (data.type === 'receiver' && this.onReceiverSingleClicked) {
      const receiverId = data.object.userData.receiverId;
      if (receiverId) {
        this.onReceiverSingleClicked(receiverId);
      }
    }
  }

  private updateMouseFromEvent(event: MouseEvent): void {
    const canvas = this.viewer.getRenderer().renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

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

    // Zoom to the double-clicked custom object (sound sphere or receiver)
    if ((objectType === 'sound' || objectType === 'receiver') && this.onCustomObjectDoubleClicked) {
      this.onCustomObjectDoubleClicked(object.position.clone(), objectType);
    }

    // Additionally trigger receiver-specific callback (e.g. activate receiver for IR loading)
    if (objectType === 'receiver') {
      const receiverId = object.userData.receiverId;
      if (receiverId && this.onReceiverDoubleClicked) {
        this.onReceiverDoubleClicked(receiverId);
      }
    }
  }

  /**
   * Clear visual selections only (Speckle highlight + drag gizmo) without
   * notifying React state. Used when clicking custom objects to avoid
   * cascading re-renders (bounding box, timeline, filter colors, etc.)
   */
  private clearVisualSelections(): void {
    // Detach drag gizmo directly — do NOT call onSelectionCleared which also
    // triggers setSelectedEntity(null) → React cascades
    if (this.lastClickedObject && this.dragHandler) {
      this.dragHandler.deselectObjects();
    }
    this.lastClickedObject = null;

    // Clear Speckle highlight only — do NOT call onSpeckleObjectSelected
    this.selectionExtension.clearSelection();
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

  // checkSpeckleSelection() removed — replaced by handleSpeckleSelection()
  // which provides unified, mode-agnostic selection with hidden-object filtering.

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

  public setOnCustomObjectDoubleClicked(callback: (position: THREE.Vector3, type: 'sound' | 'receiver') => void): void {
    this.onCustomObjectDoubleClicked = callback;
  }

  public setOnSpeckleObjectSelected(callback: (objectIds: string[]) => void): void {
    this.onSpeckleObjectSelected = callback;
  }

  public setOnReceiverSingleClicked(callback: (receiverId: string) => void): void {
    this.onReceiverSingleClicked = callback;
  }

  public dispose(): void {
    if (this.singleClickTimer) {
      clearTimeout(this.singleClickTimer);
      this.singleClickTimer = null;
    }
    const canvas = this.viewer.getRenderer().renderer.domElement;
    canvas.removeEventListener('pointerdown', this.handlePointerDown, true);
    canvas.removeEventListener('pointerup', this.handlePointerUp, true);
    canvas.removeEventListener('click', this.handleCanvasClick, true);
    canvas.removeEventListener('dblclick', this.handleCanvasDblClick, true);
    window.removeEventListener('keydown', this.handleKeyDown);
    this.onCustomObjectSelected = null;
    this.onSelectionCleared = null;
    this.onReceiverDoubleClicked = null;
    this.onCustomObjectDoubleClicked = null;
    this.onReceiverSingleClicked = null;
    this.onSpeckleObjectSelected = null;
    this.lastClickedObject = null;
    this.pendingSingleClickData = null;
  }
}
