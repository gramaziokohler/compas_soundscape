/**
 * AreaDrawingManager
 *
 * Manages polygon drawing interaction + visualization in the 3D scene.
 * Handles raycasting against Speckle batched geometry, building the polygon
 * from user clicks, rendering preview lines/fills, and displaying completed areas.
 *
 * Coordinate system: Z-up (Speckle convention).
 */

import * as THREE from 'three';
import { ObjectLayers, type Viewer } from '@speckle/viewer';
import type { DrawnArea, PolygonVertex, AreaVisualState } from '@/types/area-drawing';
import { AREA_DRAWING } from '@/utils/constants';
import { getCssColorHex } from '@/utils/utils';
import { createLabelSprite, computeLabelWorldHeight, updateLabelSprite } from './label-sprite-factory';
import {
  projectOnPlane,
  chooseProjectionAxes,
  projectPolygonTo2D,
  triangulatePolygon2D,
  computePolygonBounds,
} from './polygon-utils';

// ============================================================================
// Internal types
// ============================================================================

interface DrawingState {
  cardIndex: number;
  displayName: string;
  vertices: PolygonVertex[];
  projected3D: THREE.Vector3[];
  planeOrigin: THREE.Vector3 | null;
  planeNormal: THREE.Vector3 | null;
  isSnapped: boolean;
}

interface AreaVisuals {
  group: THREE.Group;
  fill: THREE.Mesh | null;
  outline: THREE.LineSegments | null;
  label: THREE.Sprite | null;
  pointPreviews: THREE.Group | null;
}

/**
 * Speckle's rendering pipeline only renders objects on specific layers.
 * Layer 4 = OVERLAY, used by sound spheres and receivers for custom objects.
 * Without this, objects exist in the scene graph but are invisible.
 */
const SPECKLE_OVERLAY_LAYER = 4;

/** Truncate an area label to a compact card-title form. */
function truncateLabel(text: string, max = 24): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

// ============================================================================
// AreaDrawingManager
// ============================================================================

export class AreaDrawingManager {
  private viewer: Viewer;
  private scene: THREE.Scene;
  private group: THREE.Group;

  // Drawing state
  private state: DrawingState | null = null;
  private previewGroup: THREE.Group;

  // Preview objects during drawing
  private previewLine: THREE.Line | null = null;
  private previewPoints: THREE.Points | null = null;
  private previewFill: THREE.Mesh | null = null;
  private cursorPoint: THREE.Mesh | null = null;

  // Completed area visuals keyed by cardIndex
  private areaVisuals = new Map<number, AreaVisuals>();

  /** Result-phase sound position previews (independent of drawn areas). */
  private soundPreviews: THREE.Group | null = null;
  private previewHighlightId: string | null = null;
  private previewBaseMat: THREE.MeshBasicMaterial | null = null;
  private previewHighlightMat: THREE.MeshBasicMaterial | null = null;

  /** World Z of the virtual ground grid — used as the fallback snap plane. */
  private groundPlaneZ = 0;

  /**
   * Set the virtual grid height. When no Speckle mesh is under the pointer,
   * clicks snap to this Z-plane so areas can be drawn on empty space.
   */
  setGroundPlaneZ(z: number): void {
    this.groundPlaneZ = z;
  }

  constructor(viewer: Viewer, scene: THREE.Scene, customObjectsGroup: THREE.Group) {
    this.viewer = viewer;
    this.scene = scene;

    // Create a dedicated group for area drawing visuals
    this.group = new THREE.Group();
    this.group.name = 'AreaDrawingVisuals';
    this.group.renderOrder = AREA_DRAWING.RENDER_ORDER;
    this.enableSpeckleLayers(this.group);
    customObjectsGroup.add(this.group);

    this.previewGroup = new THREE.Group();
    this.previewGroup.name = 'AreaDrawingPreview';
    this.enableSpeckleLayers(this.previewGroup);
    this.group.add(this.previewGroup);
  }

  // ==========================================================================
  // Drawing lifecycle
  // ==========================================================================

