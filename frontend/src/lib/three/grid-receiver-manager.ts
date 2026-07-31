import * as THREE from 'three';
import { SpeckleStandardMaterial } from '@speckle/viewer';
import { RECEIVER_CONFIG } from '@/utils/constants';
import { getCssColorHex } from '@/utils/utils';
import {
  loadHeadphonesGeometry,
  invalidateHeadphonesCache,
  type HeadphonesGeometryResult,
} from '@/lib/three/headphones-loader';

const MAX_GRID_INSTANCES = 5000;

/**
 * GridReceiverManager
 *
 * Renders grid listener points using a single InstancedMesh (one geometry + one material).
 * Slider changes only update instance matrices — no material or geometry recreation.
 */
export class GridReceiverManager {
  private scene: THREE.Scene;
  private parentGroup: THREE.Group | null;
  private scaleForSounds: number;
  private instancedMesh: THREE.InstancedMesh | null = null;
  private positions: [number, number, number][] = [];
  private pointIds: string[] = [];
  private readonly dummy = new THREE.Object3D();
  private gridListenerId: string | null = null;
  private headphonesGeomResult: HeadphonesGeometryResult | null = null;
  private headphonesLoadInitiated = false;
  // Instance indices hidden while viewing through them in FPS mode (zero-scale).
  private hiddenIndices: Set<number> = new Set();

  constructor(scene: THREE.Scene, scaleForSounds: number, parentGroup?: THREE.Group) {
    this.scene = scene;
    this.scaleForSounds = scaleForSounds;
    this.parentGroup = parentGroup || null;
    this.ensureHeadphonesGeometry();
  }

  private ensureHeadphonesGeometry(): void {
    if (this.headphonesGeomResult || this.headphonesLoadInitiated) return;
    this.headphonesLoadInitiated = true;
    loadHeadphonesGeometry(this.scaleForSounds)
      .then((result) => {
        this.headphonesGeomResult = result;
        // If the InstancedMesh was already created with a cube fallback,
        // dispose it so the next updatePoints rebuilds with the OBJ geometry.
        if (this.instancedMesh) {
          const target = this.parentGroup || this.scene;
          target.remove(this.instancedMesh);
          this.instancedMesh.geometry.dispose();
          (this.instancedMesh.material as THREE.Material).dispose();
          this.instancedMesh = null;
        }
      })
      .catch((err) => {
        console.warn('[GridReceiverManager] Headphones.obj load failed, using cube fallback:', err);
      });
  }

  private ensureInstancedMesh(): THREE.InstancedMesh {
    if (this.instancedMesh) return this.instancedMesh;

    const baseHalfSize = RECEIVER_CONFIG.CUBE_SIZE_MULTIPLIER * this.scaleForSounds;
    let geom: THREE.BufferGeometry;

    if (this.headphonesGeomResult) {
      geom = this.headphonesGeomResult.geometry;
    } else {
      geom = new THREE.BoxGeometry(baseHalfSize * 2, baseHalfSize * 2, baseHalfSize * 2);
    }

    const mat = new SpeckleStandardMaterial({
      color: getCssColorHex('--color-receiver'),
      emissive: getCssColorHex('--color-receiver'),
      emissiveIntensity: RECEIVER_CONFIG.EMISSIVE_INTENSITY,
      roughness: RECEIVER_CONFIG.ROUGHNESS,
      metalness: RECEIVER_CONFIG.METALNESS,
      transparent: false,
      depthWrite: true,
      depthTest: true,
      side: THREE.FrontSide,
    });

    const origOnBeforeRender = mat.onBeforeRender.bind(mat);
    mat.onBeforeRender = (renderer: any, _scene: any, camera: any, geometry: any, object: any) => {
      const rt = renderer.getRenderTarget();
      if (rt?.texture && Array.isArray(rt.texture)) return;
      if (origOnBeforeRender) origOnBeforeRender(renderer, _scene, camera, geometry, object);
    };

    const mesh = new THREE.InstancedMesh(geom, mat, MAX_GRID_INSTANCES);
    mesh.count = 0;
    mesh.userData.isGridListener = true;
    mesh.userData.customObjectType = 'grid-receiver';
    mesh.layers.disableAll();
    mesh.layers.enable(0);
    mesh.layers.enable(4);

    const target = this.parentGroup || this.scene;
    target.add(mesh);
    this.instancedMesh = mesh;
    return mesh;
  }

  public setGridListenerId(id: string | null): void { this.gridListenerId = id; }
  public getGridListenerId(): string | null { return this.gridListenerId; }
  public setVisible(visible: boolean): void {
    if (this.instancedMesh) this.instancedMesh.visible = visible;
  }
  public getPositions(): [number, number, number][] { return this.positions; }
  /** Returns the point ID for a given instance index, or null if out of range. */
  public getPointId(instanceId: number): string | null {
    return this.pointIds[instanceId] ?? null;
  }

