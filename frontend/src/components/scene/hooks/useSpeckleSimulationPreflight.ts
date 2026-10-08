import { useEffect, useRef } from 'react';
import { useSimulationPreflightStore } from '@/store';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import { SimulationMeshPreview, setSpeckleModelVisible } from '@/lib/three/simulation-mesh-preview';
import { SIMULATION_PREFLIGHT } from '@/utils/constants';

/**
 * Scene bridge of the pre-simulation geometry check.
 *
 * While a simulation card shows its preflight preview, hides the Speckle
 * model (whatever its view mode, e.g. Acoustics) and draws the prepared
 * simulation mesh — exactly what will be simulated — in its place, and frames
 * the camera on the focused issue. Rebuilds on view-mode / filter /
 * highlight changes; hover only re-colours (same rebuild, no camera move).
 */
export function useSpeckleSimulationPreflight({ isViewerReady }: { isViewerReady: boolean }) {
  const previewConfigId = useSimulationPreflightStore((s) => s.previewConfigId);
  const payload = useSimulationPreflightStore((s) =>
    s.previewConfigId ? s.entries[s.previewConfigId]?.payload ?? null : null,
  );
  const viewMode = useSimulationPreflightStore((s) => s.viewMode);
  const filters = useSimulationPreflightStore((s) => s.filters);
  const ghost = useSimulationPreflightStore((s) => s.ghost);
  const focusedIssueId = useSimulationPreflightStore((s) => s.focusedIssueId);
  const hoveredIssueId = useSimulationPreflightStore((s) => s.hoveredIssueId);
  const focusSeq = useSimulationPreflightStore((s) => s.focusSeq);

  const managerRef = useRef<SimulationMeshPreview | null>(null);

  // Effect A — own the manager for the lifetime of the viewer.
  useEffect(() => {
    const { viewer } = useSpeckleEngineStore.getState();
    if (!isViewerReady || !viewer) return;
    const manager = new SimulationMeshPreview(viewer.getRenderer().scene);
    managerRef.current = manager;
    return () => {
      manager.dispose();
      managerRef.current = null;
      useSpeckleEngineStore.getState().viewer?.requestRender();
    };
  }, [isViewerReady]);

  // Effect A2 — show only the simulation mesh while the preview is on.
  const previewActive = !!previewConfigId && !!payload;
  useEffect(() => {
    const { viewer } = useSpeckleEngineStore.getState();
    if (!isViewerReady || !viewer || !previewActive) return;
    setSpeckleModelVisible(viewer, false);
    return () => {
      const current = useSpeckleEngineStore.getState().viewer;
      if (current) setSpeckleModelVisible(current, true);
    };
  }, [isViewerReady, previewActive]);

  // Effect B — (re)draw for the current payload and options.
  useEffect(() => {
    const manager = managerRef.current;
    const { viewer } = useSpeckleEngineStore.getState();
    if (!manager || !viewer) return;
    manager.setPayload(previewConfigId ? payload : null);
    const highlightId = hoveredIssueId ?? focusedIssueId;
    const highlight = payload?.issues.find((i) => i.id === highlightId) ?? null;
    manager.render({ viewMode, filters, ghost, highlight });
    viewer.requestRender();
  }, [isViewerReady, previewConfigId, payload, viewMode, filters, ghost, focusedIssueId, hoveredIssueId]);

  // Effect C — frame the focused issue (re-runs on every focus click).
  useEffect(() => {
    if (!focusedIssueId || !payload) return;
    const issue = payload.issues.find((i) => i.id === focusedIssueId);
    const box = issue ? managerRef.current?.issueBounds(issue) : null;
    const { cameraController } = useSpeckleEngineStore.getState();
    if (box && cameraController) {
      cameraController.setCameraView(box, true, SIMULATION_PREFLIGHT.FOCUS_FIT);
    }
    // focusSeq is the trigger; the other values are read for the target.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSeq]);
}