  /**
   * Enter drawing mode for a specific card.
   */
  startDrawing(cardIndex: number, displayName: string): void {
    this.cancelDrawing(); // cleanup any previous

    this.state = {
      cardIndex,
      displayName,
      vertices: [],
      projected3D: [],
      planeOrigin: null,
      planeNormal: null,
      isSnapped: false,
    };

    // Create cursor indicator
    const cursorGeo = new THREE.SphereGeometry(0.08, 12, 12);
    const cursorMat = new THREE.MeshBasicMaterial({
      color: getCssColorHex('--color-success'),
      depthTest: false,
      depthWrite: false,
    });
    this.cursorPoint = new THREE.Mesh(cursorGeo, cursorMat);
    this.cursorPoint.renderOrder = AREA_DRAWING.RENDER_ORDER + 2;
    this.cursorPoint.visible = false;
    this.enableSpeckleLayers(this.cursorPoint);
    this.previewGroup.add(this.cursorPoint);
  }

  /**
   * Handle pointer move during drawing. Raycasts against Speckle surfaces.
   * Returns the NDC coordinates if a hit is found.
   */
  handlePointerMove(event: MouseEvent): void {
    if (!this.state) return;

    const ndc = this.eventToNDC(event);
    if (!ndc) return;

    const hit = this.resolveDrawHit(ndc);

    if (!hit) {
      if (this.cursorPoint) this.cursorPoint.visible = false;
      this.state.isSnapped = false;
      this.updatePreviewLine(null);
      this.requestRender();
      return;
    }

    let worldPoint = hit.point.clone();

    // Project onto plane if we have one
    if (this.state.planeOrigin && this.state.planeNormal) {
      worldPoint = projectOnPlane(worldPoint, this.state.planeOrigin, this.state.planeNormal);
    }

    // Snap detection: check screen distance to first point
    let snapped = false;
    if (this.state.projected3D.length >= AREA_DRAWING.MIN_VERTICES) {
      const screenDist = this.screenDistance(this.state.projected3D[0], event);
      if (screenDist < AREA_DRAWING.SNAP_DISTANCE_PX) {
        worldPoint.copy(this.state.projected3D[0]);
        snapped = true;
      }
    }
    this.state.isSnapped = snapped;

    // Update cursor
    if (this.cursorPoint) {
      this.cursorPoint.position.copy(worldPoint);
      this.cursorPoint.visible = true;
      // Change color when snapping
      (this.cursorPoint.material as THREE.MeshBasicMaterial).color.setHex(
        snapped ? 0xffffff : getCssColorHex('--color-warning')
      );
    }

    this.updatePreviewLine(worldPoint);
    this.updatePreviewFill(worldPoint);
    this.requestRender();
  }

  /**
   * Handle click during drawing. Adds a point.
   * Returns a DrawnArea when the polygon is closed (snap to first point), otherwise null.
   */
  handleClick(event: MouseEvent): DrawnArea | null {
    if (!this.state) return null;

    // If snapped to first point → close polygon
    if (this.state.isSnapped && this.state.projected3D.length >= AREA_DRAWING.MIN_VERTICES) {
      return this.closePolygon();
    }

    const ndc = this.eventToNDC(event);
    if (!ndc) return null;

    const hit = this.resolveDrawHit(ndc);
    if (!hit) return null;

    const point = hit.point.clone();
    const normal = hit.face?.normal?.clone() ?? new THREE.Vector3(0, 0, 1);

    // First point: set the drawing plane
    if (this.state.vertices.length === 0) {
      this.state.planeOrigin = point.clone();
      this.state.planeNormal = normal.clone();
    }

    // Project onto plane
    const projected = this.state.planeOrigin && this.state.planeNormal
      ? projectOnPlane(point, this.state.planeOrigin, this.state.planeNormal)
      : point.clone();

    this.state.vertices.push({
      position: [point.x, point.y, point.z],
      normal: [normal.x, normal.y, normal.z],
    });
    this.state.projected3D.push(projected);

    // Add visual point marker
    this.addPointMarker(projected);
    this.updatePreviewLine(null);
    this.requestRender();

    return null;
  }

  /**
   * Confirm and close the polygon programmatically (Enter key or sidebar button).
   */
  confirmDrawing(): DrawnArea | null {
    if (!this.state || this.state.projected3D.length < AREA_DRAWING.MIN_VERTICES) {
      return null;
    }
    return this.closePolygon();
  }

