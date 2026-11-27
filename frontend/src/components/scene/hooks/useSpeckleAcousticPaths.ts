import { useEffect, useMemo, useRef } from 'react';
import { shownPathsFocus, useAcousticPathsStore } from '@/store';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import { AcousticPathsOverlay } from '@/lib/three/acoustic-paths-overlay';
import { pairPaths } from '@/lib/acoustics/acoustic-paths';

/**
 * Scene bridge of the sound-path view (acousticPathsStore): draws the stored paths (direct sound,
 * image-source reflections, optional diffracted paths) of the IR hovered in a simulation card's
 * IR list, else of the selected one.
 */
export function useSpeckleAcousticPaths({ isViewerReady }: { isViewerReady: boolean }) {
  const focus = useAcousticPathsStore(shownPathsFocus);
  const payload = useAcousticPathsStore((s) => {
    const shown = shownPathsFocus(s);
    return shown ? s.payloads[shown.configId] ?? null : null;
  });
  const paths = useMemo(
    () => (focus && payload ? pairPaths(payload, focus.sourceId, focus.receiverId) : null),
    [focus, payload],
  );

  const overlayRef = useRef<AcousticPathsOverlay | null>(null);

  // Own the overlay for the lifetime of the viewer.
  useEffect(() => {
    const { viewer } = useSpeckleEngineStore.getState();
    if (!isViewerReady || !viewer) return;
    const overlay = new AcousticPathsOverlay(viewer.getRenderer().scene);
    overlayRef.current = overlay;
    return () => {
      overlay.dispose();
      overlayRef.current = null;
      useSpeckleEngineStore.getState().viewer?.requestRender();
    };
  }, [isViewerReady]);

  // (Re)draw for the shown pair.
  useEffect(() => {
    const overlay = overlayRef.current;
    const { viewer } = useSpeckleEngineStore.getState();
    if (!overlay || !viewer) return;
    overlay.render(paths);
    viewer.requestRender();
  }, [isViewerReady, paths]);
}
