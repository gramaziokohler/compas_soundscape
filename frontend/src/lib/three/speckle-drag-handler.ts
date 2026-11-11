/**
 * SpeckleDragHandler
 *
 * Manages drag controls with TransformControls (axis helpers/gizmo) for custom objects 
 * (sound spheres, receivers) in the Speckle viewer.
 * 
 * This handler provides intuitive dragging capabilities using a 3D gizmo while ensuring 
 * proper integration with Speckle's camera controls.
 *
 * Usage:
 * ```typescript
 * // 1. Create the handler
 * const dragHandler = new SpeckleDragHandler(viewer, adapter, cameraController);
 * 
 * // 2. Set up callbacks
 * dragHandler.setOnDragEnd((objects, position) => {
 *   console.log('Drag ended at:', position);
 * });
 * 
 * // 3. Select objects to show the gizmo (e.g., on click)
 * dragHandler.selectObjects([soundSphere]);
 * 
 * // 4. User can now drag the object using the visible gizmo
 * // 5. Deselect when clicking elsewhere
 * dragHandler.deselectObjects();
 * ```
 *
 * Responsibilities:
 * - Enable/disable transform controls for custom objects
 * - Temporarily disable CameraController during drag operations
 * - Update draggable objects when scene changes
 * - Provide callbacks for drag events (start, drag, end)
 *
 * References:
 * - Speckle object manipulation: https://docs.speckle.systems/developers/viewer/examples/object-manipulation-example
 * - Three.js TransformControls: https://threejs.org/docs/#examples/en/controls/TransformControls
 */

import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { Viewer, CameraController } from '@speckle/viewer';
import { ObjectLayers } from '@speckle/viewer';
import type { SpeckleSceneAdapter } from './speckle-scene-adapter';
import { CustomSelectionHighlight } from './custom-selection-highlight';
import { isShareViewActive } from '@/store/shareViewStore';
import { GumballRotationArcs, GUMBALL_AXIS_VECTORS, type GumballAxis } from './gumball-rotation-arcs';
import { attachTranslateClickPrompt } from './gumball-translate-prompt';
import { resolveOrientationTarget } from './audio-object-orientation';
import { selectionPivot } from './gumball-selection-bounds';

/**
 * SpeckleDragHandler class
 *
 * Provides drag functionality for custom audio objects using TransformControls gizmo
 * while respecting Speckle's camera control system.
 */
export class SpeckleDragHandler {
  private viewer: Viewer;
  private adapter: SpeckleSceneAdapter;
  private cameraController: CameraController;

  // Transform controls and gizmo
  private transformControls: TransformControls | null = null;
  /** Rhino-style rotation arcs shown with the translate arrows (single orientable selection). */
  private rotationArcs: GumballRotationArcs | null = null;
  private detachTranslatePrompt: (() => void) | null = null;
  private dummyAnchor: THREE.Object3D = new THREE.Object3D();
  private lastGizmoPosition: THREE.Vector3 = new THREE.Vector3();
  private isInitialized: boolean = false;
  
  // Current selection (several objects share one gizmo in a multi-selection)
  private selectedObjects: THREE.Object3D[] = [];
  private selectionHighlight: CustomSelectionHighlight | null = null;
  private isDragging: boolean = false;
  private justFinishedDragging: boolean = false;

  // Callbacks
  private onDragStartCallback: ((objects: THREE.Object3D[]) => void) | null = null;
  private onDragCallback: ((objects: THREE.Object3D[], delta: THREE.Vector3) => void) | null = null;
  private onDragEndCallback: ((objects: THREE.Object3D[], position: THREE.Vector3) => void) | null = null;

  // When true (e.g. first-person mode is active), the camera controller must
  // stay disabled after a drag ends — re-enabling it would let the active
  // controls overwrite the directly-written FPS camera.
  private onCameraLockedCheck: (() => boolean) | null = null;

  /**
   * Create a new SpeckleDragHandler
   * @param viewer - Speckle viewer instance
   * @param adapter - SpeckleSceneAdapter for accessing scene and custom objects
   * @param cameraController - Speckle's CameraController to disable during drag
   */
  constructor(
    viewer: Viewer,
    adapter: SpeckleSceneAdapter,
    cameraController: CameraController
  ) {
    this.viewer = viewer;
    this.adapter = adapter;
    this.cameraController = cameraController;
  }

