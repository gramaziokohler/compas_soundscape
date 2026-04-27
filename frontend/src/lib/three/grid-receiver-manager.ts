import * as THREE from 'three';
import { SpeckleStandardMaterial } from '@speckle/viewer';
import { RECEIVER_CONFIG } from '@/utils/constants';

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

  constructor(scene: THREE.Scene, scaleForSounds: number, parentGroup?: THREE.Group) {
    this.scene = scene;
    this.scaleForSounds = scaleForSounds;
    this.parentGroup = parentGroup || null;
  }

  private ensureInstancedMesh(): THREE.InstancedMesh {
    if (this.instancedMesh) return this.instancedMesh;

    const cubeSize = RECEIVER_CONFIG.CUBE_SIZE_MULTIPLIER * this.scaleForSounds;
    const geom = new THREE.BoxGeometry(cubeSize, cubeSize, cubeSize);

    const mat = new SpeckleStandardMaterial({
      color: RECEIVER_CONFIG.COLOR,
      emissive: RECEIVER_CONFIG.COLOR,
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
  public getPositions(): [number, number, number][] { return this.positions; }
  /** Returns the point ID for a given instance index, or null if out of range. */
  public getPointId(instanceId: number): string | null {
    return this.pointIds[instanceId] ?? null;
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
      this.dummy.position.fromArray(points[i]);
      this.dummy.scale.setScalar(1);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(i, this.dummy.matrix);
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
  }

  public updateScreenSpaceScale(camera: THREE.PerspectiveCamera): void {
    if (!this.instancedMesh || this.positions.length === 0) return;

    const baseHalfSize = RECEIVER_CONFIG.CUBE_SIZE_MULTIPLIER * this.scaleForSounds;
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
      this.dummy.position.fromArray(pos);
      this.dummy.scale.setScalar(scale);
      this.dummy.updateMatrix();
      this.instancedMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.instancedMesh.instanceMatrix.needsUpdate = true;
  }

  public updateScale(scaleForSounds: number): void {
    this.scaleForSounds = scaleForSounds;
    if (this.instancedMesh) {
      const target = this.parentGroup || this.scene;
      target.remove(this.instancedMesh);
      this.instancedMesh.geometry.dispose();
      (this.instancedMesh.material as THREE.Material).dispose();
      this.instancedMesh = null;
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
  }
}
