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
          this.cameraController.enabled = !val;
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
    const delta = anchorPos.sub(this.lastGizmoPosition);

    // Apply translation to all selected objects
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
    const box = new THREE.Box3().setFromObject(object);
    const center = box.getCenter(new THREE.Vector3());
    this.dummyAnchor.position.copy(center);
    this.lastGizmoPosition.copy(this.dummyAnchor.position);

    if (this.transformControls) {
      this.transformControls.attach(this.dummyAnchor);
    }
  }

  public deselectObjects(): void {
    this.selectedObjects = [];
    if (this.transformControls) {
      this.transformControls.detach();
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
