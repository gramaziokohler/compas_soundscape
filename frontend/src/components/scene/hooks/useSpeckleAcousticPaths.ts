import { useEffect, useRef } from 'react';
import { useAcousticPathsStore, useAcousticsSimulationStore } from '@/store';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import { AcousticPathsOverlay } from '@/lib/three/acoustic-paths-overlay';
import { toggleExcludedEdge } from '@/lib/acoustics/geometric-engine';
import { ACOUSTIC_PATHS } from '@/utils/constants';
import { isShareViewActive } from '@/store/shareViewStore';
import type { SimulationConfig } from '@/types/acoustics';

const EMPTY_EDGES: number[][] = [];
/** How often (ms) the billiard clock is written to the store for the panel's slider. */
const TIME_REPORT_MS = 100;

function excludedEdgesOf(config: SimulationConfig | undefined): number[][] {
  if (!config || (config.type !== 'pyroomacoustics' && config.type !== 'hybrid')) return EMPTY_EDGES;
  return config.settings.excluded_edges ?? EMPTY_EDGES;
}

/**
 * Scene bridge of the sound-path view (acousticPathsStore).
 *
 * Draws the traced paths of the previewed geometric card, runs the billiard clock, and — while
 * "edit edges" is on — lets a click on a diffraction edge switch it off / on. A click is a press
 * and release of the primary button without a drag, so orbiting the camera never toggles an edge;
 * it works the same on Windows and macOS (pointer events, no modifier, no context menu).
 */
export function useSpeckleAcousticPaths({ isViewerReady }: { isViewerReady: boolean }) {
  const previewConfigId = useAcousticPathsStore((s) => s.previewConfigId);
  const payload = useAcousticPathsStore((s) =>
    s.previewConfigId ? s.entries[s.previewConfigId]?.payload ?? null : null,
  );
  const view = useAcousticPathsStore((s) => s.view);
  const hoveredEdgeId = useAcousticPathsStore((s) => s.hoveredEdgeId);
  const playing = useAcousticPathsStore((s) => s.playing);
  const speed = useAcousticPathsStore((s) => s.speed);
  const seekSeq = useAcousticPathsStore((s) => s.seekSeq);
  const edgeEditing = useAcousticPathsStore((s) => s.edgeEditing);
  const excludedEdges = useAcousticsSimulationStore((s) =>
    excludedEdgesOf(s.simulationConfigs.find((c) => c.id === previewConfigId)),
  );

  const overlayRef = useRef<AcousticPathsOverlay | null>(null);
  const clockRef = useRef(0);

  // Effect A — own the overlay for the lifetime of the viewer.
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

  // Effect B — (re)draw for the current payload and view.
  useEffect(() => {
    const overlay = overlayRef.current;
    const { viewer } = useSpeckleEngineStore.getState();
    if (!overlay || !viewer) return;
    overlay.setPayload(previewConfigId ? payload : null);
    overlay.render({ view, excludedEdges, hoveredEdgeId });
    overlay.setTime(clockRef.current);
    useAcousticPathsStore.getState().reportTime(clockRef.current, overlay.durationMs);
    viewer.requestRender();
  }, [isViewerReady, previewConfigId, payload, view, excludedEdges, hoveredEdgeId]);

  // Effect C — a scrub from the panel jumps the clock.
  useEffect(() => {
    const overlay = overlayRef.current;
    clockRef.current = useAcousticPathsStore.getState().timeMs;
    if (!overlay) return;
    overlay.setTime(clockRef.current);
    useSpeckleEngineStore.getState().viewer?.requestRender();
  }, [seekSeq]);

  // Effect D — the billiard clock: sound time advances at `speed` x real time.
  useEffect(() => {
    if (!playing || !payload) return;
    let frame = 0;
    let last = performance.now();
    let reported = last;
    const tick = (now: number) => {
      const overlay = overlayRef.current;
      const store = useAcousticPathsStore.getState();
      if (!overlay) return;
      const duration = overlay.durationMs;
      clockRef.current += (now - last) * speed;
      last = now;
      const ended = duration <= 0 || clockRef.current >= duration;
      if (ended) clockRef.current = Math.max(duration, 0);
      overlay.setTime(clockRef.current);
      useSpeckleEngineStore.getState().viewer?.requestRender();
      if (ended || now - reported >= TIME_REPORT_MS) {
        reported = now;
        store.reportTime(clockRef.current, duration);
      }
      if (ended) {
        store.setPlaying(false);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, speed, payload]);

  // Effect E — click an edge in the 3D view to switch it off / on.
  useEffect(() => {
    const { viewer } = useSpeckleEngineStore.getState();
    if (!isViewerReady || !viewer || !edgeEditing || !previewConfigId || !payload || isShareViewActive()) return;
    const canvas = viewer.getRenderer().renderer.domElement;
    let down: { x: number; y: number } | null = null;

    const pick = (event: PointerEvent): number | null => {
      const overlay = overlayRef.current;
      const camera = viewer.getRenderer().renderingCamera;
      if (!overlay || !camera) return null;
      const rect = canvas.getBoundingClientRect();
      return overlay.pickEdge(event.clientX - rect.left, event.clientY - rect.top, camera, rect.width, rect.height);
    };
    const onDown = (event: PointerEvent) => {
      down = event.button === 0 ? { x: event.clientX, y: event.clientY } : null;
    };
    const onMove = (event: PointerEvent) => {
      if (event.buttons !== 0) return; // dragging the camera
      const id = pick(event);
      useAcousticPathsStore.getState().hoverEdge(id);
      canvas.style.cursor = id === null ? '' : 'pointer';
    };
    const onUp = (event: PointerEvent) => {
      const start = down;
      down = null;
      if (!start || event.button !== 0) return;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > ACOUSTIC_PATHS.CLICK_SLOP_PX) return;
      const id = pick(event);
      const edge = id === null ? undefined : overlayRef.current?.edge(id);
      if (!edge) return;
      const sim = useAcousticsSimulationStore.getState();
      const index = sim.simulationConfigs.findIndex((c) => c.id === previewConfigId);
      const config = sim.simulationConfigs[index];
      if (!config || (config.type !== 'pyroomacoustics' && config.type !== 'hybrid')) return;
      sim.handleUpdateConfig(index, {
        settings: { ...config.settings, excluded_edges: toggleExcludedEdge(config.settings.excluded_edges, edge.segment) },
      } as Partial<SimulationConfig>);
    };
    const onLeave = () => {
      useAcousticPathsStore.getState().hoverEdge(null);
      canvas.style.cursor = '';
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointerleave', onLeave);
    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointerleave', onLeave);
      onLeave();
    };
  }, [isViewerReady, edgeEditing, previewConfigId, payload]);
}