  /**
   * Handle right-click: remove the last point or cancel if no points left.
   */
  handleRightClick(event: MouseEvent): void {
    if (!this.state) return;
    event.preventDefault();

    if (this.state.vertices.length > 0) {
      this.state.vertices.pop();
      this.state.projected3D.pop();

      // Remove last point marker
      const markers = this.previewGroup.children.filter(
        (c) => c.userData.isPointMarker
      );
      if (markers.length > 0) {
        const last = markers[markers.length - 1];
        this.previewGroup.remove(last);
        this.disposeObject(last);
      }

      // If no more plane anchors, reset plane
      if (this.state.vertices.length === 0) {
        this.state.planeOrigin = null;
        this.state.planeNormal = null;
      }

      this.updatePreviewLine(null);
      this.updatePreviewFill(null);
      this.requestRender();
    } else {
      this.cancelDrawing();
    }
  }

  /**
   * Cancel drawing mode, cleaning up preview objects.
   */
  cancelDrawing(): void {
    this.state = null;
    this.clearPreview();
    this.requestRender();
  }

  /**
   * Whether drawing mode is currently active.
   */
  get isDrawing(): boolean {
    return this.state !== null;
  }

  /**
   * Returns the set of card indices currently rendered in the scene.
   */
  get managedCardIndices(): Set<number> {
    return new Set(this.areaVisuals.keys());
  }

  // ==========================================================================
  // Completed area visualization
  // ==========================================================================

  /**
   * Add a completed area polygon to the scene.
   */
  addCompletedArea(area: DrawnArea, visualState: AreaVisualState): void {
    // Remove existing visuals for this card index
    this.removeArea(area.cardIndex);

    const areaGroup = new THREE.Group();
    areaGroup.name = `AreaPolygon-${area.cardIndex}`;
    this.enableSpeckleLayers(areaGroup);

    const origin = new THREE.Vector3(...area.planeOrigin);
    const normal = new THREE.Vector3(...area.planeNormal);

    // Convert vertices to THREE.Vector3
    const verts3D = area.vertices.map(
      (v) => projectOnPlane(
        new THREE.Vector3(...v.position),
        origin,
        normal
      )
    );

    // Build outline
    const outline = this.buildOutline(verts3D);
    if (outline) areaGroup.add(outline);

    // Build fill
    const fill = this.buildFill(verts3D, normal, origin, visualState);
    if (fill) areaGroup.add(fill);

    // Build label
    const label = this.buildLabel(area.displayName, new THREE.Vector3(...area.labelPosition));
    if (label) areaGroup.add(label);

    this.group.add(areaGroup);

    this.areaVisuals.set(area.cardIndex, {
      group: areaGroup,
      fill,
      outline,
      label,
      pointPreviews: null,
    });
    this.requestRender();
  }

  /**
   * Update the visual state (fill color) of a completed area.
   */
  updateAreaVisualState(cardIndex: number, state: AreaVisualState): void {
    const visuals = this.areaVisuals.get(cardIndex);
    if (!visuals?.fill) return;

    const mat = visuals.fill.material as THREE.MeshBasicMaterial;
    mat.color.setHex(
      state === 'generated' ? getCssColorHex('--color-warning') : getCssColorHex('--color-warning-light')
    );
    mat.opacity =
      state === 'generated' ? AREA_DRAWING.FILL_OPACITY_GENERATED : AREA_DRAWING.FILL_OPACITY_DEFAULT;
    this.requestRender();
  }

  /**
   * Show small spheres at computed sound positions within an area.
   */
  showPointPreviews(
    cardIndex: number,
    positions: [number, number, number][]
  ): void {
    const visuals = this.areaVisuals.get(cardIndex);
    if (!visuals) return;

    // Remove existing previews
    if (visuals.pointPreviews) {
      visuals.group.remove(visuals.pointPreviews);
      this.disposeObject(visuals.pointPreviews);
    }

    const previewsGroup = new THREE.Group();
    previewsGroup.name = `AreaPointPreviews-${cardIndex}`;
    this.enableSpeckleLayers(previewsGroup);

    const geo = new THREE.SphereGeometry(AREA_DRAWING.POINT_PREVIEW_SIZE, 8, 8);
    const mat = new THREE.MeshBasicMaterial({
      color: getCssColorHex('--color-warning'),
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.8,
    });

    for (const pos of positions) {
      const sphere = new THREE.Mesh(geo, mat);
      sphere.position.set(pos[0], pos[1], pos[2]);
      sphere.renderOrder = AREA_DRAWING.RENDER_ORDER + 1;
      this.enableSpeckleLayers(sphere);
      previewsGroup.add(sphere);
    }

    visuals.pointPreviews = previewsGroup;
    visuals.group.add(previewsGroup);
    this.requestRender();
  }

