import { useEffect, useMemo, useRef } from 'react';
import { useAcousticsSimulationStore, usePffdtdFreeStore } from '@/store';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import { PffdtdFreeGridOverlay } from '@/lib/three/pffdtd-free-grid-overlay';

/**
 * Scene bridge of the wave-based free-positioning grid: shows the active
 * card's candidate grid (pffdtdFreeStore.showGrid) with the grid points whose
 * IRs are playing highlighted.
 */
export function useSpecklePffdtdFreeGrid({ isViewerReady }: { isViewerReady: boolean }) {
  const active = useAcousticsSimulationStore((s) => {
    const cfg = s.activeSimulationIndex === null ? undefined : s.simulationConfigs[s.activeSimulationIndex];
    return cfg?.type === 'pffdtd' ? cfg : undefined;
  });
  const simulationId = active?.state === 'completed' ? active.currentSimulationId ?? null : null;
  const show = usePffdtdFreeStore((s) => (active ? !!s.showGrid[active.id] : false));
  const grid = usePffdtdFreeStore((s) => (simulationId ? s.grids[simulationId] : undefined));
  const objects = usePffdtdFreeStore((s) => (simulationId ? s.objects[simulationId] : undefined));
  const activePoints = useMemo(
    () =>
      Object.values(objects ?? {})
        .map((o) => o.snappedPosition)
        .filter((p): p is [number, number, number] => !!p),
    [objects],
  );

  const overlayRef = useRef<PffdtdFreeGridOverlay | null>(null);

  useEffect(() => {
    const { viewer } = useSpeckleEngineStore.getState();
    if (!isViewerReady || !viewer) return;
    const overlay = new PffdtdFreeGridOverlay(viewer.getRenderer().scene);
    overlayRef.current = overlay;
    return () => {
      overlay.dispose();
      overlayRef.current = null;
      useSpeckleEngineStore.getState().viewer?.requestRender();
    };
  }, [isViewerReady]);

  useEffect(() => {
    const overlay = overlayRef.current;
    const { viewer } = useSpeckleEngineStore.getState();
    if (!overlay || !viewer) return;
    if (show && grid?.status === 'ready' && grid.points) overlay.show(grid.points, activePoints);
    else overlay.clear();
    viewer.requestRender();
  }, [show, grid, activePoints, isViewerReady]);
}
