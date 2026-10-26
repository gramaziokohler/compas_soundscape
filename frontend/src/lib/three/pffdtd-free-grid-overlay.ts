/**
 * PffdtdFreeGridOverlay
 *
 * Draws the candidate grid of a free-positioning wave-based run: the valid grid
 * points a moved listener / source can snap to (small points, depth-tested so
 * the model hides those behind walls) and, larger, the points whose IRs are
 * playing. Rebuilt on every change (one or two BufferGeometries).
 */

import * as THREE from 'three';
import { PFFDTD_VISUALS } from '@/utils/constants';
import { getCssColorHex } from '@/utils/utils';
import type { PffdtdFreeGridPoints } from '@/types/pffdtd';

// Speckle renders custom objects only on ObjectLayers.OVERLAY (4).
const SPECKLE_OVERLAY_LAYER = 4;
const ACTIVE_POINT_SCALE = 3;

function enableOverlay(obj: THREE.Object3D): void {
  obj.traverse((child) => {
    child.layers.disableAll();
    child.layers.enable(0);
    child.layers.enable(SPECKLE_OVERLAY_LAYER);
    child.frustumCulled = false;
    child.renderOrder = PFFDTD_VISUALS.FREE_GRID_RENDER_ORDER;
    child.raycast = () => undefined; // never intercept scene clicks
  });
}

function pointCloud(positions: Float32Array, size: number, opacity: number): THREE.Points {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: getCssColorHex(PFFDTD_VISUALS.COLOR_VARS.FREE_GRID),
    size,
    sizeAttenuation: true,
    transparent: true,
    opacity,
    depthWrite: false,
  });
  return new THREE.Points(geometry, material);
}

export class PffdtdFreeGridOverlay {
  private readonly scene: THREE.Scene;
  private group: THREE.Group | null = null;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  show(points: PffdtdFreeGridPoints, active: [number, number, number][]): void {
    this.clear();
    const valid: number[] = [];
    for (let i = 0; i < points.valid.length; i++) {
      if (points.valid[i]) valid.push(points.positions[3 * i], points.positions[3 * i + 1], points.positions[3 * i + 2]);
    }
    const group = new THREE.Group();
    group.name = 'pffdtd-free-grid';
    const size = PFFDTD_VISUALS.FREE_GRID_POINT_SIZE_M;
    group.add(pointCloud(new Float32Array(valid), size, PFFDTD_VISUALS.FREE_GRID_OPACITY));
    if (active.length > 0) group.add(pointCloud(new Float32Array(active.flat()), size * ACTIVE_POINT_SCALE, 1));
    enableOverlay(group);
    this.scene.add(group);
    this.group = group;
  }

  clear(): void {
    if (!this.group) return;
    this.scene.remove(this.group);
    this.group.traverse((child) => {
      if (child instanceof THREE.Points) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    });
    this.group = null;
  }

  dispose(): void {
    this.clear();
  }
}