  /**
   * Show/hide preview spheres (with labels) at planned sound positions during
   * the analysis result phase. Independent of any drawn area. `points` carry
   * their prompt id so a hovered/selected prompt can be emphasised.
   */
  setSoundPreviews(
    points: Array<{
      promptId: string;
      position: [number, number, number];
      label: string;
      showSphere?: boolean;
    }>,
  ): void {
    if (this.soundPreviews) {
      this.group.remove(this.soundPreviews);
      this.disposeObject(this.soundPreviews);
      this.soundPreviews = null;
    }
    this.previewHighlightId = null;
    if (points.length === 0) {
      this.requestRender();
      return;
    }

    const g = new THREE.Group();
    g.name = 'AnalysisSoundPreviews';
    this.enableSpeckleLayers(g);

    const camera = this.viewer.getRenderer().renderingCamera as THREE.PerspectiveCamera | undefined;
    const geo = new THREE.SphereGeometry(AREA_DRAWING.POINT_PREVIEW_SIZE, 8, 8);
    const baseMat = new THREE.MeshBasicMaterial({
      color: getCssColorHex('--color-primary'),
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.85,
    });
    const highlightMat = new THREE.MeshBasicMaterial({
      color: getCssColorHex('--color-warning'),
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 1,
    });
    this.previewBaseMat = baseMat;
    this.previewHighlightMat = highlightMat;

    points.forEach((point) => {
      // Linked prompts render a label over their first object (no sphere).
      if (point.showSphere !== false) {
        const sphere = new THREE.Mesh(geo, baseMat);
        sphere.position.set(point.position[0], point.position[1], point.position[2]);
        sphere.renderOrder = AREA_DRAWING.RENDER_ORDER + 1;
        sphere.userData.promptId = point.promptId;
        sphere.userData.baseScale = 1;
        this.enableSpeckleLayers(sphere);
        g.add(sphere);
      }

      if (point.label) {
        const sprite = createLabelSprite(truncateLabel(point.label));
        sprite.position
          .set(point.position[0], point.position[1], point.position[2])
          .addScaledVector(new THREE.Vector3(0, 0, 1), 0.6);
        sprite.renderOrder = AREA_DRAWING.RENDER_ORDER + 3;
        sprite.userData.isLabel = true;
        this.enableSpeckleLayers(sprite);
        // Set the correct screen-space scale immediately so the label never
        // renders at its default (1×1) scale for a frame.
        if (camera && camera.isPerspectiveCamera) {
          const h = computeLabelWorldHeight(camera, camera.position.distanceTo(sprite.position));
          sprite.scale.set(h * ((sprite.userData.aspectRatio as number) || 3), h, 1);
        }
        g.add(sprite);
      }
    });

    this.soundPreviews = g;
    this.group.add(g);
    this.requestRender();
  }

  /** Recolour the preview sphere for a hovered prompt without rebuilding the group. */
  setPreviewHighlight(promptId: string | null): void {
    if (this.previewHighlightId === promptId) return;
    this.previewHighlightId = promptId;
    if (!this.soundPreviews || !this.previewBaseMat || !this.previewHighlightMat) return;

    for (const child of this.soundPreviews.children) {
      if (!(child as THREE.Mesh).isMesh) continue;
      const mesh = child as THREE.Mesh;
      const isHighlighted = promptId !== null && mesh.userData.promptId === promptId;
      mesh.material = isHighlighted ? this.previewHighlightMat : this.previewBaseMat;
      mesh.scale.setScalar(isHighlighted ? 1.4 : 1);
    }
    this.requestRender();
  }

  /**
   * Per-frame screen-space label scaling — identical treatment to sound sphere
   * / receiver / bounding-box labels. Called from the coordinator frame loop.
   */
  updateScreenSpaceScale(camera: THREE.PerspectiveCamera): void {
    const scaleLabel = (label: THREE.Sprite) => {
      const distance = camera.position.distanceTo(label.position);
      if (distance < 0.01) return;
      const h = computeLabelWorldHeight(camera, distance);
      label.scale.set(h * ((label.userData.aspectRatio as number) || 3), h, 1);
    };

    for (const visuals of this.areaVisuals.values()) {
      if (visuals.label) scaleLabel(visuals.label);
    }
    if (this.soundPreviews) {
      for (const child of this.soundPreviews.children) {
        if ((child as THREE.Sprite).isSprite && child.userData.isLabel) {
          scaleLabel(child as THREE.Sprite);
        }
      }
    }
  }

