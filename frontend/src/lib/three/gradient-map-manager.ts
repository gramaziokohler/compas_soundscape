/**
 * GradientMapManager
 *
 * Renders an acoustic metric gradient overlay on a grid listener surface.
 * Creates a flat mesh with vertex colors interpolated from sparse grid-receiver
 * metric values using Inverse Distance Weighting (IDW).
 *
 * Geometry is built in world space — no mesh transform needed.
 * Plane orientation is auto-detected from the bounding box (thinnest axis = normal).
 */

import * as THREE from 'three';
import type { GradientMapState } from '@/store/uiStore';

const GRADIENT_SEGMENTS = 80; // vertices per side — good balance of smoothness vs. cost
const Z_OFFSET = 0.03;        // push plane slightly above surface to avoid z-fighting
const OPACITY = 0.82;

/** Maps a normalised value [0,1] → RGB tuple [0,1] using blue→cyan→green→yellow→red. */
function valueToRGB(t: number): [number, number, number] {
  const c = Math.max(0, Math.min(1, t));
  if (c < 0.25) { const u = c / 0.25;        return [0,     u,     1    ]; }
  if (c < 0.5)  { const u = (c-0.25) / 0.25; return [0,     1,     1-u  ]; }
  if (c < 0.75) { const u = (c-0.5)  / 0.25; return [u,     1,     0    ]; }
  /*    c <= 1 */ const u = (c-0.75) / 0.25; return [1,     1-u,   0    ];
}

export class GradientMapManager {
  private scene: THREE.Scene;
  private mesh: THREE.Mesh | null = null;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  update(state: GradientMapState): void {
    this.clear();

    const { pointValues, boundingBox } = state;
    if (pointValues.length === 0) return;

    // ── Detect plane orientation ──────────────────────────────────────────
    const ranges = [
      boundingBox.max[0] - boundingBox.min[0],
      boundingBox.max[1] - boundingBox.min[1],
      boundingBox.max[2] - boundingBox.min[2],
    ] as [number, number, number];

    let normalAxis = 0 as 0 | 1 | 2;
    if (ranges[1] < ranges[normalAxis]) normalAxis = 1;
    if (ranges[2] < ranges[normalAxis]) normalAxis = 2;

    const gridAxes = ([0, 1, 2] as const).filter((a) => a !== normalAxis) as [0 | 1 | 2, 0 | 1 | 2];
    const axis1 = gridAxes[0]; // horizontal axis of the plane
    const axis2 = gridAxes[1]; // vertical axis of the plane

    // Use actual grid point height along the normal axis (already encodes the user's zOffset)
    // rather than the bbox midpoint, so the plane sits at the correct elevation.
    const normalMid = pointValues[0].position[normalAxis] + Z_OFFSET;

    // ── Compute min/max for the selected metric ───────────────────────────
    const rawValues = pointValues.map((p) => p.value);
    let minVal = state.range?.min ?? Math.min(...rawValues);
    let maxVal = state.range?.max ?? Math.max(...rawValues);
    if (maxVal === minVal) { minVal -= 0.001; maxVal += 0.001; }

    // ── Build geometry in world space ─────────────────────────────────────
    const segs = GRADIENT_SEGMENTS;
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];

    const cols = segs + 1;
    for (let j = 0; j <= segs; j++) {
      for (let i = 0; i <= segs; i++) {
        const u = i / segs;
        const v = j / segs;

        const worldPos: [number, number, number] = [0, 0, 0];
        worldPos[normalAxis] = normalMid;
        worldPos[axis1] = boundingBox.min[axis1] + u * ranges[axis1];
        worldPos[axis2] = boundingBox.min[axis2] + v * ranges[axis2];

        positions.push(worldPos[0], worldPos[1], worldPos[2]);

        // IDW interpolation in 3D
        let wSum = 0;
        let vSum = 0;
        for (const pt of pointValues) {
          const dx = worldPos[0] - pt.position[0];
          const dy = worldPos[1] - pt.position[1];
          const dz = worldPos[2] - pt.position[2];
          const d2 = dx * dx + dy * dy + dz * dz;
          const w = d2 < 1e-10 ? 1e10 : 1 / d2;
          wSum += w;
          vSum += w * pt.value;
        }

        const t = (vSum / wSum - minVal) / (maxVal - minVal);
        const [r, g, b] = valueToRGB(t);
        colors.push(r, g, b);
      }
    }

    for (let j = 0; j < segs; j++) {
      for (let i = 0; i < segs; i++) {
        const a = j * cols + i;
        const b = a + 1;
        const c = (j + 1) * cols + i;
        const d = c + 1;
        indices.push(a, b, d, a, d, c);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color',    new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: OPACITY,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.renderOrder = 100;
    this.mesh.userData.isGradientMap = true;
    // Disable all layers then enable 0 + speckle overlay layer (4)
    this.mesh.layers.disableAll();
    this.mesh.layers.enable(0);
    this.mesh.layers.enable(4);

    this.scene.add(this.mesh);
  }

  clear(): void {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      (this.mesh.material as THREE.Material).dispose();
      this.mesh = null;
    }
  }

  dispose(): void {
    this.clear();
  }

  /** Returns the gradient color CSS string matching valueToRGB */
  static readonly CSS_GRADIENT =
    'linear-gradient(to right, #0000ff, #00ffff, #00ff00, #ffff00, #ff0000)';
}
