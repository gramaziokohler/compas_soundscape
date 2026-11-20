/**
 * useWebGLContextRecovery — watches the viewer canvas for `webglcontextlost` (the GPU
 * process reset or dropped this tab's context, e.g. out of graphics memory). The tab
 * itself survives, so instead of a dead black viewer the scene shows a recovery panel;
 * "Reload 3D view" re-creates only the viewer (modelVersionStore.reloadViewer), while
 * sound, timeline and sidebars keep running. preventDefault lets the browser restore
 * the context, but Speckle does not re-upload its buffers, so a reload is still needed.
 */
import { useCallback, useEffect, useState } from 'react';
import { useModelVersionStore } from '@/store';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';

export function useWebGLContextRecovery(): { contextLost: boolean; reloadViewer: () => void } {
  const [contextLost, setContextLost] = useState(false);

  useEffect(() => {
    let canvas: HTMLCanvasElement | null = null;
    const onLost = (event: Event) => {
      event.preventDefault();
      setContextLost(true);
    };
    const attach = () => {
      const next = useSpeckleEngineStore.getState().viewer?.getRenderer()?.renderer?.domElement ?? null;
      if (next === canvas) return;
      canvas?.removeEventListener('webglcontextlost', onLost);
      next?.addEventListener('webglcontextlost', onLost);
      canvas = next;
      setContextLost(false);
    };
    attach();
    const unsubscribe = useSpeckleEngineStore.subscribe((state, prev) => {
      if (state.viewer !== prev.viewer) attach();
    });
    return () => {
      unsubscribe();
      canvas?.removeEventListener('webglcontextlost', onLost);
    };
  }, []);

  const reloadViewer = useCallback(() => {
    setContextLost(false);
    useModelVersionStore.getState().reloadViewer();
  }, []);

  return { contextLost, reloadViewer };
}
