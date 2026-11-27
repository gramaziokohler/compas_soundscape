/**
 * AcousticPathsOverlay
 *
 * Draws the stored sound paths of one source-listener pair (the hovered / selected IR of a
 * simulation card) in the Speckle scene:
 *  - the direct sound and the image-source reflections, one colour per order, fading with it;
 *  - the first-order diffracted paths (dashed), when the run stored them.
 *
 * Paths are drawn on top of the model (no depth test) so a reflection behind a wall stays visible.
 */

import * as THREE from 'three';
import { ACOUSTIC_PATHS } from '@/utils/constants';
import { getCssColorHex } from '@/utils/utils';
import type { PairPaths } from '@/lib/acoustics/acoustic-paths';

// Speckle renders custom objects only on ObjectLayers.OVERLAY (4).
const SPECKLE_OVERLAY_LAYER = 4;

function enableOverlay(obj: THREE.Object3D): void {
  obj.traverse((child) => {
    child.layers.disableAll();
    child.layers.enable(0);
    child.layers.enable(SPECKLE_OVERLAY_LAYER);
    child.frustumCulled = false;
    child.renderOrder = ACOUSTIC_PATHS.RENDER_ORDER;
    child.raycast = () => undefined; // never intercept scene clicks
  });
}

/** Segment pairs (a→b, b→c, ...) of a flat polyline, appended to `out`. */
function pushPolyline(out: number[], points: readonly number[]): void {
  for (let i = 0; i + 5 < points.length; i += 3) {
    out.push(points[i], points[i + 1], points[i + 2], points[i + 3], points[i + 4], points[i + 5]);
  }
}

function lineSegments(positions: number[], color: number, opacity: number, dashed = false): THREE.LineSegments {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const common = { color, transparent: true, opacity, depthTest: false, depthWrite: false };
  const material = dashed
    ? new THREE.LineDashedMaterial({ ...common, dashSize: ACOUSTIC_PATHS.DASH_SIZE_M, gapSize: ACOUSTIC_PATHS.GAP_SIZE_M })
    : new THREE.LineBasicMaterial(common);
  const lines = new THREE.LineSegments(geometry, material);
  if (dashed) lines.computeLineDistances();
  return lines;
}

export class AcousticPathsOverlay {
  private readonly scene: THREE.Scene;
  private group: THREE.Group | null = null;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /** Draw `paths` (null clears the overlay). */
  render(paths: PairPaths | null): void {
    this.clear();
    if (!paths || (!paths.reflections.length && !paths.diffracted.length)) return;
    const group = new THREE.Group();
    group.name = 'acoustic-paths';
    const vars = ACOUSTIC_PATHS.COLOR_VARS;

    const byOrder = new Map<number, number[]>();
    for (const path of paths.reflections) {
      let positions = byOrder.get(path.order);
      if (!positions) byOrder.set(path.order, (positions = []));
      pushPolyline(positions, path.points);
    }
    for (const [order, positions] of byOrder) {
      const colorVar = order === 0 ? vars.DIRECT : vars.ORDERS[(order - 1) % vars.ORDERS.length];
      const opacity = ACOUSTIC_PATHS.PATH_OPACITY * ACOUSTIC_PATHS.PATH_OPACITY_FALLOFF ** order;
      group.add(lineSegments(positions, getCssColorHex(colorVar), opacity));
    }

    const diffracted: number[] = [];
    for (const path of paths.diffracted) pushPolyline(diffracted, path.points);
    if (diffracted.length) group.add(lineSegments(diffracted, getCssColorHex(vars.DIFFRACTED), ACOUSTIC_PATHS.PATH_OPACITY, true));

    enableOverlay(group);
    this.scene.add(group);
    this.group = group;
  }

  clear(): void {
    if (!this.group) return;
    this.scene.remove(this.group);
    this.group.traverse((child) => {
      if (child instanceof THREE.LineSegments) {
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
