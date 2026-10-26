import { useEffect, useRef } from 'react';
import { useAcousticMaterialStore, usePffdtdVisualsStore, useSimulationPreflightStore } from '@/store';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import { PffdtdVoxelOverlay } from '@/lib/three/pffdtd-voxel-overlay';
import { PffdtdFieldPlane } from '@/lib/three/pffdtd-field-plane';
import { setSpeckleModelVisible } from '@/lib/three/simulation-mesh-preview';
import { applyLegendBounds, frameView, splDisplayRange } from '@/lib/acoustics/pffdtd-field';
import {
  animationHeight,
  animationPlaneMatches,
  defaultSlice,
  planeTexelGrid,
  sliceVolume,
} from '@/lib/acoustics/pffdtd-volume';
import { pffdtdMaterialColor } from '@/lib/acoustics/pffdtd-materials';
import { PFFDTD_VISUALS } from '@/utils/constants';

/**
 * Scene bridge of the wave-based (PFFDTD) card visuals.
 *
 * Owns the voxel-preview overlay and the field plane for the lifetime of the
 * viewer, redraws them when `pffdtdVisualsStore.overlay` (or its data / its
 * strength-G slice) changes, runs the animation clock while playing (advancing `frame` at
 * `fps`; each frame only rewrites the plane texture), and frames the camera
 * on a focused voxel problem. While the voxel grid is shown the Speckle model
 * is hidden (like the geometry-preflight preview, which it excludes).
 */