  public init(): void {
    if (this.isInitialized) return;
    this.dummyAnchor.layers.set(ObjectLayers.PROPS);
    this.viewer.getRenderer().scene.add(this.dummyAnchor);
    this.selectionHighlight = new CustomSelectionHighlight(this.viewer.getRenderer().scene);
    this.initGizmo();
  }

  private initGizmo(): void {
    const camera = this.viewer.getRenderer().renderingCamera;
    if (!camera) throw new Error('Cannot init move gizmo with no camera');

    this.transformControls = new TransformControls(camera, this.viewer.getRenderer().renderer.domElement);
    this.transformControls.setSize(0.5);

    this.transformControls.addEventListener('change', () => {
      this.viewer.requestRender();
    });

    this.transformControls.addEventListener('dragging-changed', (event) => {
      const val = !!event.value;
      this.isDragging = val;

      if (val) {
        this.setCameraEnabledAfterDrag(false);
        this.justFinishedDragging = false;
        if (this.onDragStartCallback) {
          this.onDragStartCallback(this.selectedObjects);
        }
      } else {
        this.setCameraEnabledAfterDrag(true);

        this.justFinishedDragging = true;
        setTimeout(() => {
          this.justFinishedDragging = false;
        }, 200);

        if (this.onDragEndCallback) {
          this.onDragEndCallback(this.selectedObjects, this.dummyAnchor.position.clone());
        }
      }
    });

    this.transformControls.addEventListener('objectChange', () => {
      this.onAnchorChanged();
    });

    const scene = this.viewer.getRenderer().scene;
    scene.add(this.transformControls as any);

    this.detachTranslatePrompt = attachTranslateClickPrompt(this.transformControls, (axis, distance, origin) =>
      this.applyNumericTranslation(axis, distance, origin),
    );
    this.rotationArcs = new GumballRotationArcs(scene, {
      canvas: this.viewer.getRenderer().renderer.domElement,
      getCamera: () => this.viewer.getRenderer().renderingCamera ?? null,
      getTransformControls: () => this.transformControls,
      getAnchor: () => this.dummyAnchor,
      getSelection: () => this.selectedObjects,
      resolveOrientation: resolveOrientationTarget,
      placeObject: (object, position) => this.placeRotatedObject(object, position),
      commitPositions: (objects) => this.onDragEndCallback?.(objects, this.dummyAnchor.position.clone()),
      setCameraEnabled: (enabled) => this.setCameraEnabledAfterDrag(enabled),
      requestRender: () => this.viewer.requestRender(),
    });

    requestAnimationFrame(() => {
      if (!this.transformControls) return;

      // Cast to any since TransformControls extends Object3D but TypeScript types don't expose children
      const controlsAsObject = this.transformControls as unknown as THREE.Object3D;
      if (controlsAsObject.children && controlsAsObject.children.length > 0) {
        for (let k = 0; k < controlsAsObject.children.length; k++) {
          controlsAsObject.children[k].traverse((obj) => {
            obj.layers.set(ObjectLayers.PROPS);
          });
        }
      }

      if (this.transformControls.getRaycaster()) {
        this.transformControls.getRaycaster().layers.set(ObjectLayers.PROPS);
      }
    });

    this.isInitialized = true;
  }

  /**
   * Freeze Speckle's camera for a gizmo drag, or release it shortly after. Never
   * re-enables it while the FPS camera is locked to a listener — re-enabling would
   * let the (FlyControls-based) FPS controller overwrite the direct FPS camera
   * writes and corrupt the view. The coordinator supplies the lock predicate.
   */
  private setCameraEnabledAfterDrag(enabled: boolean): void {
    if (!enabled) {
      this.cameraController.enabled = false;
      return;
    }
    setTimeout(() => {
      if (!(this.onCameraLockedCheck?.() ?? false)) {
        this.cameraController.enabled = true;
      }
    }, 100);
  }

  /**
   * Move the selection so the gizmo sits at `origin + axis * distance` (typed in
   * the click-to-type prompt) and commit it like the end of a drag.
   */
  private applyNumericTranslation(axis: GumballAxis, distance: number, origin: THREE.Vector3): void {
    if (this.selectedObjects.length === 0) return;
    this.dummyAnchor.position.copy(origin).addScaledVector(GUMBALL_AXIS_VECTORS[axis], distance);
    this.dummyAnchor.updateMatrixWorld();
    this.onAnchorChanged();
    this.onDragEndCallback?.(this.selectedObjects, this.dummyAnchor.position.clone());
    this.viewer.requestRender();
  }