  /** Show/hide a completed area's visuals (e.g. only for the expanded card). */
  setAreaVisible(cardIndex: number, visible: boolean): void {
    const visuals = this.areaVisuals.get(cardIndex);
    if (!visuals) return;
    if (visuals.group.visible !== visible) {
      visuals.group.visible = visible;
      this.requestRender();
    }
  }

  /** Update a completed area's label text in place (same canvas, no flash). */
  updateAreaLabel(cardIndex: number, text: string): void {
    const visuals = this.areaVisuals.get(cardIndex);
    if (!visuals?.label) return;
    const truncated = truncateLabel(text);
    if (visuals.label.userData.labelText === truncated) return;
    updateLabelSprite(visuals.label, truncated);
    this.requestRender();
  }

  /**
   * Remove completed area visuals for a card.
   */
  removeArea(cardIndex: number): void {
    const visuals = this.areaVisuals.get(cardIndex);
    if (!visuals) return;

    this.group.remove(visuals.group);
    this.disposeObject(visuals.group);
    this.areaVisuals.delete(cardIndex);
    this.requestRender();
  }

  /**
   * Full cleanup.
   */
  dispose(): void {
    this.cancelDrawing();
    for (const [cardIndex] of this.areaVisuals) {
      this.removeArea(cardIndex);
    }
    if (this.group.parent) {
      this.group.parent.remove(this.group);
    }
    this.disposeObject(this.group);
  }

  // ==========================================================================
  // Private: Request viewer re-render
  // ==========================================================================

  /**
   * Speckle viewer uses demand-based rendering — scene changes are invisible
   * until we explicitly request a new frame.
   */
  private requestRender(): void {
    this.viewer.requestRender();
  }

  /**
   * Enable the Speckle overlay layer on an object and all its descendants.
   * Without this, objects are invisible — Speckle's pipeline only renders
   * objects on specific ObjectLayers (layer 4 = OVERLAY for custom objects).
   */
  private enableSpeckleLayers(obj: THREE.Object3D): void {
    obj.layers.enable(SPECKLE_OVERLAY_LAYER);
    obj.traverse((child) => {
      child.layers.enable(SPECKLE_OVERLAY_LAYER);
    });
  }

  // ==========================================================================
  // Private: Raycasting
  // ==========================================================================

  private eventToNDC(event: MouseEvent): THREE.Vector2 | null {
    const canvas = this.viewer.getRenderer().renderer.domElement;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    return new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
  }

  /**
   * Resolve a draw point: prefer a Speckle mesh hit, then fall back to the
   * virtual ground grid so the user can draw over empty space ("void").
   */
  private resolveDrawHit(
    ndc: THREE.Vector2
  ): { point: THREE.Vector3; face: { normal: THREE.Vector3 } | null } | null {
    const surface = this.raycastSpeckleSurface(ndc);
    if (surface) return surface;
    return this.raycastGroundPlane(ndc);
  }