export function useSpecklePffdtdOverlays({ isViewerReady }: { isViewerReady: boolean }) {
  const overlay = usePffdtdVisualsStore((s) => s.overlay);
  const preview = usePffdtdVisualsStore((s) =>
    s.overlay?.kind === 'voxels' ? s.voxelPreviews[s.overlay.configId] ?? null : null,
  );
  const field = usePffdtdVisualsStore((s) =>
    s.overlay?.simulationId ? s.fields[s.overlay.simulationId] ?? null : null,
  );
  const frame = usePffdtdVisualsStore((s) => s.frame);
  const playing = usePffdtdVisualsStore((s) => s.playing);
  const fps = usePffdtdVisualsStore((s) => s.fps);
  const focusedProblemId = usePffdtdVisualsStore((s) => s.focusedProblemId);
  const focusSeq = usePffdtdVisualsStore((s) => s.focusSeq);
  const preflightPreviewId = useSimulationPreflightStore((s) => s.previewConfigId);
  // Material colours of the voxel points follow the material database.
  const availableMaterials = useAcousticMaterialStore((s) => s.availableMaterials);

  const voxelRef = useRef<PffdtdVoxelOverlay | null>(null);
  const planeRef = useRef<PffdtdFieldPlane | null>(null);

  // Effect A — own the managers for the lifetime of the viewer.
  useEffect(() => {
    const { viewer } = useSpeckleEngineStore.getState();
    if (!isViewerReady || !viewer) return;
    const scene = viewer.getRenderer().scene;
    const voxel = new PffdtdVoxelOverlay(scene);
    const plane = new PffdtdFieldPlane(scene);
    voxelRef.current = voxel;
    planeRef.current = plane;
    return () => {
      voxel.dispose();
      plane.dispose();
      voxelRef.current = null;
      planeRef.current = null;
      useSpeckleEngineStore.getState().viewer?.requestRender();
    };
  }, [isViewerReady]);

  // Effect A2 — the preflight preview hides the model: never stack voxels on it.
  useEffect(() => {
    if (!preflightPreviewId) return;
    const s = usePffdtdVisualsStore.getState();
    if (s.overlay?.kind === 'voxels') s.setOverlay(null);
  }, [preflightPreviewId]);

  // Effect B — voxel grid + problem markers.
  useEffect(() => {
    const manager = voxelRef.current;
    const { viewer } = useSpeckleEngineStore.getState();
    if (!manager || !viewer) return;
    if (overlay?.kind === 'voxels' && preview?.status === 'done' && preview.payload) {
      manager.show({
        payload: preview.payload,
        points: preview.points,
        materialColor: (id) => pffdtdMaterialColor(id, availableMaterials),
        highlightId: focusedProblemId,
      });
    } else {
      manager.clear();
    }
    viewer.requestRender();
  }, [isViewerReady, overlay, preview, focusedProblemId, availableMaterials]);

  // Effect B2 — the voxel grid replaces the model while it is shown (whatever the view mode).
  const voxelsShown = overlay?.kind === 'voxels' && preview?.status === 'done' && !!preview.payload;
  useEffect(() => {
    const { viewer } = useSpeckleEngineStore.getState();
    if (!isViewerReady || !viewer || !voxelsShown) return;
    setSpeckleModelVisible(viewer, false);
    return () => {
      const current = useSpeckleEngineStore.getState().viewer;
      if (current) setSpeckleModelVisible(current, true);
    };
  }, [isViewerReady, voxelsShown]);

  // Effect C — field plane: strength-G slice (or plane map of old results) or the current animation
  // frame. An animation shows its frames only on the plane they were recorded on; at any other
  // requested height it previews the horizontal strength-G slice there.
  useEffect(() => {
    const plane = planeRef.current;
    const { viewer } = useSpeckleEngineStore.getState();
    if (!plane || !viewer) return;
    const block = field?.block;
    const sourceId = overlay?.sourceId;
    let drawn = false;
    if (block && field && sourceId && overlay) {
      if (overlay.kind === 'spl') {
        const spl = field.spl[sourceId];
        const range = spl ? applyLegendBounds(splDisplayRange(block, spl, sourceId), overlay.legend) : null;
        if (spl && range && block.volume) {
          const slice = sliceVolume(block.volume, spl, field.volumeMask, overlay.slice ?? defaultSlice(block, block.volume));
          plane.showSpl(slice.grid, slice.values, range, slice.mask);
          drawn = true;
        } else if (spl && range) {
          plane.showSpl(planeTexelGrid(block), spl, range, field.mask);
          drawn = true;
        }
      } else if (overlay.kind === 'field') {
        const frames = field.frames[sourceId];
        const anim = block.sources.find((s) => s.source_id === sourceId)?.animation;
        const z = animationHeight(block, overlay.slice);
        const spl = field.spl[sourceId];
        const range = spl ? applyLegendBounds(splDisplayRange(block, spl, sourceId), overlay.legend) : null;
        if (frames && anim && anim.frames > 0 && animationPlaneMatches(block, z)) {
          const f = Math.min(frame, anim.frames - 1);
          plane.showFrame(planeTexelGrid(block), frameView(frames, f, block.nx, block.ny), field.mask);
          drawn = true;
        } else if (block.animation_on_demand && block.volume && spl && range) {
          const slice = sliceVolume(block.volume, spl, field.volumeMask, { axis: 'z', position: z });
          plane.showSpl(slice.grid, slice.values, range, slice.mask);
          drawn = true;
        }
      }
    }
    if (!drawn) plane.clear();
    viewer.requestRender();
  }, [isViewerReady, overlay, field, frame]);

  // Effect D — animation clock (advances `frame` at `fps`, loops).
  const animFrames = overlay?.kind === 'field' && overlay.sourceId
    ? field?.block?.sources.find((s) => s.source_id === overlay.sourceId)?.animation?.frames ?? 0
    : 0;
  const framesLoaded = !!(overlay?.sourceId && field?.frames[overlay.sourceId]);
  useEffect(() => {
    if (!playing || animFrames <= 0 || !framesLoaded) return;
    let raf = 0;
    let last = performance.now();
    const interval = 1000 / Math.max(1, fps);
    const tick = (now: number) => {
      if (now - last >= interval) {
        last = now;
        const s = usePffdtdVisualsStore.getState();
        s.setFrame((s.frame + 1) % animFrames);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, fps, animFrames, framesLoaded]);

  // Effect E — frame the focused voxel problem (re-runs on every focus click).
  useEffect(() => {
    if (!focusedProblemId || !preview?.payload) return;
    const problem = preview.payload.problems.find((p) => p.id === focusedProblemId);
    const box = problem ? voxelRef.current?.problemBounds(problem) : null;
    const { cameraController } = useSpeckleEngineStore.getState();
    if (box && cameraController) {
      cameraController.setCameraView(box, true, PFFDTD_VISUALS.FOCUS_FIT);
    }
    // focusSeq is the trigger; the other values are read for the target.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSeq]);
}
