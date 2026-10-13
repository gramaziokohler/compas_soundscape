import { useEffect } from 'react';
import { useUIStore } from '@/store';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import type { ViewMode } from '@/store/speckleStore';
import type { RenderStyle } from '@/types';
import { applyRenderStyle } from '@/lib/three/speckle-render-style';

/**
 * Applies the user's viewport render style (bottom-bar dropdown) to the viewer.
 *
 * The Sounds view mode ('dark') owns its lighting: useSpeckleDarkMode hooks the
 * GEOMETRY passes of the pipeline that is current when it enables, so it always
 * runs on the stock 'rendered' pipeline. The chosen style comes back when the
 * user leaves Sounds.
 *
 * MUST be called before useSpeckleDarkMode in SpeckleScene: both effects react
 * to the view mode, and React runs effects in declaration order, so the pipeline
 * is restored before dark mode hooks its passes.
 */
export function useSpeckleRenderStyle({
  isViewerReady,
  viewMode,
}: {
  isViewerReady: boolean;
  viewMode: ViewMode;
}): void {
  const renderStyle = useUIStore((s) => s.renderStyle);
  const effectiveStyle: RenderStyle = viewMode === 'dark' ? 'rendered' : renderStyle;

  useEffect(() => {
    if (!isViewerReady) return;
    const { viewer } = useSpeckleEngineStore.getState();
    if (!viewer) return;
    try {
      applyRenderStyle(viewer, effectiveStyle);
    } catch (err) {
      console.error('[useSpeckleRenderStyle] Failed to apply render style:', effectiveStyle, err);
    }
  }, [isViewerReady, effectiveStyle]);
}