  /**
   * Hide or show a single grid listener instance (by instance index). Hidden
   * instances are rendered with zero scale, so they disappear while the rest
   * of the grid stays visible.
   */
  public setInstanceVisible(instanceIndex: number, visible: boolean): void {
    if (visible) {
      this.hiddenIndices.delete(instanceIndex);
    } else {
      this.hiddenIndices.add(instanceIndex);
    }
    if (this.instancedMesh && instanceIndex < this.instancedMesh.count) {
      this.applyInstanceMatrix(instanceIndex);
      this.instancedMesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** Find the instance index whose position matches the given position (within epsilon). */
  public findInstanceAtPosition(position: THREE.Vector3): number | null {
    const EPS = 1e-3;
    for (let i = 0; i < this.positions.length; i++) {
      const p = this.positions[i];
      if (
        Math.abs(p[0] - position.x) < EPS &&
        Math.abs(p[1] - position.y) < EPS &&
        Math.abs(p[2] - position.z) < EPS
      ) {
        return i;
      }
    }
    return null;
  }

  /** Write the matrix for one instance, honouring the hidden (zero-scale) state. */
  private applyInstanceMatrix(index: number, scale?: number): void {
    const pos = this.positions[index];
    if (!pos) return;
    this.dummy.position.fromArray(pos);
    const s = this.hiddenIndices.has(index) ? 0 : (scale ?? 1);
    this.dummy.scale.setScalar(s);
    this.dummy.rotation.set(0, 0, Math.PI); // yaw=0 → OBJ Y-axis faces -Y (forward)
    this.dummy.updateMatrix();
    this.instancedMesh!.setMatrixAt(index, this.dummy.matrix);
  }

  public updatePoints(points: [number, number, number][], pointIds?: string[]): void {
    this.positions = points;
    this.pointIds = pointIds ?? [];

    if (points.length === 0) {
      if (this.instancedMesh) this.instancedMesh.count = 0;
      return;
    }

    const mesh = this.ensureInstancedMesh();
    const count = Math.min(points.length, MAX_GRID_INSTANCES);

    for (let i = 0; i < count; i++) {
      this.applyInstanceMatrix(i, 1);
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
  }

  public updateScreenSpaceScale(camera: THREE.PerspectiveCamera): void {
    if (!this.instancedMesh || this.positions.length === 0) return;

    const baseHalfSize = this.headphonesGeomResult
      ? this.headphonesGeomResult.baseHalfSize
      : RECEIVER_CONFIG.CUBE_SIZE_MULTIPLIER * this.scaleForSounds;
    const count = this.instancedMesh.count;

    for (let i = 0; i < count; i++) {
      const pos = this.positions[i];
      if (!pos) continue;
      const dx = camera.position.x - pos[0];
      const dy = camera.position.y - pos[1];
      const dz = camera.position.z - pos[2];
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < 0.01) continue;
      const raw = (dist * RECEIVER_CONFIG.SCREEN_SPACE_SIZE) / baseHalfSize;
      const scale = Math.max(RECEIVER_CONFIG.MIN_SCALE, Math.min(RECEIVER_CONFIG.MAX_SCALE, raw));
      this.applyInstanceMatrix(i, scale);
    }
    this.instancedMesh.instanceMatrix.needsUpdate = true;
  }

  public updateScale(scaleForSounds: number): void {
    this.scaleForSounds = scaleForSounds;
    this.headphonesGeomResult = null;
    this.headphonesLoadInitiated = false;
    invalidateHeadphonesCache();
    this.ensureHeadphonesGeometry();
    if (this.instancedMesh) {
      const target = this.parentGroup || this.scene;
      target.remove(this.instancedMesh);
      this.instancedMesh.geometry.dispose();
      (this.instancedMesh.material as THREE.Material).dispose();
      this.instancedMesh = null;
      this.hiddenIndices.clear();
      const pts = this.positions;
      const ids = this.pointIds;
      this.positions = [];
      this.pointIds = [];
      this.updatePoints(pts, ids);
    }
  }

  public dispose(): void {
    if (this.instancedMesh) {
      const target = this.parentGroup || this.scene;
      target.remove(this.instancedMesh);
      this.instancedMesh.geometry.dispose();
      (this.instancedMesh.material as THREE.Material).dispose();
      this.instancedMesh = null;
    }
    this.positions = [];
    this.pointIds = [];
    this.hiddenIndices.clear();
  }
}
