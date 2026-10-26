/**
 * PffdtdFieldPlane
 *
 * One oriented textured plane: the horizontal animation plane, or a
 * horizontal / vertical (YZ, XZ) slice of the strength-G volume, nudged along
 * its normal by the gradient-map offset. A `PlaneGeometry` with a
 * `MeshBasicMaterial` whose RGBA8 `DataTexture` holds one texel per cell of
 * the `PffdtdTexelGrid` (nu × nv). The SPL map uses the sequential colormap,
 * animation frames the diverging LUT; wall cells are dark, outside cells
 * transparent. Playback and slice moves along the same grid only rewrite the
 * texture data.
 */

import * as THREE from 'three';
import { PFFDTD_VISUALS } from '@/utils/constants';
import { getCssColorHex } from '@/utils/utils';
import { buildDivergingLut, valueToRGB } from './colormaps';
import { PFFDTD_MASK, type PffdtdTexelGrid } from '@/types/pffdtd';

// Speckle renders custom objects only on ObjectLayers.OVERLAY (4).
const SPECKLE_OVERLAY_LAYER = 4;
const INT8_MAX = 127;

export class PffdtdFieldPlane {
  private readonly scene: THREE.Scene;
  private mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null;
  private texture: THREE.DataTexture | null = null;
  private data: Uint8Array | null = null;
  /** Texel grid the current mesh was built for (serialised). */
  private gridKey: string | null = null;
  private readonly lut = buildDivergingLut(PFFDTD_VISUALS.LUT_SIZE);

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /** Strength-G SPL texels (dB, NaN outside) coloured over [range.min, range.max]. */
  showSpl(grid: PffdtdTexelGrid, spl: Float32Array, range: { min: number; max: number }, mask: Uint8Array | null): void {
    const data = this.ensure(grid);
    const span = range.max - range.min || 1;
    const wall = this.wallRGB();
    for (let i = 0; i < grid.nu * grid.nv; i++) {
      const m = mask?.[i] ?? PFFDTD_MASK.AIR;
      const v = spl[i];
      const o = i * 4;
      if (m === PFFDTD_MASK.WALL) { this.write(data, o, wall[0], wall[1], wall[2], 255); continue; }
      if (m === PFFDTD_MASK.OUTSIDE || !Number.isFinite(v)) { this.write(data, o, 0, 0, 0, 0); continue; }
      const [r, g, b] = valueToRGB((v - range.min) / span);
      this.write(data, o, r * 255, g * 255, b * 255, 255);
    }
    this.commit();
  }

  /** One int8 animation frame (value = q / 127 · vmax), symmetric diverging colours. */
  showFrame(grid: PffdtdTexelGrid, frame: Int8Array, mask: Uint8Array | null): void {
    const data = this.ensure(grid);
    const wall = this.wallRGB();
    const last = PFFDTD_VISUALS.LUT_SIZE - 1;
    for (let i = 0; i < grid.nu * grid.nv; i++) {
      const m = mask?.[i] ?? PFFDTD_MASK.AIR;
      const o = i * 4;
      if (m === PFFDTD_MASK.WALL) { this.write(data, o, wall[0], wall[1], wall[2], 255); continue; }
      if (m === PFFDTD_MASK.OUTSIDE) { this.write(data, o, 0, 0, 0, 0); continue; }
      const k = Math.round(((frame[i] + INT8_MAX) / (2 * INT8_MAX)) * last) * 3;
      this.write(data, o, this.lut[k], this.lut[k + 1], this.lut[k + 2], 255);
    }
    this.commit();
  }

  clear(): void {
    if (!this.mesh) return;
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.texture?.dispose();
    this.mesh = null;
    this.texture = null;
    this.data = null;
    this.gridKey = null;
  }

  dispose(): void {
    this.clear();
  }

  /** (Re)build the plane when the grid changes; returns the texel buffer. */
  private ensure(grid: PffdtdTexelGrid): Uint8Array {
    const key = JSON.stringify(grid);
    if (this.mesh && this.data && this.gridKey === key) return this.data;
    this.clear();

    const data = new Uint8Array(grid.nu * grid.nv * 4);
    const texture = new THREE.DataTexture(data, grid.nu, grid.nv, THREE.RGBAFormat, THREE.UnsignedByteType);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.LinearFilter;

    // Texel (iu, iv) centre = origin + iu·du·u + iv·dv·v: the plane spans whole cells.
    // Local +x / +y of the PlaneGeometry (texture u / v) map onto uDir / vDir.
    const u = new THREE.Vector3(...grid.uDir);
    const v = new THREE.Vector3(...grid.vDir);
    const normal = new THREE.Vector3().crossVectors(u, v);
    const geometry = new THREE.PlaneGeometry(grid.nu * grid.du, grid.nv * grid.dv);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: PFFDTD_VISUALS.PLANE_OPACITY,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(u, v, normal));
    mesh.position
      .set(...grid.origin)
      .addScaledVector(u, ((grid.nu - 1) * grid.du) / 2)
      .addScaledVector(v, ((grid.nv - 1) * grid.dv) / 2)
      .addScaledVector(normal, PFFDTD_VISUALS.PLANE_Z_OFFSET_M);
    mesh.renderOrder = PFFDTD_VISUALS.RENDER_ORDER;
    mesh.frustumCulled = false;
    mesh.layers.disableAll();
    mesh.layers.enable(0);
    mesh.layers.enable(SPECKLE_OVERLAY_LAYER);
    mesh.raycast = () => undefined;
    mesh.userData.isPffdtdFieldPlane = true;

    this.scene.add(mesh);
    this.mesh = mesh;
    this.texture = texture;
    this.data = data;
    this.gridKey = key;
    return data;
  }

  private commit(): void {
    if (this.texture) this.texture.needsUpdate = true;
  }

  private wallRGB(): [number, number, number] {
    const hex = getCssColorHex(PFFDTD_VISUALS.COLOR_VARS.WALL);
    return [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff];
  }

  private write(data: Uint8Array, o: number, r: number, g: number, b: number, a: number): void {
    data[o] = r;
    data[o + 1] = g;
    data[o + 2] = b;
    data[o + 3] = a;
  }
}