  /**
   * Move one object to a position computed by the rotation arcs. A surface marker
   * is re-snapped onto its surface and stays put when no surface lies there
   * (same rule as a multi-selection translate).
   */
  private placeRotatedObject(object: THREE.Object3D, position: THREE.Vector3): void {
    const previous = object.position.clone();
    object.position.copy(position);
    if (this.isSurfaceMarker(object) && !this.snapMarkerToSurface(object, object.position, false)) {
      object.position.copy(previous);
    }
  }

  /**
   * Handle anchor (gizmo) position changes and apply to selected objects
   */
  private onAnchorChanged(): void {
    if (this.selectedObjects.length === 0) return;

    // Calculate the delta movement
    const anchorPos = this.dummyAnchor.position.clone();

    // Single surface-constrained marker: instead of applying the free gizmo
    // delta, re-project the marker onto the linked object's surface. The gizmo
    // stays as the handle; only the snap point drives the object position.
    const single = this.selectedObjects.length === 1 ? this.selectedObjects[0] : null;
    if (single && this.isSurfaceMarker(single)) {
      this.snapMarkerToSurface(single, this.dummyAnchor.position, true);
      this.lastGizmoPosition.copy(this.dummyAnchor.position);
      if (this.onDragCallback) {
        this.onDragCallback(this.selectedObjects, new THREE.Vector3());
      }
      this.viewer.requestRender();
      return;
    }

    // Apply translation to all selected objects. In a multi-selection, surface
    // markers follow the delta and are then re-snapped onto their surface; if
    // no surface lies under the moved point, the marker stays where it was.
    const delta = anchorPos.clone().sub(this.lastGizmoPosition);
    for (const obj of this.selectedObjects) {
      obj.position.add(delta);
      if (this.isSurfaceMarker(obj) && !this.snapMarkerToSurface(obj, obj.position, false)) {
        obj.position.sub(delta);
      }
    }

    // Update last position
    this.lastGizmoPosition.copy(this.dummyAnchor.position);

    // Call drag callback
    if (this.onDragCallback) {
      this.onDragCallback(this.selectedObjects, delta);
    }

    // Request render
    this.viewer.requestRender();
  }

  private isSurfaceMarker(obj: THREE.Object3D): boolean {
    return obj.userData?.isSurfaceMarker === true;
  }

  /**
   * Expand a marker's linked object ids to the render-space ids reported by the
   * intersection raycaster (`renderView.renderData.id`).
   *
   * A linked id is a world-tree host id (e.g. a BIM element with `displayValue`),
   * which is non-atomic — its geometry lives on descendant display meshes. The
   * renderer assigns `renderData.id = node.model.id`, so the raycast returns the
   * descendant mesh ids, never the host id. Comparing the raw linked ids alone
   * therefore rejects every hit and the marker never moves. Resolving each linked
   * id through the render tree yields the atomic ids that actually get hit.
   */
  private collectAllowedRenderIds(object: THREE.Object3D): Set<string> {
    const surfaceIds: string[] | undefined = object.userData?.surfaceObjectIds;
    if (!surfaceIds || surfaceIds.length === 0) return new Set();

    const allowed = new Set<string>(surfaceIds);
    try {
      const renderTree: any = (this.viewer.getWorldTree?.() as any)?.getRenderTree?.();
      if (renderTree?.getRenderViewsForNodeId) {
        for (const id of surfaceIds) {
          const rvs: any[] = renderTree.getRenderViewsForNodeId(id) ?? [];
          for (const rv of rvs) {
            const renderId = rv?.renderData?.id;
            if (renderId) allowed.add(renderId);
            const subtreeId = rv?.renderData?.subtreeId;
            if (subtreeId) allowed.add(subtreeId);
          }
        }
      }
    } catch {
      // Fall back to the raw linked ids.
    }
    return allowed;
  }

