/**
 * SpeckleEventBridge
 *
 * Bridges Speckle viewer selection events to application callbacks.
 * Handles custom object selection with gizmo display and receiver double-click for first-person mode.
 */

import * as THREE from 'three';
import type { Viewer, SelectionExtension, SelectionEvent } from '@speckle/viewer';
import { FilteringExtension, CameraController, ObjectLayers, ViewerEvent } from '@speckle/viewer';
import type { SpeckleSceneAdapter } from './speckle-scene-adapter';
import type { SpeckleDragHandler } from './speckle-drag-handler';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import { useAreaDrawingStore } from '@/store';

/**
 * Snapshot of FilteringExtension state, captured before a click
 * so we can restore it if Speckle's internal handling corrupts it.
 */
interface FilterSnapshot {
  hiddenObjects: string[];
  isolatedObjects: string[];
}

/**
 * THREE's raycaster ignores the `visible` flag (it only checks layers), so an
 * intersection list can contain invisible meshes. Walk the ancestry chain to
 * decide whether an object is actually visible on screen.
 */
function isObjectVisible(object: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (!current.visible) return false;
    current = current.parent;
  }
  return true;
}

export class SpeckleEventBridge {
  private viewer: Viewer;
  private adapter: SpeckleSceneAdapter;
  private selectionExtension: SelectionExtension;
  private cameraController: CameraController;
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
  private onGridListenerDoubleClicked: ((instanceId: number) => void) | null = null;
  private lastClickTime: number = 0;
  private lastClickedObject: THREE.Object3D | null = null;
  private lastClickedObjectKey: string | null = null;
  private doubleClickDelay: number = 300;
  private singleClickTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingSingleClickData: { object: THREE.Object3D; type: 'sound' | 'receiver' } | null = null;

  // Saved state for unified selection correction after Speckle processes a click
  private savedFilterSnapshot: FilterSnapshot | null = null;
  private expectedSpeckleHitId: string | null = null;
  /** SelectionExtension ids captured at pointerdown — i.e. BEFORE Speckle's own
   *  pointerup-driven auto-select mutates it. Lets us rebuild an accumulated
   *  shift+click selection ourselves instead of trusting Speckle's internals. */
  private selectionBeforeClick: string[] = [];
  private lastClickWasShift = false;

  // Orbit/drag detection to prevent selection while orbiting the camera
  private static readonly DRAG_THRESHOLD_PX = 4;
  private pointerDownPos: { x: number; y: number } | null = null;
  private wasOrbiting = false;

  // Mouse-button remap (right=rotate, middle=pan, left-drag=box-select)
  private static readonly DEFAULT_CAMERA_OPTIONS = { enableOrbit: true, enablePan: true };
  private isFirstPersonModeActive = false;

  // Box-select (left-drag) state
  private boxSelectStartPos: { x: number; y: number } | null = null;
  private boxSelectActive = false;
  private boxSelectEl: HTMLDivElement | null = null;

  constructor(
    viewer: Viewer,
    adapter: SpeckleSceneAdapter,
    selectionExtension: SelectionExtension,
    cameraController: CameraController
  ) {
    this.viewer = viewer;
    this.adapter = adapter;
    this.selectionExtension = selectionExtension;
    this.cameraController = cameraController;
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    // SelectionExtension auto-selects on ViewerEvent.ObjectClicked, which Speckle's
    // internal InputEvent emits from raw pointerdown/pointerup timing on the canvas —
    // with NO mouse-button filtering. Its canvas listeners are registered when the
    // Viewer/Renderer is constructed, before ours, so we can't intercept via
    // stopPropagation. Instead we subscribe to the same public event (after
    // SelectionExtension, since it was registered first — emitters call listeners in
    // subscription order) and immediately undo the selection for non-left clicks.
    this.viewer.on(ViewerEvent.ObjectClicked, this.handleViewerObjectClicked);
  }

