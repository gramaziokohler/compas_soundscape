/**
 * GumballRotationArcs
 *
 * Rhino-style rotation arcs added to the sound / listener gizmo
 * (SpeckleDragHandler's TransformControls): one colored quarter arc per world
 * axis (X red, Y green, Z blue, matching the translate arrows), each lying in the
 * plane it rotates and sitting between the arrows. Arcs always face the camera's
 * quadrant so they are never hidden behind the anchor.
 *
 * - Drag an arc → rotates the selection about that world axis through the center
 *   of the selection's bounding box (the gizmo anchor): positions orbit the pivot
 *   and every orientable object (listener, directional sound) turns with it.
 *   Live store writes; one undo step per gesture, see undoRedoRegistry.
 * - Click an arc (quick press, no move) → numeric prompt "Rotate Z [ ] °".
 * - Holding the press without moving does nothing.
 *
 * Arcs show for any multi-selection, and for a single object with an editable
 * orientation (a lone omni sound has nothing to rotate).
 *
 * Usage (SpeckleDragHandler):
 * ```ts
 * const arcs = new GumballRotationArcs(scene, { canvas, getCamera, getTransformControls, getAnchor, getTarget, ... });
 * arcs.update();          // every frame
 * arcs.hitTest(ndc);      // event bridge gizmo hit test
 * arcs.dispose();
 * ```
 */

