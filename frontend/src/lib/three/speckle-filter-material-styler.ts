/**
 * Restyles the FILTER materials of Speckle mesh batches for the length of one
 * frame — the surfaces colored via FilteringExtension.setUserObjectColors
 * (Acoustics material colors, sound-linked objects, analysis groups).
 *
 * A pass's `overrideBatchMaterial` only replaces a batch's BASE material, so a
 * render style built on it would leave every filtered surface solid. This
 * styler covers the rest: called from a pipeline's onBeforePipelineRender, it
 * patches each opaque filter material in place (keeping its color), and
 * restore() puts the original values back in onAfterPipelineRender.
 *
 * Safe w.r.t. Speckle's draw ranges: the pipeline computes the opaque /
 * transparent group ranges BEFORE onBeforePipelineRender, so patched groups are
 * still drawn exactly once (in the opaque pass) for this frame.
 *
 * Left untouched:
 *  - the batch's base material (handled by the pipeline's override),
 *  - stencil-writing materials (selection highlight — it stays solid; hover is
 *    a separate border overlay, see speckle-hover-outline.ts),
 *  - hidden (visible = false) and already-transparent materials (ghost filter).
 */

import type { Material } from 'three';
import { GeometryType, type SpeckleRenderer } from '@speckle/viewer';

/** Material properties a render style may patch on filter materials. */
export interface FilterMaterialPatch {
  transparent?: boolean;
  opacity?: number;
  depthWrite?: boolean;
  wireframe?: boolean;
}

type PatchKey = keyof FilterMaterialPatch;
type PatchableMaterial = Material & { wireframe?: boolean };

export class FilterMaterialStyler {
  private saved: Array<{ material: PatchableMaterial; values: FilterMaterialPatch }> = [];

  constructor(private readonly patch: FilterMaterialPatch) {}

  /** Patch every opaque filter material of every mesh batch. */
  apply(renderer: SpeckleRenderer): void {
    this.restore();
    const seen = new Set<Material>();
    const batches = Object.values(renderer.batcher.batches);
    for (const batch of batches) {
      if (batch.geometryType !== GeometryType.MESH) continue;
      const material = (batch.renderObject as unknown as { material?: Material | Material[] }).material;
      const materials = Array.isArray(material) ? material : material ? [material] : [];
      for (const m of materials) {
        if (seen.has(m)) continue;
        seen.add(m);
        if (m === batch.batchMaterial || m.stencilWrite || !m.visible || m.transparent) continue;
        this.patchMaterial(m as PatchableMaterial);
      }
    }
  }

  /** Put back every value changed by the last apply(). */
  restore(): void {
    for (const { material, values } of this.saved) Object.assign(material, values);
    this.saved = [];
  }

  private patchMaterial(material: PatchableMaterial): void {
    const values: FilterMaterialPatch = {};
    (Object.keys(this.patch) as PatchKey[]).forEach((key) => {
      if (key === 'wireframe' && !('wireframe' in material)) return;
      (values as Record<PatchKey, unknown>)[key] = material[key];
      (material as Record<PatchKey, unknown>)[key] = this.patch[key];
    });
    this.saved.push({ material, values });
  }
}