  private handleViewerObjectClicked = (event: SelectionEvent | null): void => {
    if (!event) return;
    const button = event.event?.button;
    if (button === undefined || button === 0) return;

    this.selectionExtension.clearSelection();
    if (this.onSpeckleObjectSelected) {
      this.onSpeckleObjectSelected([]);
    }
  };

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
   * Called ~50 ms after a click. Rebuilds the desired selection deterministically
   * from the pointerdown snapshot + the visible object under the cursor:
   *   - plain single-click on an object  → replace with that object
   *   - plain single-click on empty space → clear
   *   - shift+click on an object          → add to the existing selection
   *   - shift+click on empty space        → keep the existing selection
   * then applies it to the SelectionExtension (so the viewer highlight is exactly
   * the same set we report). The ids we report are the render-data ids resolved by
   * findVisibleSpeckleHit — the same ids the box-select path uses — so the
   * ObjectExplorer can map them onto rows consistently.
   */
  private handleSpeckleSelection(): void {
    try {
      const snap = this.savedFilterSnapshot;
      const expectedId = this.expectedSpeckleHitId;
      const shift = this.lastClickWasShift;
      const before = this.selectionBeforeClick;

      // Clear saved state
      this.savedFilterSnapshot = null;
      this.expectedSpeckleHitId = null;
      this.lastClickWasShift = false;
      this.selectionBeforeClick = [];

      // Previous selection minus anything that is currently filtered out —
      // a hidden/non-isolated object should never stay selected.
      const previousValid = before.filter((id) => !this.isObjectFilteredOut(id));

      let desired: string[];
      if (shift) {
        // Additive. Clicking an object adds it (if not already present);
        // clicking empty space leaves the current selection untouched.
        desired = previousValid;
        if (expectedId && !desired.includes(expectedId)) desired.push(expectedId);
      } else if (expectedId) {
        desired = [expectedId];
      } else {
        desired = [];
      }

      // Speckle's own auto-select may have selected a hidden object and reset the
      // FilteringExtension ranges — restore the pre-click filter state if it drifted.
      this.restoreFilterSnapshot(snap);

      if (desired.length > 0) {
        this.selectionExtension.selectObjects(desired);
      } else {
        this.selectionExtension.clearSelection();
      }

      // Selecting a Speckle object clears any previously active custom-object
      // (sound sphere / receiver) selection.
      if (desired.length > 0 && this.lastClickedObject) {
        if (this.onSelectionCleared) {
          this.onSelectionCleared();
        }
        this.lastClickedObject = null;
        this.lastClickedObjectKey = null;
      }

      if (this.onSpeckleObjectSelected) {
        this.onSpeckleObjectSelected(desired);
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

    this.applyCameraRemapForButton(e);

    // Snapshot the current Speckle selection on left-press, BEFORE Speckle's own
    // pointerup-driven auto-select mutates it. We use it to rebuild shift+click
    // additive selections deterministically in handleSpeckleSelection.
    if (e.button === 0 && !this.isFirstPersonModeActive) {
      try {
        const objs = this.selectionExtension.getSelectedObjects() || [];
        this.selectionBeforeClick = (objs as any[]).map((o: any) => {
          if (typeof o === 'string') return o;
          return o?.id || String(o);
        });
      } catch {
        this.selectionBeforeClick = [];
      }
    }

    if (e.button === 0 && !this.isFirstPersonModeActive && !this.isExclusiveDragTarget(e)) {
      this.startBoxSelectTracking(e.clientX, e.clientY);
    }
  };

  private handlePointerUp = (e: PointerEvent): void => {
    let dragged = false;
    if (this.pointerDownPos) {
      const dx = e.clientX - this.pointerDownPos.x;
      const dy = e.clientY - this.pointerDownPos.y;
      if (dx * dx + dy * dy > SpeckleEventBridge.DRAG_THRESHOLD_PX * SpeckleEventBridge.DRAG_THRESHOLD_PX) {
        this.wasOrbiting = true;
        dragged = true;
      }
    }
    this.pointerDownPos = null;

    // Restore default camera behavior once every button has been released.
    if (e.buttons === 0) {
      this.cameraController.options = { ...SpeckleEventBridge.DEFAULT_CAMERA_OPTIONS };
    }

    // Middle-click (no drag): deselect only — never select.
    if (!dragged && e.button === 1) {
      this.clearAllSelections();
    }
  };

  /**
   * Remaps mouse-button semantics for Speckle's camera controls, which have no
   * native `mouseButtons` config. Runs inside our own capturing-phase canvas
   * listener, which (per DOM event ordering) always completes before the event
   * bubbles up to Speckle's own container-level pointerdown handler — so the
   * mutations below are guaranteed to be visible when Speckle reads them.
   *
   *  - Left (0):   freeze rotate + pan — this press becomes a box-select candidate.
   *  - Middle (1): remap to button 2 (Speckle's hardcoded pan trigger) so it pans.
   *  - Right (2):  disable pan only — Speckle's fallthrough behavior is rotate.
   */
  private applyCameraRemapForButton(e: PointerEvent): void {
    if (this.isFirstPersonModeActive) return;

    if (e.button === 0) {
      this.cameraController.options = { enableOrbit: false, enablePan: false };
    } else if (e.button === 1) {
      try {
        Object.defineProperty(e, 'button', { value: 2, configurable: true });
      } catch {
        // Some environments may not allow shadowing — pan simply won't engage.
      }
      this.cameraController.options = { ...SpeckleEventBridge.DEFAULT_CAMERA_OPTIONS };
    } else if (e.button === 2) {
      this.cameraController.options = { enableOrbit: true, enablePan: false };
    }
  }

  /**
   * True if this left-button press should be left alone for an existing
   * exclusive-drag system (sound/receiver gizmo, bounding-box gumball handle,
   * or active area drawing) instead of arming box-select.
   */
  private isExclusiveDragTarget(e: PointerEvent): boolean {
    if (useAreaDrawingStore.getState().isDrawing) return true;

    this.updateMouseFromEvent(e);
    if (this.isClickOnGizmo()) return true;
    if (this.raycastCustomObjects() !== null) return true;
    if (this.isPointerOnGumballHandle()) return true;

    return false;
  }

  /**
   * True while a Resonance-audio bounding-box gumball resize drag is active, or was
   * just released. Needed because useSpeckleBoundingBoxGumball.ts's pointerup listener
   * is registered on `document` with capture:true — an ancestor of the canvas — so its
   * stopPropagation() call (fired before the event reaches the canvas target) prevents
   * our own canvas-level handlePointerUp from ever running, meaning `wasOrbiting` never
   * gets set for that gesture. Without this check, the native 'click' that follows the
   * drag release would fall through to normal object selection.
   */
  private isBoundingBoxGumballDragging(): boolean {
    const { boundingBoxManager } = useSpeckleEngineStore.getState();
    return !!(boundingBoxManager?.isDragging || boundingBoxManager?.justFinishedDragging);
  }

  /** Raycasts the bounding-box gumball resize handles (separate TransformControls, not a custom object). */
  private isPointerOnGumballHandle(): boolean {
    try {
      const { boundingBoxManager } = useSpeckleEngineStore.getState();
      if (!boundingBoxManager || boundingBoxManager.gumballHandles.length === 0) return false;
      const camera = this.adapter.getCamera();
      this.raycaster.setFromCamera(this.mouse, camera);
      const intersects = this.raycaster.intersectObjects(boundingBoxManager.gumballHandles, false);
      return intersects.length > 0;
    } catch {
      return false;
    }
  }

  // ============================================================================
  // Box-select (left-click + drag)
  // ============================================================================

  private startBoxSelectTracking(startX: number, startY: number): void {
    this.boxSelectStartPos = { x: startX, y: startY };
    this.boxSelectActive = false;
    window.addEventListener('pointermove', this.onBoxSelectPointerMove);
    window.addEventListener('pointerup', this.onBoxSelectPointerUp);
  }

  private onBoxSelectPointerMove = (e: PointerEvent): void => {
    if (!this.boxSelectStartPos) return;

    // Left button no longer held (e.g. released outside the canvas) — bail out.
    if ((e.buttons & 1) === 0) {
      this.endBoxSelectTracking(e, false);
      return;
    }

    const dx = e.clientX - this.boxSelectStartPos.x;
    const dy = e.clientY - this.boxSelectStartPos.y;

    if (!this.boxSelectActive) {
      const thresholdSq = SpeckleEventBridge.DRAG_THRESHOLD_PX * SpeckleEventBridge.DRAG_THRESHOLD_PX;
      if (dx * dx + dy * dy < thresholdSq) return;
      this.boxSelectActive = true;
      this.createBoxSelectOverlay();
    }

    this.updateBoxSelectOverlay(this.boxSelectStartPos.x, this.boxSelectStartPos.y, e.clientX, e.clientY);
  };

  private onBoxSelectPointerUp = (e: PointerEvent): void => {
    this.endBoxSelectTracking(e, true);
  };

  private endBoxSelectTracking(e: PointerEvent, allowFinalize: boolean): void {
    window.removeEventListener('pointermove', this.onBoxSelectPointerMove);
    window.removeEventListener('pointerup', this.onBoxSelectPointerUp);

    if (allowFinalize && this.boxSelectActive && this.boxSelectStartPos) {
      this.finalizeBoxSelect(this.boxSelectStartPos.x, this.boxSelectStartPos.y, e.clientX, e.clientY);
    }

    this.removeBoxSelectOverlay();
    this.boxSelectStartPos = null;
    this.boxSelectActive = false;
  }

  private createBoxSelectOverlay(): void {
    if (this.boxSelectEl) return;
    const el = document.createElement('div');
    el.style.position = 'fixed';
    el.style.pointerEvents = 'none';
    el.style.zIndex = '9999';
    el.style.border = '1px solid var(--color-primary)';
    el.style.background = 'var(--color-primary-lighter)';
    document.body.appendChild(el);
    this.boxSelectEl = el;
  }

  private updateBoxSelectOverlay(x1: number, y1: number, x2: number, y2: number): void {
    if (!this.boxSelectEl) return;
    const left = Math.min(x1, x2);
    const top = Math.min(y1, y2);
    const width = Math.abs(x2 - x1);
    const height = Math.abs(y2 - y1);
    Object.assign(this.boxSelectEl.style, {
      left: `${left}px`,
      top: `${top}px`,
      width: `${width}px`,
      height: `${height}px`,
    });
  }

  private removeBoxSelectOverlay(): void {
    if (this.boxSelectEl) {
      this.boxSelectEl.remove();
      this.boxSelectEl = null;
    }
  }

  /**
   * Selects Speckle objects touched by the drag rectangle.
   *
   *  - Dragging left-to-right (x2 >= x1): "strict" mode — only objects whose
   *    projected screen AABB is FULLY contained inside the rectangle are selected.
   *  - Dragging right-to-left (x2 < x1): "crossing" mode — any object whose
   *    projected screen AABB merely overlaps the rectangle is selected.
   */
  private finalizeBoxSelect(x1: number, y1: number, x2: number, y2: number): void {
    const left = Math.min(x1, x2);
    const right = Math.max(x1, x2);
    const top = Math.min(y1, y2);
    const bottom = Math.max(y1, y2);
    const strictContainment = x2 >= x1;

    const ids = this.getObjectIdsInScreenRect(left, top, right, bottom, strictContainment);

    // Clear any custom-object (sound/receiver) selection a fresh box-select starts over.
    if (this.lastClickedObject) {
      if (this.onSelectionCleared) this.onSelectionCleared();
      this.lastClickedObject = null;
      this.lastClickedObjectKey = null;
    }

    this.selectionExtension.clearSelection();
    if (ids.length > 0) {
      this.selectionExtension.selectObjects(ids);
    }
    if (this.onSpeckleObjectSelected) {
      this.onSpeckleObjectSelected(ids);
    }
  }

  /**
   * Projects every loaded BatchObject's world AABB to screen space and tests it against
   * the given rect. When `strictContainment` is true, the object's full projected AABB
   * must fit inside the rect; otherwise any overlap qualifies.
   */
  private getObjectIdsInScreenRect(
    left: number,
    top: number,
    right: number,
    bottom: number,
    strictContainment: boolean
  ): string[] {
    try {
      const renderer = this.viewer.getRenderer() as any;
      const camera = this.adapter.getCamera();
      const canvas = renderer.renderer.domElement as HTMLCanvasElement;
      const canvasRect = canvas.getBoundingClientRect();
      const objects: any[] = typeof renderer.getObjects === 'function' ? renderer.getObjects() : [];

      const ids: string[] = [];
      const corner = new THREE.Vector3();
      const viewPos = new THREE.Vector3();

      for (const obj of objects) {
        const aabb: THREE.Box3 | undefined = obj?.aabb;
        const rv = obj?.renderView;
        const objectId: string | undefined = rv?.renderData?.id;
        if (!aabb || !objectId) continue;
        if (this.isObjectFilteredOut(objectId)) continue;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        let anyVisible = false;
        let allCornersVisible = true;

        for (let i = 0; i < 8; i++) {
          corner.set(
            i & 1 ? aabb.max.x : aabb.min.x,
            i & 2 ? aabb.max.y : aabb.min.y,
            i & 4 ? aabb.max.z : aabb.min.z
          );

          viewPos.copy(corner).applyMatrix4(camera.matrixWorldInverse);
          if (viewPos.z > 0) {
            allCornersVisible = false;
            continue; // behind the camera — skip this corner
          }

          anyVisible = true;
          const ndc = corner.clone().project(camera);
          const sx = canvasRect.left + (ndc.x * 0.5 + 0.5) * canvasRect.width;
          const sy = canvasRect.top + (-ndc.y * 0.5 + 0.5) * canvasRect.height;
          if (sx < minX) minX = sx;
          if (sx > maxX) maxX = sx;
          if (sy < minY) minY = sy;
          if (sy > maxY) maxY = sy;
        }

        if (!anyVisible) continue;

        if (strictContainment) {
          // Full projected AABB must fit inside the rect (and have all 8 corners
          // in front of the camera — a partially-behind-camera object can't be "fully inside").
          if (!allCornersVisible) continue;
          if (minX < left || maxX > right || minY < top || maxY > bottom) continue;
        } else {
          // Any overlap between the projected AABB and the rect qualifies.
          if (maxX < left || minX > right || maxY < top || minY > bottom) continue;
        }

        ids.push(objectId);
      }

      return ids;
    } catch (error) {
      console.error('[SpeckleEventBridge] getObjectIdsInScreenRect error:', error);
      return [];
    }
  }

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

    if (this.isBoundingBoxGumballDragging()) {
      return;
    }

    this.lastClickWasShift = event.shiftKey;

    this.updateMouseFromEvent(event);

    if (this.isClickOnGizmo()) {
      return;
    }

    const customHit = this.raycastCustomObjects();

    if (customHit) {
      event.stopPropagation();
      event.preventDefault();

      // Grid listener points: no gumball, no single-click side effects — only double-click matters
      if (customHit.type === 'grid-receiver') {
        this.clearVisualSelections();
        return;
      }

      // Only clear visuals (Speckle highlight + drag gizmo) without notifying React,
      // to avoid cascading state updates (bounding box, timeline, etc.)
      this.clearVisualSelections();
      if (this.onCustomObjectSelected) {
        this.onCustomObjectSelected(customHit.object, customHit.type as 'sound' | 'receiver');
      }

      // Debounce single-click side effects (card expansion, entity panel, etc.)
      // so they are cancelled if a double-click follows within 300ms.
      if (this.singleClickTimer) {
        clearTimeout(this.singleClickTimer);
      }
      this.pendingSingleClickData = { object: customHit.object, type: customHit.type as 'sound' | 'receiver' };
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

      if (customHit.type === 'grid-receiver') {
        this.clearVisualSelections();
        if (customHit.instanceId !== undefined && this.onGridListenerDoubleClicked) {
          this.onGridListenerDoubleClicked(customHit.instanceId);
        }
      } else {
        this.handleDoubleClick(customHit.object);
      }
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
    const transformControls = this.dragHandler.getTransformControls() as unknown as {
      object?: unknown;
      axis: string | null;
      pointerHover: (pointer: THREE.Vector2) => void;
    } | null;
    // A DETACHED TransformControls has no meaningful position, but THREE's raycaster
    // ignores the `visible` flag — its handle meshes stay wherever they were last
    // attached and remain raycastable forever otherwise, silently swallowing any
    // future click/drag that lands near that stale position.
    if (!transformControls || !transformControls.object) {
      return false;
    }

    // Delegate hit-testing to TransformControls' own `pointerHover()`, which raycasts
    // against `_gizmo.picker[this.mode]` (the small set of handle meshes for the
    // CURRENT mode only) using the library's own up-to-date matrices. Our previous
    // approach re-raycast the whole `_gizmo` group manually and proved unreliable
    // (logs showed intersects against a gizmo reporting world position [0,0,0] while
    // "attached", i.e. a stale/incorrectly-computed matrix), causing both false
    // negatives (stale gizmo blocking unrelated clicks) and false positives.
    transformControls.pointerHover(this.mouse);
    return transformControls.axis !== null;
  }

  private raycastCustomObjects(
    visibleOnly: boolean = false
  ): { type: 'sound' | 'receiver' | 'grid-receiver'; object: THREE.Object3D; instanceId?: number } | null {
    const camera = this.adapter.getCamera();
    this.raycaster.setFromCamera(this.mouse, camera);
    const customObjects = this.adapter.getCustomObjects();
    const targets = visibleOnly
      ? customObjects.filter((o) => o.visible)
      : customObjects;
    const intersects = this.raycaster.intersectObjects(targets, true);

    if (intersects.length === 0) return null;

    for (const intersect of intersects) {
      // InstancedMesh grid listener — use instanceId to identify the point
      if ((intersect.object as any).isInstancedMesh && intersect.object.userData.customObjectType === 'grid-receiver') {
        return { type: 'grid-receiver', object: intersect.object, instanceId: intersect.instanceId };
      }

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

  /**
   * Called by SpeckleAudioCoordinator when first-person (fly) mode is toggled.
   * While active, the button-remap and box-select logic is skipped entirely —
   * FPS mode uses a completely different (FlyControls) camera system.
   */
  public setFirstPersonModeActive(active: boolean): void {
    this.isFirstPersonModeActive = active;
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

  public setOnGridListenerDoubleClicked(callback: (instanceId: number) => void): void {
    this.onGridListenerDoubleClicked = callback;
  }

  /** Returns true if the last pointer gesture was a drag (orbit/pan), regardless of button. */
  public getWasOrbiting(): boolean {
    return this.wasOrbiting;
  }

  /** Returns true if a custom object (sound/receiver/grid-receiver) is under the given screen position. */
  public hasCustomObjectAt(clientX: number, clientY: number): boolean {
    const canvas = this.viewer.getRenderer().renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    const savedMouse = this.mouse.clone();
    this.mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    const hit = this.raycastCustomObjects();
    this.mouse.copy(savedMouse);
    return hit !== null;
  }

  /**
   * Returns true if a VISIBLE custom object (sound/receiver/grid-receiver) is
   * under the given screen position. Invisible objects are skipped, so the FPS
   * listener mesh (hidden while viewing through it) does not block the
   * camera-look / drag guard.
   */
  public hasVisibleCustomObjectAt(clientX: number, clientY: number): boolean {
    const canvas = this.viewer.getRenderer().renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    const savedMouse = this.mouse.clone();
    this.mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    const hit = this.raycastCustomObjects(true);
    this.mouse.copy(savedMouse);
    return hit !== null;
  }

  /**
   * Returns true if the drag gizmo (TransformControls) is under the given
   * screen position. Only true while a gizmo is actually attached to a selected
   * object — detached gizmos are invisible and ignored.
   */
  public hasGizmoAt(clientX: number, clientY: number): boolean {
    if (!this.dragHandler) return false;
    const transformControls = this.dragHandler.getTransformControls();
    if (!transformControls || !transformControls.object) return false;

    // Raycast ONLY the gizmo handle group (_gizmo). The TransformControls root
    // also contains a 100000×100000 invisible picking plane (_plane); THREE's
    // raycaster ignores the `visible` flag, so intersecting the root would
    // report a hit for almost any pointer once a gizmo is attached — blocking
    // the FPS camera-look everywhere. Invisible pickers/helpers inside the
    // handle group are excluded by the ancestry-visibility filter below.
    const gizmo = (transformControls as unknown as { _gizmo?: THREE.Object3D })._gizmo;
    if (!gizmo) return false;

    const canvas = this.viewer.getRenderer().renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    const savedMouse = this.mouse.clone();
    const savedLayers = this.raycaster.layers.mask;
    this.mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    const camera = this.adapter.getCamera();
    this.raycaster.setFromCamera(this.mouse, camera);
    // The gizmo children live on the PROPS layer — enable it alongside the
    // default layer so the raycaster can intersect them.
    this.raycaster.layers.enable(ObjectLayers.PROPS);
    const intersects = this.raycaster.intersectObject(gizmo, true);
    this.raycaster.layers.mask = savedLayers;
    this.mouse.copy(savedMouse);
    return intersects.some((i) => isObjectVisible(i.object));
  }

  public dispose(): void {
    if (this.singleClickTimer) {
      clearTimeout(this.singleClickTimer);
      this.singleClickTimer = null;
    }
    window.removeEventListener('pointermove', this.onBoxSelectPointerMove);
    window.removeEventListener('pointerup', this.onBoxSelectPointerUp);
    this.removeBoxSelectOverlay();
    this.boxSelectStartPos = null;
    this.boxSelectActive = false;
    try {
      this.cameraController.options = { ...SpeckleEventBridge.DEFAULT_CAMERA_OPTIONS };
    } catch {
      // non-critical — viewer may already be tearing down
    }
    try {
      // Not part of the public IViewer typings, but present at runtime (EventEmitter-based).
      (this.viewer as unknown as { off?: (event: string, cb: unknown) => void }).off?.(
        ViewerEvent.ObjectClicked,
        this.handleViewerObjectClicked
      );
    } catch {
      // non-critical — viewer may already be tearing down
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
    this.onGridListenerDoubleClicked = null;
    this.onSpeckleObjectSelected = null;
    this.lastClickedObject = null;
    this.pendingSingleClickData = null;
  }
}
