/**
 * Occludable pass: draws the objects on OCCLUSION_GHOST.LAYER (sound spheres,
 * direction cones, listeners, grid listeners and their occlusion ghosts) while
 * the model's depth is still in the depth buffer.
 *
 * Why a pass of its own: every Speckle pipeline runs its STENCIL-MASK pass with
 * `ClearFlags.DEPTH` right before the OVERLAY pass, so anything on the OVERLAY
 * layer is drawn on top of the model and can never tell it is hidden. Objects
 * on the occludable layer are depth-tested against the model instead: in view
 * they draw normally, behind a wall only their faint ghost shows
 * (lib/three/occlusion-ghost.ts).
 *
 * Every stage of the pipeline is reordered in place to
 *   … geometry / AO / edge blend passes, OCCLUDABLE, STENCIL-MASK, OVERLAY
 * i.e. the stencil mask (which clears depth) moves after the AO / edge blend
 * passes, so AO and edges never darken the occludable objects. The blend passes
 * neither test nor write depth, so the model depth survives until our pass.
 *
 * Usage (speckle-render-style.ts, after any pipeline is installed):
 * ```ts
 * installOccludablePass(renderer.pipeline);
 * ```
 */

import { GeometryPass, ObjectLayers, type GPass, type Pipeline } from '@speckle/viewer';
import { OCCLUSION_GHOST } from '@/utils/constants';

const STENCIL_MASK_PASS = 'STENCIL-MASK';

/** The stage arrays are `protected` on ProgressivePipeline; every stock and custom pipeline we use extends it. */
interface StagedPipeline {
  dynamicStage?: GPass[];
  progressiveStage?: GPass[];
  passthroughStage?: GPass[];
}

const patchedPipelines = new WeakSet<Pipeline>();

function isOverlayPass(pass: GPass): boolean {
  return pass instanceof GeometryPass && pass.enabledLayers.includes(ObjectLayers.OVERLAY);
}

/** Put `occludable` (and the depth-clearing stencil mask) right before the OVERLAY pass. */
function patchStage(stage: GPass[], occludable: GPass): void {
  if (stage.includes(occludable)) return;
  const maskIndex = stage.findIndex((p) => p.displayName === STENCIL_MASK_PASS);
  const mask = maskIndex >= 0 ? stage.splice(maskIndex, 1)[0] : null;
  const overlayIndex = stage.findIndex(isOverlayPass);
  const insertAt = overlayIndex >= 0 ? overlayIndex : stage.length;
  stage.splice(insertAt, 0, ...(mask ? [occludable, mask] : [occludable]));
}

/** Add the occludable pass to `pipeline` (idempotent; arrays are mutated in place). */
export function installOccludablePass(pipeline: Pipeline): void {
  if (patchedPipelines.has(pipeline)) return;
  patchedPipelines.add(pipeline);

  const occludable = new GeometryPass();
  // A plain three.js layer index outside Speckle's ObjectLayers enum (verified unused).
  occludable.setLayers([OCCLUSION_GHOST.LAYER as ObjectLayers]);

  // System boundary: reaching the protected stage arrays (same as useSpeckleDarkMode).
  const staged = pipeline as unknown as StagedPipeline;
  [staged.dynamicStage, staged.progressiveStage, staged.passthroughStage].forEach((stage) => {
    if (stage) patchStage(stage, occludable);
  });
}
