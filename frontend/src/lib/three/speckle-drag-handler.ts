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
  private dummyAnchor: THREE.Object3D = new THREE.Object3D();
  private lastGizmoPosition: THREE.Vector3 = new THREE.Vector3();
  private isInitialized: boolean = false;
  
  // Current selection
  private selectedObjects: THREE.Object3D[] = [];
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
        this.cameraController.enabled = !val;
        this.justFinishedDragging = false;
        if (this.onDragStartCallback) {
          this.onDragStartCallback(this.selectedObjects);
        }
      } else {
        setTimeout(() => {
          // Don't re-enable Speckle's camera while the FPS camera is locked to
          // a listener — re-enabling would let the (FlyControls-based) FPS
          // controller overwrite the direct FPS camera writes and corrupt the
          // view. The coordinator supplies the lock predicate.
          if (!(this.onCameraLockedCheck?.() ?? false)) {
            this.cameraController.enabled = !val;
          }
        }, 100);

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
   * Handle anchor (gizmo) position changes and apply to selected objects
   */
  private onAnchorChanged(): void {
    if (this.selectedObjects.length === 0) return;

    // Calculate the delta movement
    const anchorPos = this.dummyAnchor.position.clone();

    // Surface-constrained markers: instead of applying the free gizmo delta,
    // re-project the marker onto the linked object's surface. The gizmo stays
    // as the handle; only the snap point drives the object position.
    if (this.selectedObjects.some((o) => this.isSurfaceMarker(o))) {
      for (const obj of this.selectedObjects) {
        if (this.isSurfaceMarker(obj)) this.snapMarkerToSurface(obj);
        else obj.position.add(anchorPos.clone().sub(this.lastGizmoPosition));
      }
      this.lastGizmoPosition.copy(this.dummyAnchor.position);
      if (this.onDragCallback) {
        this.onDragCallback(this.selectedObjects, new THREE.Vector3());
      }
      this.viewer.requestRender();
      return;
    }

    // Apply translation to all selected objects
    const delta = anchorPos.clone().sub(this.lastGizmoPosition);
    for (const obj of this.selectedObjects) {
      obj.position.add(delta);
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
   * camera through the gizmo anchor's screen position. Only hits on the marker's
   * linked object ids are accepted; the marker is oriented to the hit normal.
   * @returns true when a surface hit was applied.
   */
  private snapMarkerToSurface(object: THREE.Object3D): boolean {
    const allowed = this.collectAllowedRenderIds(object);
    if (allowed.size === 0) return false;

    const renderer: any = this.viewer.getRenderer();
    const camera = renderer.renderingCamera;
    if (!camera) return false;

    const ndc = this.dummyAnchor.position.clone().project(camera);
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
      this.dummyAnchor.position.copy(object.position);
      this.lastGizmoPosition.copy(this.dummyAnchor.position);
      return true;
    }
    return false;
  }

  public selectObjects(objects: THREE.Object3D[]): void {
    if (!this.isInitialized) {
      this.init();
    }

    if (objects.length === 0) {
      this.deselectObjects();
      return;
    }

    const object = objects[0];
    this.selectedObjects = [object];
    if (object.userData?.isSurfaceMarker) {
      // Invisible marker proxy — its own position IS the anchor (an empty group
      // has no AABB, so Box3.getCenter would be NaN).
      this.dummyAnchor.position.copy(object.position);
    } else {
      const box = new THREE.Box3().setFromObject(object);
      const center = box.getCenter(new THREE.Vector3());
      this.dummyAnchor.position.copy(center);
    }
    this.lastGizmoPosition.copy(this.dummyAnchor.position);

    if (this.transformControls) {
      this.configureGizmoAxes(object);
      this.transformControls.attach(this.dummyAnchor);
    }
  }

  /**
   * Hide the gizmo axis that is normal to the marker's surface. A large-object
   * marker is constrained to its object's surface, so the perpendicular handle
   * has no meaning and only invites the user to pull the light off the surface.
   * The normal is probed from the actual surface hit (world space) rather than
   * assumed from a fixed up-axis, so it works regardless of the model's Y/Z
   * convention.
   */
  private configureGizmoAxes(object: THREE.Object3D): void {
    const tc = this.transformControls;
    if (!tc) return;
    if (object.userData?.isSurfaceMarker) {
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
    if (this.transformControls) {
      this.transformControls.showX = true;
      this.transformControls.showY = true;
      this.transformControls.showZ = true;
      this.transformControls.detach();
    }
  }

  /**
   * Reposition the gizmo anchor onto the currently selected object's current
   * center.  Called every frame so the gizmo follows its object when the
   * position changes from another controller (e.g. undo/redo, external drag)
   * instead of floating detached at the previous position.
   * No-op while the user is dragging.
   */
  public syncAnchorToSelection(): void {
    if (this.isDragging || this.selectedObjects.length === 0) return;
    const object = this.selectedObjects[0];
    if (!object) return;
    const center = object.userData?.isSurfaceMarker
      ? object.position.clone()
      : new THREE.Box3().setFromObject(object).getCenter(new THREE.Vector3());
    if (this.dummyAnchor.position.distanceTo(center) > 0.0001) {
      this.dummyAnchor.position.copy(center);
      this.dummyAnchor.updateMatrixWorld();
      this.lastGizmoPosition.copy(center);
    }
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
    return this.isDragging;
  }

  public getJustFinishedDragging(): boolean {
    return this.justFinishedDragging;
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
