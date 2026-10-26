/**
 * PffdtdVoxelOverlay
 *
 * Draws the boundary nodes of a PFFDTD voxel preview over the visible Speckle
 * model: one `THREE.Points` cloud (size = grid spacing h, coloured by the
 * node's acoustic material, grey when rigid) plus problem markers — wire
 * spheres of radius 3h for clearance / clash problems (orange for unreachable
 * listeners) and red points for leaks.
 *
 * Rebuilt on every change (one BufferGeometry + a few markers).
 */

import * as THREE from 'three';
import { PFFDTD, PFFDTD_VISUALS } from '@/utils/constants';
import { getCssColorHex } from '@/utils/utils';
import type { PffdtdVoxelPoints, PffdtdVoxelPreviewPayload, PffdtdVoxelProblem } from '@/types/pffdtd';

// Speckle renders custom objects only on ObjectLayers.OVERLAY (4).
const SPECKLE_OVERLAY_LAYER = 4;

export interface VoxelOverlayOptions {
  payload: PffdtdVoxelPreviewPayload;
  points: PffdtdVoxelPoints | null;
  /** Viewer colour of a legend material id (null = unknown, drawn like rigid nodes). */
  materialColor: (materialId: string | null) => string | null;
  /** Problem drawn emphasised (focused in the panel). */
  highlightId: string | null;
}

function isLeak(problem: PffdtdVoxelProblem): boolean {
  return problem.code.includes('leak');
}

function markerColorVar(problem: PffdtdVoxelProblem): string {
  if (problem.code.includes('unreachable')) return PFFDTD_VISUALS.COLOR_VARS.WARNING;
  if (problem.severity === 'error') return PFFDTD_VISUALS.COLOR_VARS.ERROR;
  if (problem.severity === 'warning') return PFFDTD_VISUALS.COLOR_VARS.WARNING;
  return PFFDTD_VISUALS.COLOR_VARS.INFO;
}

function enableOverlay(obj: THREE.Object3D, renderOrder: number): void {
  obj.traverse((child) => {
    child.layers.disableAll();
    child.layers.enable(0);
    child.layers.enable(SPECKLE_OVERLAY_LAYER);
    child.frustumCulled = false;
    child.renderOrder = renderOrder;
    // Never intercept scene clicks (selection, placement) on the model behind.
    child.raycast = () => undefined;
  });
}

export class PffdtdVoxelOverlay {
  private readonly scene: THREE.Scene;
  private group: THREE.Group | null = null;
  private h = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  show({ payload, points, materialColor, highlightId }: VoxelOverlayOptions): void {
    this.clear();
    this.h = payload.grid.h;
    const group = new THREE.Group();
    group.name = 'pffdtd-voxel-overlay';

    if (points && points.materials.length > 0) group.add(this.buildPoints(payload, points, materialColor));
    for (const problem of payload.problems) {
      if (problem.positions.length === 0) continue;
      const marker = this.buildMarker(problem, problem.id === highlightId);
      if (marker) group.add(marker);
    }

    enableOverlay(group, PFFDTD_VISUALS.VOXEL_RENDER_ORDER);
    this.scene.add(group);
    this.group = group;
  }

  /** Camera-framing box of a located problem (null when it has no position). */
  problemBounds(problem: PffdtdVoxelProblem): THREE.Box3 | null {
    if (problem.positions.length === 0) return null;
    const box = new THREE.Box3();
    for (const p of problem.positions) box.expandByPoint(new THREE.Vector3(p[0], p[1], p[2]));
    const radius = problem.radius_m ?? PFFDTD_VISUALS.MARKER_RADIUS_CELLS * this.h;
    return box.expandByScalar(radius + PFFDTD_VISUALS.FOCUS_PADDING_M);
  }

  clear(): void {
    if (!this.group) return;
    this.scene.remove(this.group);
    this.group.traverse((child) => {
      if (child instanceof THREE.Points || child instanceof THREE.LineSegments || child instanceof THREE.Mesh) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    });
    this.group = null;
  }

  dispose(): void {
    this.clear();
  }

  private buildPoints(
    payload: PffdtdVoxelPreviewPayload,
    points: PffdtdVoxelPoints,
    materialColor: (materialId: string | null) => string | null,
  ): THREE.Points {
    // Material index → RGB, resolved once per build.
    const rigid = new THREE.Color(getCssColorHex(PFFDTD_VISUALS.COLOR_VARS.RIGID));
    const byIndex = new Map<number, THREE.Color>();
    for (const m of payload.materials) {
      const css = materialColor(m.material_id);
      byIndex.set(m.index, css ? new THREE.Color(css) : rigid);
    }

    const n = points.materials.length;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const idx = points.materials[i];
      const c = idx === PFFDTD.RIGID_MATERIAL_INDEX ? rigid : byIndex.get(idx) ?? rigid;
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(points.positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({
      size: payload.grid.h,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: PFFDTD_VISUALS.VOXEL_OPACITY,
      depthTest: false,
      depthWrite: false,
    });
    return new THREE.Points(geometry, material);
  }

  private buildMarker(problem: PffdtdVoxelProblem, highlighted: boolean): THREE.Object3D | null {
    const color = getCssColorHex(markerColorVar(problem));
    const opacity = highlighted ? 1 : 0.6;

    if (isLeak(problem)) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(problem.positions.flat(), 3));
      const material = new THREE.PointsMaterial({
        color: getCssColorHex(PFFDTD_VISUALS.COLOR_VARS.ERROR),
        size: PFFDTD_VISUALS.LEAK_POINT_SIZE_CELLS * this.h,
        sizeAttenuation: true,
        transparent: true,
        opacity,
        depthTest: false,
        depthWrite: false,
      });
      return new THREE.Points(geometry, material);
    }

    const radius = problem.radius_m ?? PFFDTD_VISUALS.MARKER_RADIUS_CELLS * this.h;
    const segments = PFFDTD_VISUALS.MARKER_SPHERE_SEGMENTS;
    const solid = new THREE.SphereGeometry(radius, segments, segments / 2);
    const sphere = new THREE.WireframeGeometry(solid);
    solid.dispose();
    const group = new THREE.Group();
    for (const p of problem.positions) {
      const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false });
      const lines = new THREE.LineSegments(sphere.clone(), material);
      lines.position.set(p[0], p[1], p[2]);
      group.add(lines);
    }
    sphere.dispose();
    return group;
  }
}
