/**
 * Viewport render style applier — owns `SpeckleRenderer.pipeline`.
 *
 * Deliberately does NOT use Speckle's ViewModes extension: its setViewMode() is
 * a no-op when the requested mode equals its cached mode, so after one of our
 * custom pipelines (Ghosted / Wireframe) "back to DEFAULT" would silently do
 * nothing. Instead every style swaps the pipeline directly — exactly what
 * ViewModes.updateViewModes does — and the edge options are pushed the same way
 * ViewModes.updateViewModeOptions does.
 */

import {
  ArcticViewPipeline,
  DefaultEdgesPassOptions,
  DefaultPipeline,
  EdgesPass,
  UpdateFlags,
  type Pipeline,
  type SpeckleRenderer,
  type Viewer,
} from '@speckle/viewer';
import type { RenderStyle } from '@/types';
import { RENDER_STYLE } from '@/utils/constants';
import { GhostedViewPipeline, WireframeViewPipeline } from '@/lib/three/speckle-render-pipelines';

/** Last style applied per viewer — a re-created viewer starts with no entry. */
const appliedStyles = new WeakMap<Viewer, RenderStyle>();

function createPipeline(renderer: SpeckleRenderer, style: RenderStyle): Pipeline {
  switch (style) {
    case 'ghosted':
      return new GhostedViewPipeline(renderer);
    case 'arctic':
      return new ArcticViewPipeline(renderer, { edges: true });
    case 'wireframe':
      return new WireframeViewPipeline(renderer);
    case 'rendered':
    default:
      return new DefaultPipeline(renderer, { edges: true });
  }
}

/** Push outline options + a world-relative depth bias to every EDGES pass. */
function applyEdgeOptions(viewer: Viewer, pipeline: Pipeline): void {
  const depthBias = viewer.World.getRelativeOffset(DefaultEdgesPassOptions.depthBias);
  pipeline.getPass('EDGES').forEach((pass) => {
    if (!(pass instanceof EdgesPass)) return;
    pass.options = {
      outlineThickness: RENDER_STYLE.EDGE_OUTLINE_THICKNESS,
      outlineOpacity: RENDER_STYLE.EDGE_OUTLINE_OPACITY,
      outlineColor: RENDER_STYLE.EDGE_OUTLINE_COLOR,
      depthBias,
    };
  });
}

/**
 * Switch the viewer to `style`. Idempotent: re-applying the current style is a
 * no-op, so callers can invoke it on every relevant state change.
 */
export function applyRenderStyle(viewer: Viewer, style: RenderStyle): void {
  if (appliedStyles.get(viewer) === style) return;
  // The viewer starts on the stock DefaultPipeline — nothing to swap.
  if (!appliedStyles.has(viewer) && style === 'rendered') {
    appliedStyles.set(viewer, style);
    return;
  }

  const renderer = viewer.getRenderer();
  const pipeline = createPipeline(renderer, style);
  // The setter re-applies clipping planes, resets and resizes the pipeline.
  renderer.pipeline = pipeline;
  // 'rendered' keeps the stock edge options so it looks exactly like the
  // viewer's initial pipeline.
  if (style !== 'rendered') applyEdgeOptions(viewer, pipeline);
  appliedStyles.set(viewer, style);
  viewer.requestRender(UpdateFlags.RENDER_RESET);
}