  /** Intersect the camera ray with a Z-up plane at the virtual grid height. */
  private raycastGroundPlane(
    ndc: THREE.Vector2
  ): { point: THREE.Vector3; face: { normal: THREE.Vector3 } | null } | null {
    try {
      const renderer = this.viewer.getRenderer();
      const camera = renderer.renderingCamera;
      if (!camera) return null;

      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(ndc, camera);
      const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -this.groundPlaneZ);
      const target = new THREE.Vector3();
      const hit = raycaster.ray.intersectPlane(plane, target);
      if (!hit) return null;
      return { point: hit.clone(), face: { normal: new THREE.Vector3(0, 0, 1) } };
    } catch {
      return null;
    }
  }

  private raycastSpeckleSurface(
    ndc: THREE.Vector2
  ): { point: THREE.Vector3; face: { normal: THREE.Vector3 } | null } | null {
    try {
      const renderer = this.viewer.getRenderer();
      const camera = renderer.renderingCamera;
      if (!camera) return null;

      const results: any[] =
        renderer.intersections.intersect(
          this.scene,
          camera,
          ndc,
          ObjectLayers.STREAM_CONTENT_MESH,
          true
        ) || [];

      if (results.length === 0) return null;

      const first = results[0];
      return {
        point: first.point instanceof THREE.Vector3
          ? first.point
          : new THREE.Vector3(first.point.x, first.point.y, first.point.z),
        face: first.face
          ? { normal: new THREE.Vector3(first.face.normal.x, first.face.normal.y, first.face.normal.z) }
          : null,
      };
    } catch {
      return null;
    }
  }

  /**
   * Get screen-space distance between a 3D point and a mouse event.
   */
  private screenDistance(point3D: THREE.Vector3, event: MouseEvent): number {
    const camera = this.viewer.getRenderer().renderingCamera;
    if (!camera) return Infinity;

    const canvas = this.viewer.getRenderer().renderer.domElement;
    const rect = canvas.getBoundingClientRect();

    const projected = point3D.clone().project(camera);
    const screenX = ((projected.x + 1) / 2) * rect.width;
    const screenY = ((1 - projected.y) / 2) * rect.height;

    const dx = event.clientX - rect.left - screenX;
    const dy = event.clientY - rect.top - screenY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // ==========================================================================
  // Private: Preview rendering
  // ==========================================================================

  private updatePreviewLine(cursorPos: THREE.Vector3 | null): void {
    if (!this.state) return;

    // Remove old line
    if (this.previewLine) {
      this.previewGroup.remove(this.previewLine);
      this.disposeObject(this.previewLine);
      this.previewLine = null;
    }

    const points = [...this.state.projected3D];
    if (cursorPos) points.push(cursorPos);
    if (points.length < 2) return;

    // Close the loop if we have enough points and cursor is present
    if (cursorPos && points.length >= AREA_DRAWING.MIN_VERTICES + 1) {
      points.push(points[0]);
    }

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: getCssColorHex('--color-warning'),
      depthTest: false,
      depthWrite: false,
      linewidth: 2,
    });

    this.previewLine = new THREE.Line(geometry, material);
    this.previewLine.renderOrder = AREA_DRAWING.RENDER_ORDER + 1;
    this.enableSpeckleLayers(this.previewLine);
    this.previewGroup.add(this.previewLine);
  }

  private updatePreviewFill(cursorPos: THREE.Vector3 | null): void {
    if (!this.state || !this.state.planeOrigin || !this.state.planeNormal) return;

    // Remove old fill
    if (this.previewFill) {
      this.previewGroup.remove(this.previewFill);
      this.disposeObject(this.previewFill);
      this.previewFill = null;
    }

    const allPoints = [...this.state.projected3D];
    if (cursorPos) allPoints.push(cursorPos);
    if (allPoints.length < AREA_DRAWING.MIN_VERTICES) return;

    this.previewFill = this.buildFill(
      allPoints,
      this.state.planeNormal,
      this.state.planeOrigin,
      'default'
    );

    if (this.previewFill) {
      this.previewFill.renderOrder = AREA_DRAWING.RENDER_ORDER;
      this.previewGroup.add(this.previewFill);
    }
  }

  private addPointMarker(position: THREE.Vector3): void {
    const geo = new THREE.SphereGeometry(0.06, 8, 8);
    const mat = new THREE.MeshBasicMaterial({
      color: getCssColorHex('--color-warning'),
      depthTest: false,
      depthWrite: false,
    });
    const marker = new THREE.Mesh(geo, mat);
    marker.position.copy(position);
    marker.renderOrder = AREA_DRAWING.RENDER_ORDER + 2;
    marker.userData.isPointMarker = true;
    this.enableSpeckleLayers(marker);
    this.previewGroup.add(marker);
  }

  // ==========================================================================
  // Private: Polygon building helpers
  // ==========================================================================

  closePolygon(): DrawnArea | null {
    if (!this.state || !this.state.planeOrigin || !this.state.planeNormal) return null;
    if (this.state.projected3D.length < AREA_DRAWING.MIN_VERTICES) return null;

    const origin = this.state.planeOrigin;
    const normal = this.state.planeNormal;

    // Project to 2D
    const projected2D = projectPolygonTo2D(this.state.projected3D, normal, origin);

    // Compute label position (centroid)
    const centroid = new THREE.Vector3();
    for (const p of this.state.projected3D) {
      centroid.add(p);
    }
    centroid.divideScalar(this.state.projected3D.length);

    const area: DrawnArea = {
      cardIndex: this.state.cardIndex,
      vertices: [...this.state.vertices],
      planeOrigin: [origin.x, origin.y, origin.z],
      planeNormal: [normal.x, normal.y, normal.z],
      projectedVertices: projected2D,
      labelPosition: [centroid.x, centroid.y, centroid.z],
      displayName: this.state.displayName,
    };

    // Clear preview
    this.clearPreview();
    this.state = null;

    return area;
  }

  private buildOutline(verts3D: THREE.Vector3[]): THREE.LineSegments | null {
    if (verts3D.length < 2) return null;

    // Build segments: v0-v1, v1-v2, ..., vN-v0
    const positions: number[] = [];
    for (let i = 0; i < verts3D.length; i++) {
      const a = verts3D[i];
      const b = verts3D[(i + 1) % verts3D.length];
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

    const mat = new THREE.LineBasicMaterial({
      color: getCssColorHex('--color-warning'),
      depthTest: false,
      depthWrite: false,
      linewidth: 2,
    });

    const line = new THREE.LineSegments(geo, mat);
    line.renderOrder = AREA_DRAWING.RENDER_ORDER + 1;
    this.enableSpeckleLayers(line);
    return line;
  }

  private buildFill(
    verts3D: THREE.Vector3[],
    normal: THREE.Vector3,
    origin: THREE.Vector3,
    state: AreaVisualState
  ): THREE.Mesh | null {
    if (verts3D.length < AREA_DRAWING.MIN_VERTICES) return null;

    const [axisU, axisV] = chooseProjectionAxes(normal);

    // Project to 2D for earcut
    const pts2D: [number, number][] = verts3D.map((v) => {
      const diff = new THREE.Vector3().subVectors(v, origin);
      return [diff.dot(axisU), diff.dot(axisV)] as [number, number];
    });

    const indices = triangulatePolygon2D(pts2D);
    if (indices.length === 0) return null;

    // Build 3D positions from the original points
    const positions = new Float32Array(verts3D.length * 3);
    for (let i = 0; i < verts3D.length; i++) {
      positions[i * 3] = verts3D[i].x;
      positions[i * 3 + 1] = verts3D[i].y;
      positions[i * 3 + 2] = verts3D[i].z;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setIndex(indices);

    const isGenerated = state === 'generated';
    const mat = new THREE.MeshBasicMaterial({
      color: isGenerated ? getCssColorHex('--color-warning') : getCssColorHex('--color-warning-light'),
      transparent: true,
      opacity: isGenerated ? AREA_DRAWING.FILL_OPACITY_GENERATED : AREA_DRAWING.FILL_OPACITY_DEFAULT,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = AREA_DRAWING.RENDER_ORDER;
    this.enableSpeckleLayers(mesh);
    return mesh;
  }

  private buildLabel(text: string, position: THREE.Vector3): THREE.Sprite | null {
    // Same canvas label sprite as sound spheres / receivers.
    const sprite = createLabelSprite(truncateLabel(text));
    sprite.position.copy(position).addScaledVector(new THREE.Vector3(0, 0, 1), 0.5);
    sprite.renderOrder = AREA_DRAWING.RENDER_ORDER + 3;

    // Screen-space size at creation time (constant apparent size at this distance).
    const camera = this.viewer.getRenderer().renderingCamera as THREE.PerspectiveCamera | undefined;
    const distance = camera ? camera.position.distanceTo(position) : 10;
    const h = camera && camera.isPerspectiveCamera
      ? computeLabelWorldHeight(camera, distance)
      : 0.4;
    const aspect = (sprite.userData.aspectRatio as number) || 6;
    sprite.scale.set(h * aspect, h, 1);

    this.enableSpeckleLayers(sprite);
    return sprite;
  }

  // ==========================================================================
  // Private: Cleanup
  // ==========================================================================

  private clearPreview(): void {
    // Dispose all children
    while (this.previewGroup.children.length > 0) {
      const child = this.previewGroup.children[0];
      this.previewGroup.remove(child);
      this.disposeObject(child);
    }

    this.previewLine = null;
    this.previewPoints = null;
    this.previewFill = null;
    this.cursorPoint = null;
  }

  private disposeObject(obj: THREE.Object3D): void {
    obj.traverse((child) => {
      if (child instanceof THREE.Mesh || child instanceof THREE.Line || child instanceof THREE.LineSegments) {
        child.geometry?.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else if (child.material) {
          child.material.dispose();
        }
      }
      if (child instanceof THREE.Sprite) {
        child.material.map?.dispose();
        child.material.dispose();
      }
    });
  }
}