import * as THREE from 'three';
import type { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { ObjectLayers } from '@speckle/viewer';
import { GUMBALL } from '@/utils/constants';
import { rotateOrientation, type YawPitchRoll } from './orientation';
import type { OrientationTarget } from './audio-object-orientation';
import { ClickGesture } from './gumball-click-gesture';
import { openGumballNumericPrompt } from './gumball-numeric-prompt';

export type GumballAxis = 'X' | 'Y' | 'Z';

export const GUMBALL_AXIS_VECTORS: Record<GumballAxis, THREE.Vector3> = {
  X: new THREE.Vector3(1, 0, 0),
  Y: new THREE.Vector3(0, 1, 0),
  Z: new THREE.Vector3(0, 0, 1),
};

export function isGumballAxis(axis: string | null | undefined): axis is GumballAxis {
  return axis === 'X' || axis === 'Y' || axis === 'Z';
}

/** Maps the XY-plane torus into the plane each arc rotates (normal = its axis). */
const PLANE_BASIS: Record<GumballAxis, THREE.Matrix4> = {
  X: new THREE.Matrix4().makeBasis(GUMBALL_AXIS_VECTORS.Y, GUMBALL_AXIS_VECTORS.Z, GUMBALL_AXIS_VECTORS.X),
  Y: new THREE.Matrix4().makeBasis(GUMBALL_AXIS_VECTORS.Z, GUMBALL_AXIS_VECTORS.X, GUMBALL_AXIS_VECTORS.Y),
  Z: new THREE.Matrix4(),
};

const AXES: GumballAxis[] = ['X', 'Y', 'Z'];
const DEG = Math.PI / 180;

function buildArcGeometry(axis: GumballAxis, tube: number): THREE.BufferGeometry {
  const start = GUMBALL.ROTATION_ARC_START_DEG * DEG;
  const span = (GUMBALL.ROTATION_ARC_END_DEG - GUMBALL.ROTATION_ARC_START_DEG) * DEG;
  const geometry = new THREE.TorusGeometry(GUMBALL.ROTATION_ARC_RADIUS, tube, 6, 32, span);
  geometry.rotateZ(start);
  geometry.applyMatrix4(PLANE_BASIS[axis]);
  return geometry;
}

interface ArcHandle {
  axis: GumballAxis;
  material: THREE.MeshBasicMaterial;
  visual: THREE.Mesh;
  picker: THREE.Mesh;
  /** False while the arc's plane is edge-on to the camera. */
  usable: boolean;
}

export interface GumballRotationArcsDeps {
  canvas: HTMLCanvasElement;
  getCamera: () => THREE.Camera | null;
  getTransformControls: () => TransformControls | null;
  /** Gizmo anchor = selection bounding-box center = rotation pivot / arc center. */
  getAnchor: () => THREE.Object3D;
  /** Objects the gizmo is attached to. */
  getSelection: () => THREE.Object3D[];
  /** Orientation accessor of one object, or null when it has none (omni sound). */
  resolveOrientation: (object: THREE.Object3D) => OrientationTarget | null;
  /** Move one object to a rotated position (surface markers re-snap or stay). */
  placeObject: (object: THREE.Object3D, position: THREE.Vector3) => void;
  /** Commit the objects' current positions (same path as the end of a gizmo drag). */
  commitPositions: (objects: THREE.Object3D[]) => void;
  /** Freeze / release Speckle's camera controls around a drag. */
  setCameraEnabled: (enabled: boolean) => void;
  requestRender: () => void;
}

/** State of the selection when a rotation starts; every step rotates from it. */
interface RotationSnapshot {
  pivot: THREE.Vector3;
  items: Array<{
    object: THREE.Object3D;
    startPosition: THREE.Vector3;
    orientation: OrientationTarget | null;
    startOrientation: YawPitchRoll | null;
  }>;
}

interface ArcDrag {
  axis: GumballAxis;
  snapshot: RotationSnapshot;
  plane: THREE.Plane;
  prev: THREE.Vector3;
  angle: number;
  downX: number;
  downY: number;
  moved: boolean;
}

export class GumballRotationArcs {
  private readonly group = new THREE.Group();
  private readonly arcs: ArcHandle[];
  private readonly raycaster = new THREE.Raycaster();
  private readonly gesture = new ClickGesture();
  private hovered: GumballAxis | null = null;
  private drag: ArcDrag | null = null;
  private justFinished = false;
  private justFinishedTimer: ReturnType<typeof setTimeout> | null = null;
  private setCursor = false;

  constructor(private readonly scene: THREE.Scene, private readonly deps: GumballRotationArcsDeps) {
    this.group.name = 'GumballRotationArcs';
    this.group.visible = false;
    this.raycaster.layers.set(ObjectLayers.PROPS);

    this.arcs = AXES.map((axis) => {
      const material = new THREE.MeshBasicMaterial({
        color: GUMBALL.AXIS_COLORS[axis],
        transparent: true,
        opacity: GUMBALL.ROTATION_ARC_OPACITY,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      const visual = new THREE.Mesh(buildArcGeometry(axis, GUMBALL.ROTATION_ARC_TUBE), material);
      const picker = new THREE.Mesh(
        buildArcGeometry(axis, GUMBALL.ROTATION_ARC_PICK_TUBE),
        new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }),
      );
      for (const mesh of [visual, picker]) {
        mesh.renderOrder = GUMBALL.RENDER_ORDER;
        mesh.frustumCulled = false;
        mesh.layers.set(ObjectLayers.PROPS);
        this.group.add(mesh);
      }
      return { axis, material, visual, picker, usable: true };
    });

    this.group.layers.set(ObjectLayers.PROPS);
    scene.add(this.group);

    deps.canvas.addEventListener('pointerdown', this.onPointerDown, true);
    deps.canvas.addEventListener('pointermove', this.onHoverMove, true);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  public isDragging(): boolean {
    return this.drag !== null;
  }

  public getJustFinishedDragging(): boolean {
    return this.justFinished;
  }

  /** Axis of the arc under the given NDC pointer, or null. */
  public hitTest(ndc: THREE.Vector2): GumballAxis | null {
    if (!this.group.visible) return null;
    const camera = this.deps.getCamera();
    if (!camera) return null;
    this.raycaster.setFromCamera(ndc, camera);
    const pickers = this.arcs.filter((a) => a.usable).map((a) => a.picker);
    const hit = this.raycaster.intersectObjects(pickers, false)[0];
    if (!hit) return null;
    return this.arcs.find((a) => a.picker === hit.object)?.axis ?? null;
  }

  /** Place / size / show the arcs to match the gizmo. Call every frame. */
  public update(): void {
    const camera = this.deps.getCamera();
    const tc = this.deps.getTransformControls();
    const visible = !!camera && !!tc && !!tc.object && tc.mode === 'translate'
      && (this.drag !== null || this.canRotateSelection());
    this.group.visible = visible;
    if (!visible || !camera || !tc) {
      if (this.hovered) this.setHovered(null);
      return;
    }

    const center = this.deps.getAnchor().getWorldPosition(new THREE.Vector3());
    const cameraPos = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
    const eye = cameraPos.clone().sub(center);
    const distance = eye.length();
    eye.normalize();

    // Same screen-space size formula as TransformControlsGizmo (three r140).
    let factor: number;
    if ((camera as THREE.OrthographicCamera).isOrthographicCamera) {
      const ortho = camera as THREE.OrthographicCamera;
      factor = (ortho.top - ortho.bottom) / ortho.zoom;
    } else {
      const persp = camera as THREE.PerspectiveCamera;
      factor = distance * Math.min((1.9 * Math.tan((Math.PI * persp.fov) / 360)) / persp.zoom, 7);
    }
    const scale = (factor * tc.size) / 4;

    // Mirror into the quadrant facing the camera so arcs never hide behind the pivot.
    this.group.position.copy(center);
    this.group.scale.set(
      scale * (eye.x >= 0 ? 1 : -1),
      scale * (eye.y >= 0 ? 1 : -1),
      scale * (eye.z >= 0 ? 1 : -1),
    );
    this.group.updateMatrixWorld(true);

    for (const arc of this.arcs) {
      const edgeOn = Math.abs(eye.dot(GUMBALL_AXIS_VECTORS[arc.axis])) < GUMBALL.ROTATION_ARC_EDGE_ON_DOT;
      arc.usable = !edgeOn || this.drag?.axis === arc.axis;
      arc.visual.visible = arc.usable;
    }
  }

  public dispose(): void {
    this.endDrag();
    this.deps.canvas.removeEventListener('pointerdown', this.onPointerDown, true);
    this.deps.canvas.removeEventListener('pointermove', this.onHoverMove, true);
    if (this.justFinishedTimer) clearTimeout(this.justFinishedTimer);
    this.scene.remove(this.group);
    for (const arc of this.arcs) {
      arc.visual.geometry.dispose();
      arc.picker.geometry.dispose();
      arc.material.dispose();
      (arc.picker.material as THREE.Material).dispose();
    }
  }

  // ── Rotation ──────────────────────────────────────────────────────────────

  /**
   * Several objects always rotate (their positions orbit the pivot); a single one
   * only when it has an orientation (an omni sound spun about its center is a no-op).
   */
  private canRotateSelection(): boolean {
    const selection = this.deps.getSelection();
    if (selection.length > 1) return true;
    return selection.length === 1 && this.deps.resolveOrientation(selection[0]) !== null;
  }

  private takeSnapshot(): RotationSnapshot | null {
    const selection = this.deps.getSelection();
    if (selection.length === 0) return null;
    return {
      pivot: this.deps.getAnchor().getWorldPosition(new THREE.Vector3()),
      items: selection.map((object) => {
        const orientation = this.deps.resolveOrientation(object);
        return {
          object,
          startPosition: object.position.clone(),
          orientation,
          startOrientation: orientation ? orientation.get() : null,
        };
      }),
    };
  }

  /** Rotate the snapshot by `angle` about the world axis through its pivot. */
  private applyRotation(snapshot: RotationSnapshot, axis: GumballAxis, angle: number): void {
    const axisVec = GUMBALL_AXIS_VECTORS[axis];
    const q = new THREE.Quaternion().setFromAxisAngle(axisVec, angle);
    const moved: THREE.Object3D[] = [];
    for (const item of snapshot.items) {
      const next = item.startPosition.clone().sub(snapshot.pivot).applyQuaternion(q).add(snapshot.pivot);
      if (next.distanceToSquared(item.object.position) > 1e-12) {
        this.deps.placeObject(item.object, next);
        moved.push(item.object);
      }
    }
    // Positions first: store-driven re-syncs triggered by the orientation writes
    // below then read the rotated positions instead of snapping objects back.
    if (moved.length > 0) this.deps.commitPositions(moved);
    for (const item of snapshot.items) {
      if (item.orientation && item.startOrientation) {
        item.orientation.set(rotateOrientation(item.startOrientation, axisVec, angle));
      }
    }
    this.deps.requestRender();
  }

  // ── Pointer handling ──────────────────────────────────────────────────────

  private toNdc(e: PointerEvent): THREE.Vector2 {
    const rect = this.deps.canvas.getBoundingClientRect();
    return new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
  }

  private setHovered(axis: GumballAxis | null): void {
    if (this.hovered === axis) return;
    this.hovered = axis;
    for (const arc of this.arcs) {
      arc.material.color.setHex(arc.axis === axis ? GUMBALL.HOVER_COLOR : GUMBALL.AXIS_COLORS[arc.axis]);
    }
    if (axis) {
      this.deps.canvas.style.cursor = 'grab';
      this.setCursor = true;
    } else if (this.setCursor) {
      this.deps.canvas.style.cursor = '';
      this.setCursor = false;
    }
    this.deps.requestRender();
  }

  /** Point on the arc's rotation plane under the pointer, relative to the pivot. */
  private planeVector(e: PointerEvent, plane: THREE.Plane, pivot: THREE.Vector3): THREE.Vector3 | null {
    const camera = this.deps.getCamera();
    if (!camera) return null;
    this.raycaster.setFromCamera(this.toNdc(e), camera);
    const hit = this.raycaster.ray.intersectPlane(plane, new THREE.Vector3());
    if (!hit) return null;
    const v = hit.sub(pivot);
    return v.lengthSq() > 1e-12 ? v : null;
  }

  private onHoverMove = (e: PointerEvent): void => {
    if (this.drag) return;
    this.setHovered(this.hitTest(this.toNdc(e)));
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 || this.drag) return;
    const axis = this.hitTest(this.toNdc(e));
    if (!axis) return;
    const snapshot = this.takeSnapshot();
    if (!snapshot) return;

    const axisVec = GUMBALL_AXIS_VECTORS[axis];
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(axisVec, snapshot.pivot);
    const prev = this.planeVector(e, plane, snapshot.pivot);
    if (!prev) return;

    // Own this press: keep it away from TransformControls, box-select and the camera.
    e.stopPropagation();
    const tc = this.deps.getTransformControls();
    if (tc) tc.enabled = false;
    this.deps.setCameraEnabled(false);
    this.gesture.begin(e);
    this.drag = { axis, snapshot, plane, prev, angle: 0, downX: e.clientX, downY: e.clientY, moved: false };
    this.setHovered(axis);
    this.deps.canvas.style.cursor = 'grabbing';
    window.addEventListener('pointermove', this.onDragMove, true);
    window.addEventListener('pointerup', this.onDragEnd, true);
    window.addEventListener('pointercancel', this.onDragEnd, true);
  };

  private onDragMove = (e: PointerEvent): void => {
    const drag = this.drag;
    if (!drag) return;
    e.stopPropagation();
    if (!drag.moved) {
      const dx = e.clientX - drag.downX;
      const dy = e.clientY - drag.downY;
      // Stay put until the press becomes a real drag, so a click never rotates.
      if (dx * dx + dy * dy <= GUMBALL.CLICK_MAX_MOVE_PX * GUMBALL.CLICK_MAX_MOVE_PX) return;
      drag.moved = true;
    }
    const current = this.planeVector(e, drag.plane, drag.snapshot.pivot);
    if (!current) return;
    const axisVec = GUMBALL_AXIS_VECTORS[drag.axis];
    const cross = new THREE.Vector3().crossVectors(drag.prev, current);
    drag.angle += Math.atan2(cross.dot(axisVec), drag.prev.dot(current));
    drag.prev = current;
    this.applyRotation(drag.snapshot, drag.axis, drag.angle);
  };

  private onDragEnd = (e: PointerEvent): void => {
    const drag = this.drag;
    if (!drag) return;
    const isClick = e.type === 'pointerup' && this.gesture.end(e) && !drag.moved;
    this.endDrag();
    if (isClick) {
      const { clientX, clientY } = e;
      // Defer so the click / focus events of this release settle first.
      setTimeout(() => this.openPrompt(drag.axis, clientX, clientY), 0);
    }
  };

  private endDrag(): void {
    if (!this.drag) return;
    this.drag = null;
    this.gesture.cancel();
    window.removeEventListener('pointermove', this.onDragMove, true);
    window.removeEventListener('pointerup', this.onDragEnd, true);
    window.removeEventListener('pointercancel', this.onDragEnd, true);
    // Re-enable after TransformControls' own pointerup has run (it stays inert).
    setTimeout(() => {
      const tc = this.deps.getTransformControls();
      if (tc) tc.enabled = true;
    }, 0);
    this.deps.setCameraEnabled(true);
    this.deps.canvas.style.cursor = this.hovered ? 'grab' : '';
    this.justFinished = true;
    if (this.justFinishedTimer) clearTimeout(this.justFinishedTimer);
    this.justFinishedTimer = setTimeout(() => {
      this.justFinished = false;
      this.justFinishedTimer = null;
    }, 200);
    this.deps.requestRender();
  }

  private openPrompt(axis: GumballAxis, clientX: number, clientY: number): void {
    openGumballNumericPrompt({
      clientX,
      clientY,
      label: `Rotate ${axis}`,
      unit: GUMBALL.ANGLE_UNIT,
      onSubmit: (degrees) => {
        const snapshot = this.takeSnapshot();
        if (snapshot) this.applyRotation(snapshot, axis, degrees * DEG);
      },
    });
  }
}