  /**
   * Snap a surface marker to the linked object's surface by raycasting from the
   * camera through `probe`'s screen position (the gizmo anchor for a single
   * marker, the marker's own moved position in a multi-selection). Only hits on
   * the marker's linked object ids are accepted; the marker is oriented to the
   * hit normal. `moveAnchor` re-centers the gizmo on the snapped marker.
   * @returns true when a surface hit was applied.
   */
  private snapMarkerToSurface(object: THREE.Object3D, probe: THREE.Vector3, moveAnchor: boolean): boolean {
    const allowed = this.collectAllowedRenderIds(object);
    if (allowed.size === 0) return false;

    const renderer: any = this.viewer.getRenderer();
    const camera = renderer.renderingCamera;
    if (!camera) return false;

    const ndc = probe.clone().project(camera);
    let hits: any[] = [];
    try {
      hits = renderer.intersections.intersect(
        renderer.scene,
        camera,
        new THREE.Vector2(ndc.x, ndc.y),
        ObjectLayers.STREAM_CONTENT_MESH,
        false
      ) || [];
    } catch {
      return false;
    }

    for (const hit of hits) {
      let rv: any = null;
      try {
        const pair = renderer.renderViewFromIntersection?.(hit);
        rv = pair?.[0];
      } catch {
        rv = null;
      }
      const objId: string | undefined = rv?.renderData?.id;
      if (!objId || !allowed.has(objId)) continue;

      const point: THREE.Vector3 = hit.point instanceof THREE.Vector3
        ? hit.point
        : new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z);

      let normal = new THREE.Vector3(0, 0, 1);
      if (hit.face?.normal) {
        normal = new THREE.Vector3(hit.face.normal.x, hit.face.normal.y, hit.face.normal.z)
          .transformDirection(hit.object.matrixWorld)
          .normalize();
      }

      // Lift slightly off the surface so the marker ring does not z-fight it.
      object.position.copy(point).addScaledVector(normal, 0.01);
      object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
      if (moveAnchor) {
        this.dummyAnchor.position.copy(object.position);
        this.lastGizmoPosition.copy(this.dummyAnchor.position);
      }
      return true;
    }
    return false;
  }

  public selectObjects(objects: THREE.Object3D[]): void {
    if (!this.isInitialized) {
      this.init();
    }

    const unique = Array.from(new Set(objects));
    if (unique.length === 0) {
      this.deselectObjects();
      return;
    }

    // One shared gizmo at the selection's center moves every selected object.
    this.selectedObjects = unique;
    this.dummyAnchor.position.copy(this.computeSelectionCenter());
    this.lastGizmoPosition.copy(this.dummyAnchor.position);
    this.selectionHighlight?.set(unique);

    // Share view: sounds / listeners are never moved — highlight only, no gizmo.
    if (this.transformControls && !isShareViewActive()) {
      this.configureGizmoAxes(unique);
      this.transformControls.attach(this.dummyAnchor);
    }
    this.rotationArcs?.update();
  }

  /** Gizmo anchor / rotation pivot: center of the selection's (union) bounding box. */
  private computeSelectionCenter(): THREE.Vector3 {
    return selectionPivot(this.selectedObjects);
  }

  /**
   * Hide the gizmo axis that is normal to the marker's surface. A large-object
   * marker is constrained to its object's surface, so the perpendicular handle
   * has no meaning and only invites the user to pull the light off the surface.
   * The normal is probed from the actual surface hit (world space) rather than
   * assumed from a fixed up-axis, so it works regardless of the model's Y/Z
   * convention. A multi-selection always shows all three axes.
   */
  private configureGizmoAxes(objects: THREE.Object3D[]): void {
    const tc = this.transformControls;
    if (!tc) return;
    const object = objects.length === 1 ? objects[0] : null;
    if (object?.userData?.isSurfaceMarker) {
      const normal = this.probeSurfaceNormal(object);
      if (normal) {
        const ax = Math.abs(normal.x);
        const ay = Math.abs(normal.y);
        const az = Math.abs(normal.z);
        const hide = ax >= ay && ax >= az ? 'x' : ay >= az ? 'y' : 'z';
        tc.showX = hide !== 'x';
        tc.showY = hide !== 'y';
        tc.showZ = hide !== 'z';
      } else {
        tc.showX = true;
        tc.showY = true;
        tc.showZ = true;
      }
    } else {
      tc.showX = true;
      tc.showY = true;
      tc.showZ = true;
    }
  }

  /**
   * Raycast from the camera through the marker and return the surface-normal of
   * the linked object at that point (world space), or null if not hit.
   */
  private probeSurfaceNormal(object: THREE.Object3D): THREE.Vector3 | null {
    const allowed = this.collectAllowedRenderIds(object);
    if (allowed.size === 0) return null;

    const renderer: any = this.viewer.getRenderer();
    const camera = renderer.renderingCamera;
    if (!camera) return null;

    const ndc = object.position.clone().project(camera);
    let hits: any[] = [];
    try {
      hits = renderer.intersections.intersect(
        renderer.scene,
        camera,
        new THREE.Vector2(ndc.x, ndc.y),
        ObjectLayers.STREAM_CONTENT_MESH,
        false
      ) || [];
    } catch {
      return null;
    }

    for (const hit of hits) {
      let rv: any = null;
      try {
        rv = renderer.renderViewFromIntersection?.(hit)?.[0];
      } catch {
        rv = null;
      }
      const objId: string | undefined = rv?.renderData?.id;
      if (!objId || !allowed.has(objId)) continue;
      if (hit.face?.normal) {
        return new THREE.Vector3(hit.face.normal.x, hit.face.normal.y, hit.face.normal.z)
          .transformDirection(hit.object.matrixWorld)
          .normalize();
      }
    }
    return null;
  }

  public deselectObjects(): void {
    this.selectedObjects = [];
    this.selectionHighlight?.clear();
    if (this.transformControls) {
      this.transformControls.showX = true;
      this.transformControls.showY = true;
      this.transformControls.showZ = true;
      this.transformControls.detach();
    }
    this.rotationArcs?.update();
  }

  /**
   * Reposition the gizmo anchor onto the current selection's center.  Called
   * every frame so the gizmo follows its objects when their positions change
   * from another controller (e.g. undo/redo, external drag) instead of floating
   * detached at the previous position. Multi-selection outlines are refreshed
   * too (objects are screen-space scaled). Anchor sync is skipped while dragging.
   */
  public syncAnchorToSelection(): void {
    if (this.selectedObjects.length === 0) return;
    this.selectionHighlight?.update();
    // Keep the anchor (= rotation pivot) fixed during translate and rotate drags.
    if (!this.getIsDragging()) {
      const center = this.computeSelectionCenter();
      if (this.dummyAnchor.position.distanceTo(center) > 0.0001) {
        this.dummyAnchor.position.copy(center);
        this.dummyAnchor.updateMatrixWorld();
        this.lastGizmoPosition.copy(center);
      }
    }
    this.rotationArcs?.update();
  }

  /** Axis of the rotation arc under the NDC pointer (event-bridge gizmo hit test). */
  public hitTestRotationArc(ndc: THREE.Vector2): GumballAxis | null {
    return this.rotationArcs?.hitTest(ndc) ?? null;
  }

  public setOnDragStart(callback: (objects: THREE.Object3D[]) => void): void {
    this.onDragStartCallback = callback;
  }

  public setOnDrag(callback: (objects: THREE.Object3D[], delta: THREE.Vector3) => void): void {
    this.onDragCallback = callback;
  }

  public setOnDragEnd(callback: (objects: THREE.Object3D[], position: THREE.Vector3) => void): void {
    this.onDragEndCallback = callback;
  }

  /**
   * Set a predicate returning true while the camera must stay locked (e.g. FPS
   * mode). When it returns true, the camera controller is NOT re-enabled after
   * a drag ends, so the FPS camera's direct writes are never overwritten.
   */
  public setOnCameraLocked(callback: (() => boolean) | null): void {
    this.onCameraLockedCheck = callback;
  }

  public getIsDragging(): boolean {
    return this.isDragging || (this.rotationArcs?.isDragging() ?? false);
  }

  public getJustFinishedDragging(): boolean {
    return this.justFinishedDragging || (this.rotationArcs?.getJustFinishedDragging() ?? false);
  }

  public getSelectedObjects(): THREE.Object3D[] {
    return this.selectedObjects;
  }

  public getTransformControls(): TransformControls | null {
    return this.transformControls;
  }

  public setMode(mode: 'translate' | 'rotate' | 'scale'): void {
    if (this.transformControls) {
      this.transformControls.setMode(mode);
    }
  }

  public setGizmoSize(size: number): void {
    if (this.transformControls) {
      this.transformControls.setSize(size);
    }
  }

  public dispose(): void {
    this.deselectObjects();
    this.selectionHighlight = null;

    this.detachTranslatePrompt?.();
    this.detachTranslatePrompt = null;
    this.rotationArcs?.dispose();
    this.rotationArcs = null;

    if (this.transformControls) {
      const scene = this.adapter.getScene();
      scene.remove(this.transformControls as unknown as THREE.Object3D);
      this.transformControls.dispose();
      this.transformControls = null;
    }

    if (this.dummyAnchor.parent) {
      this.dummyAnchor.parent.remove(this.dummyAnchor);
    }

    this.onDragStartCallback = null;
    this.onDragCallback = null;
    this.onDragEndCallback = null;
    this.isDragging = false;
    this.selectedObjects = [];
  }
}
