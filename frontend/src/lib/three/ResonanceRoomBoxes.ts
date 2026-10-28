/**
 * Per-card BoundingBoxManager registry for independent ShoeBox rooms.
 */

import * as THREE from 'three';
import { BoundingBoxManager, type BoundingBoxBounds } from './BoundingBoxManager';

export class ResonanceRoomBoxes {
  private rooms = new Map<string, BoundingBoxManager>();
  private scratch: BoundingBoxManager;

  constructor(private scene: THREE.Scene) {
    this.scratch = new BoundingBoxManager(scene);
  }

  get(id: string): BoundingBoxManager | undefined {
    return this.rooms.get(id);
  }

  ensure(id: string): BoundingBoxManager {
    let manager = this.rooms.get(id);
    if (!manager) {
      manager = new BoundingBoxManager(this.scene);
      this.rooms.set(id, manager);
    }
    return manager;
  }

  sync(ids: Iterable<string>): void {
    const keep = new Set(ids);
    for (const [id, manager] of [...this.rooms.entries()]) {
      if (keep.has(id)) continue;
      manager.dispose();
      this.rooms.delete(id);
    }
    for (const id of keep) this.ensure(id);
  }

  forEach(fn: (id: string, manager: BoundingBoxManager) => void): void {
    this.rooms.forEach((manager, id) => fn(id, manager));
  }

  anyJustFinishedDragging(): boolean {
    for (const manager of this.rooms.values()) {
      if (manager.isDragging || manager.justFinishedDragging) return true;
    }
    return false;
  }

  allGumballHandles(): THREE.Mesh[] {
    const handles: THREE.Mesh[] = [];
    for (const manager of this.rooms.values()) handles.push(...manager.gumballHandles);
    return handles;
  }

  updateScreenSpaceScale(camera: THREE.PerspectiveCamera): void {
    for (const manager of this.rooms.values()) manager.updateScreenSpaceScale(camera);
  }

  calculateBoundsFromSpeckleBatches(viewer: unknown): BoundingBoxBounds | null {
    return this.scratch.calculateBoundsFromSpeckleBatches(viewer);
  }

  calculateEffectiveBounds(
    geometryBounds: BoundingBoxBounds | null,
    soundPositions: THREE.Vector3[],
  ): BoundingBoxBounds | null {
    return this.scratch.calculateEffectiveBounds(geometryBounds, soundPositions);
  }

  dispose(): void {
    for (const manager of this.rooms.values()) manager.dispose();
    this.rooms.clear();
    this.scratch.dispose();
  }
}
