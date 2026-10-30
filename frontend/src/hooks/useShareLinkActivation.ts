import { useEffect, useRef } from 'react';
import {
  linkKey,
  useAcousticsSimulationStore,
  useAnalysisStore,
  useShareViewStore,
  useUIStore,
} from '@/store';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import type { ShareItemKind, ShareLink } from '@/types/share';
import { selectSceneByIndex } from '@/utils/sceneSelection';

type ActiveItems = Record<ShareItemKind, string | null>;

const KINDS: ShareItemKind[] = ['scene', 'simulation', 'listener'];

interface UseShareLinkActivationArgs {
  /** Only the public share view links activation. */
  enabled: boolean;
  /** Powered listener: a single-listener id or a grid listener id. */
  activeListenerId: string | null;
  /** Power a listener (single listener → first-person view, grid → its points). */
  activateListener: (listenerId: string) => void;
}

/**
 * Share view: activating one item of a link group (selecting a scene bubble,
 * powering a simulation, double-clicking a headphone) activates the group's
 * other items. Nothing is activated on load — the player opens idle.
 *
 * Changes made by the hook itself are recorded as the new baseline, so they
 * never re-trigger it.
 *
 * Usage (page.tsx):
 * ```tsx
 * useShareLinkActivation({ enabled: isShareView, activeListenerId, activateListener });
 * ```
 */
export function useShareLinkActivation({
  enabled,
  activeListenerId,
  activateListener,
}: UseShareLinkActivationArgs): void {
  const links = useShareViewStore((s) => s.links);
  const analysisConfigs = useAnalysisStore((s) => s.analysisConfigs);
  const activeSoundParentIndex = useUIStore((s) => s.activeSoundParentIndex);
  const isInSoundsStep = useUIStore((s) => s.isInSoundsStep);
  const simulationConfigs = useAcousticsSimulationStore((s) => s.simulationConfigs);
  const activeSimulationIndex = useAcousticsSimulationStore((s) => s.activeSimulationIndex);
  // The model is loaded (and listener meshes exist) once the coordinator is set.
  const isViewerReady = useSpeckleEngineStore((s) => s.coordinator !== null);

  const activeSceneId =
    isInSoundsStep && activeSoundParentIndex !== null
      ? analysisConfigs[activeSoundParentIndex]?.scene_id ?? null
      : null;
  const activeSimulationId =
    activeSimulationIndex !== null ? simulationConfigs[activeSimulationIndex]?.id ?? null : null;

  const baselineRef = useRef<ActiveItems>({ scene: null, simulation: null, listener: null });
  const activateListenerRef = useRef(activateListener);
  activateListenerRef.current = activateListener;

  useEffect(() => {
    const current: ActiveItems = { scene: activeSceneId, simulation: activeSimulationId, listener: activeListenerId };
    // Until the model is loaded nothing propagates (a listener powered before its
    // mesh exists is marked active without entering FPS).
    if (!enabled || links.length === 0 || !isViewerReady) {
      baselineRef.current = current;
      return;
    }

    /** Activate every item of `link` that is not active yet; returns the resulting state. */
    const applyLink = (link: ShareLink): ActiveItems => {
      const next = { ...current };
      if (link.sceneId && link.sceneId !== current.scene) {
        const index = analysisConfigs.findIndex((c) => c.scene_id === link.sceneId);
        if (index >= 0) {
          selectSceneByIndex(index, analysisConfigs[index].parentContextOriginalIndex ?? null);
          useUIStore.getState().setIsInSoundsStep(true);
          next.scene = link.sceneId;
        }
      }
      if (link.simulationId && link.simulationId !== current.simulation) {
        const index = simulationConfigs.findIndex((c) => c.id === link.simulationId);
        if (index >= 0) {
          useAcousticsSimulationStore.getState().handleSetActiveSimulation(index);
          next.simulation = link.simulationId;
        }
      }
      if (link.listenerId && link.listenerId !== current.listener) {
        activateListenerRef.current(link.listenerId);
        next.listener = link.listenerId;
      }
      return next;
    };

    const baseline = baselineRef.current;
    baselineRef.current = current;
    // Only an activation propagates; turning something off never does.
    const changed = KINDS.find((kind) => current[kind] && current[kind] !== baseline[kind]);
    if (!changed) return;
    // An item can be in several links: keep one the active items already match, else the first.
    const candidates = links.filter((l) => l[linkKey(changed)] === current[changed]);
    const satisfied = candidates.find((l) => KINDS.every((kind) => !l[linkKey(kind)] || l[linkKey(kind)] === current[kind]));
    const link = satisfied ?? candidates[0];
    if (link) baselineRef.current = applyLink(link);
  }, [enabled, links, activeSceneId, activeSimulationId, activeListenerId, analysisConfigs, simulationConfigs, isViewerReady]);
}
