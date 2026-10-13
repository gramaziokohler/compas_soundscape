/**
 * Custom Speckle rendering pipelines for the viewport render styles that
 * @speckle/viewer does not ship (Arctic and Rendered use the stock pipelines).
 *
 * Both rely on a pass's `overrideBatchMaterial`: for that pass only, the batcher
 * swaps each mesh batch's BASE material for the override and restores it after
 * (`batcher.overrideBatchMaterial` → `restoreBatchMaterial`). Filter-colored
 * surfaces (user colors) are restyled per frame by FilterMaterialStyler, keeping
 * their color; hidden/ghost, selection and hover materials are left untouched,
 * so these styles compose with applyFilterColors / applyVisibility / selection
 * without any enforcement loop. The batcher clones the override per batch and
 * adds the USE_RTE define when the batch needs it, so large-coordinate models
 * render correctly. Same mechanism as Speckle's own PenViewPipeline.
 */

import { DoubleSide, type Material } from 'three';
import {
  BlendPass,
  DefaultPipeline,
  GeometryPass,
  ObjectLayers,
  ObjectVisibility,
  ProgressivePipeline,
  SpeckleBasicMaterial,
  SpeckleStandardMaterial,
  StencilMaskPass,
  StencilPass,
  ClearFlags,
  type GPass,
  type SpeckleRenderer,
} from '@speckle/viewer';
import { RENDER_STYLE } from '@/utils/constants';
import { FilterMaterialStyler } from '@/lib/three/speckle-filter-material-styler';

/** Layers DefaultPipeline draws in its opaque geometry pass. */
const OPAQUE_LAYERS = [
  ObjectLayers.STREAM_CONTENT,
  ObjectLayers.STREAM_CONTENT_MESH,
  ObjectLayers.STREAM_CONTENT_LINE,
  ObjectLayers.STREAM_CONTENT_POINT,
  ObjectLayers.STREAM_CONTENT_POINT_CLOUD,
  ObjectLayers.PROPS,
];

/** Layers DefaultPipeline draws in its transparent geometry pass. */
const TRANSPARENT_LAYERS = [
  ObjectLayers.STREAM_CONTENT,
  ObjectLayers.STREAM_CONTENT_MESH,
  ObjectLayers.STREAM_CONTENT_LINE,
  ObjectLayers.STREAM_CONTENT_POINT,
  ObjectLayers.STREAM_CONTENT_POINT_CLOUD,
  ObjectLayers.STREAM_CONTENT_TEXT,
  ObjectLayers.SHADOWCATCHER,
];

/** Make `pass` draw mesh batches with `material` instead of their base material. */
function setBatchMaterialOverride(pass: GPass, material: Material): void {
  Object.defineProperty(pass, 'overrideBatchMaterial', {
    get: () => material,
    configurable: true,
  });
}

/**
 * Ghosted: the stock DefaultPipeline (edges on) with every mesh drawn as a
 * faint see-through surface. AO is dropped from the blend (it reads as smudges
 * on transparent faces); edges stay, so the model keeps crisp outlines.
 */
export class GhostedViewPipeline extends DefaultPipeline {
  private readonly ghostMaterial: SpeckleStandardMaterial;
  /** Filter-colored surfaces go translucent too, keeping their color. */
  private readonly filterStyler = new FilterMaterialStyler({
    transparent: true,
    opacity: RENDER_STYLE.GHOST_FILTERED_OPACITY,
    depthWrite: false,
  });

  onBeforePipelineRender(): void {
    super.onBeforePipelineRender();
    this.filterStyler.apply(this.speckleRenderer);
  }

  onAfterPipelineRender(): void {
    this.filterStyler.restore();
    super.onAfterPipelineRender();
  }

  constructor(speckleRenderer: SpeckleRenderer) {
    super(speckleRenderer, { edges: true });

    this.ghostMaterial = new SpeckleStandardMaterial({
      color: RENDER_STYLE.GHOST_COLOR,
      transparent: true,
      opacity: RENDER_STYLE.GHOST_OPACITY,
      depthWrite: false,
      side: DoubleSide,
      roughness: 1,
      metalness: 0,
    });

    const allPasses = new Set<GPass>([
      ...this.dynamicStage,
      ...this.progressiveStage,
      ...this.passthroughStage,
    ]);
    allPasses.forEach((pass) => {
      if (pass instanceof GeometryPass && pass.visibility === ObjectVisibility.OPAQUE) {
        setBatchMaterialOverride(pass, this.ghostMaterial);
      } else if (pass instanceof BlendPass) {
        pass.options = { blendAO: false };
      }
    });
  }
}

/** Opaque geometry pass that draws mesh batches as a triangle wireframe. */
class WireframeGeometryPass extends GeometryPass {
  constructor(private readonly wireMaterial: Material) {
    super();
  }

  get overrideBatchMaterial(): Material {
    return this.wireMaterial;
  }
}

/**
 * Wireframe: every mesh triangle edge, see-through. Built from Speckle's public
 * passes like DefaultPipeline, minus the depth/AO/edge passes (their solid
 * depth would shade surfaces that are no longer drawn). Keeps the selection
 * stencil outline and the OVERLAY pass (sound spheres, receivers, labels).
 */
export class WireframeViewPipeline extends ProgressivePipeline {
  /** Filter-colored surfaces are drawn as wireframe too, in their own color. */
  private readonly filterStyler = new FilterMaterialStyler({ wireframe: true });

  onBeforePipelineRender(): void {
    super.onBeforePipelineRender();
    this.filterStyler.apply(this.speckleRenderer);
  }

  onAfterPipelineRender(): void {
    this.filterStyler.restore();
    super.onAfterPipelineRender();
  }

  constructor(speckleRenderer: SpeckleRenderer) {
    super(speckleRenderer);

    const wireMaterial = new SpeckleBasicMaterial({
      color: RENDER_STYLE.WIREFRAME_COLOR,
      wireframe: true,
      transparent: true,
      opacity: RENDER_STYLE.WIREFRAME_OPACITY,
      side: DoubleSide,
    });

    const stencilPass = new StencilPass();
    stencilPass.setVisibility(ObjectVisibility.STENCIL);
    stencilPass.setLayers([ObjectLayers.STREAM_CONTENT_MESH]);

    const opaquePass = new WireframeGeometryPass(wireMaterial);
    opaquePass.setLayers(OPAQUE_LAYERS);
    opaquePass.setVisibility(ObjectVisibility.OPAQUE);

    const transparentPass = new GeometryPass();
    transparentPass.setLayers(TRANSPARENT_LAYERS);
    transparentPass.setVisibility(ObjectVisibility.TRANSPARENT);

    const stencilMaskPass = new StencilMaskPass();
    stencilMaskPass.setVisibility(ObjectVisibility.STENCIL);
    stencilMaskPass.setLayers([ObjectLayers.STREAM_CONTENT_MESH]);
    stencilMaskPass.setClearFlags(ClearFlags.DEPTH);

    const overlayPass = new GeometryPass();
    overlayPass.setLayers([ObjectLayers.OVERLAY, ObjectLayers.MEASUREMENTS]);

    const passes: GPass[] = [stencilPass, opaquePass, transparentPass, stencilMaskPass, overlayPass];
    this.dynamicStage.push(...passes);
    this.progressiveStage.push(...passes);
    this.passthroughStage.push(...passes);
    this.passList = this.dynamicStage;
  }
}
