import { useEffect, useRef } from 'react';
import {
  linkKey,
  linkedListenerIds,
  useAcousticsSimulationStore,
  useAnalysisStore,
  useShareConfigStore,
  useShareViewStore,
  useUIStore,
} from '@/store';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import type { ShareItemKind, ShareLink } from '@/types/share';
import { selectSceneByIndex } from '@/utils/sceneSelection';
import { useActiveSceneId } from '@/hooks/useActiveSceneId';
import { showOnlyListenersForSimulation } from '@/utils/listenerSimulationVisibility';

type ActiveItems = Record<ShareItemKind, string | null>;

const KINDS: ShareItemKind[] = ['scene', 'simulation', 'listener'];
const NO_LINKS: ShareLink[] = [];

interface UseShareLinkActivationArgs {
  /** Powered listener: a single-listener id or a grid listener id. */
  activeListenerId: string | null;
  /** Power a listener (single listener → first-person view, grid → its points). */
  activateListener: (listenerId: string) => void;
}

/**
 * Activating one item of a link group (selecting a scene, powering a
 * simulation, double-clicking a headphone) activates the group's other items.
 * Runs in the share view (served links), and in the editor when Settings →
 * Share › "Also apply links while editing" is on (the designer's links). Nothing
 * is activated on load — the app opens idle.
 *
 * In the editor, activating a link group with listeners also makes them the
 * only ones shown for simulation (the others get "Hide for simulation"). A
 * simulation's listeners can sit in other links ({scene, sim, L1} + {sim, L2}),
 * see `linkedListenerIds`.
 *
 * Powering a listener from an idle state activates its scene and simulation;
 * switching listeners while a scene is on keeps the active scene and simulation
 * (only the kinds that are off are filled in).
 *
 * Changes made by the hook itself are recorded as the new baseline, so they
 * never re-trigger it.
 *
 * Usage (page.tsx):
 * ```tsx
 * useShareLinkActivation({ activeListenerId, activateListener });
 * ```
 */
export function useShareLinkActivation({
  activeListenerId,
  activateListener,
}: UseShareLinkActivationArgs): void {
  const isShareView = useShareViewStore((s) => s.isShareView);
  const viewLinks = useShareViewStore((s) => s.links);
  const editorLinks = useShareConfigStore((s) => s.links);
  const linksInEditor = useShareConfigStore((s) => s.linksInEditor);
  const links = isShareView ? viewLinks : linksInEditor ? editorLinks : NO_LINKS;
  const isExpertMode = useUIStore((s) => s.uiMode === 'expert');
  const analysisConfigs = useAnalysisStore((s) => s.analysisConfigs);
  const activeSceneId = useActiveSceneId();
  const simulationConfigs = useAcousticsSimulationStore((s) => s.simulationConfigs);
  const activeSimulationIndex = useAcousticsSimulationStore((s) => s.activeSimulationIndex);
  // The model is loaded (and listener meshes exist) once the coordinator is set.
  const isViewerReady = useSpeckleEngineStore((s) => s.coordinator !== null);

  const activeSimulationId =
    activeSimulationIndex !== null ? simulationConfigs[activeSimulationIndex]?.id ?? null : null;

  const baselineRef = useRef<ActiveItems>({ scene: null, simulation: null, listener: null });
  const activateListenerRef = useRef(activateListener);
  activateListenerRef.current = activateListener;

  useEffect(() => {
    const current: ActiveItems = { scene: activeSceneId, simulation: activeSimulationId, listener: activeListenerId };
    // Until the model is loaded nothing propagates (a listener powered before its
    // mesh exists is marked active without entering FPS).
    if (links.length === 0 || !isViewerReady) {
      baselineRef.current = current;
      return;
    }

    /**
     * Activate every item of `link` that is not active yet; returns the resulting state.
     * `keepActive`: only fill in kinds that are off — an active scene / simulation stays
     * (switching listeners within a scene never switches its scene or simulation).
     */
    const applyLink = (link: ShareLink, keepActive: boolean): ActiveItems => {
      const next = { ...current };
      if (link.sceneId && link.sceneId !== current.scene && !(keepActive && current.scene)) {
        const index = analysisConfigs.findIndex((c) => c.scene_id === link.sceneId);
        if (index >= 0) {
          const contextIndex = analysisConfigs[index].parentContextOriginalIndex ?? null;
          selectSceneByIndex(index, contextIndex);
          useUIStore.getState().setIsInSoundsStep(true);
          // The expert Sidebar owns its wizard step: move it to the scene's sounds.
          if (isExpertMode) useUIStore.getState().navigateSidebar({ step: 2, contextIndex, usageIndex: index });
          next.scene = link.sceneId;
        }
      }
      if (link.simulationId && link.simulationId !== current.simulation && !(keepActive && current.simulation)) {
        const index = simulationConfigs.findIndex((c) => c.id === link.simulationId);
        if (index >= 0) {
          useAcousticsSimulationStore.getState().handleSetActiveSimulation(index);
          next.simulation = link.simulationId;
        }
      }
      const groupListeners = linkedListenerIds(links, link.sceneId, link.simulationId);
      if (groupListeners.size === 0) return next;
      // Editor: the group's listeners are the ones simulated; the share view never edits.
      if (!isShareView) showOnlyListenersForSimulation(groupListeners);
      // One listener is powered at a time: keep the current one when it is in the group.
      if (current.listener && groupListeners.has(current.listener)) return next;
      const listenerId = link.listenerId ?? groupListeners.values().next().value;
      if (listenerId) {
        activateListenerRef.current(listenerId);
        next.listener = listenerId;
      }
      return next;
    };

    const baseline = baselineRef.current;
    baselineRef.current = current;
    // Only an activation propagates; turning something off never does.
    const changed = KINDS.find((kind) => current[kind] && current[kind] !== baseline[kind]);
    if (!changed) return;
    // An item can be in several links: keep one the active items already match, else
    // one that does not contradict them (fills only what is off), else the first.
    const candidates = links.filter((l) => l[linkKey(changed)] === current[changed]);
    const matches = (l: ShareLink, kind: ShareItemKind) => !l[linkKey(kind)] || l[linkKey(kind)] === current[kind];
    const satisfied = candidates.find((l) => KINDS.every((kind) => matches(l, kind)));
    const compatible = candidates.find((l) => KINDS.every((kind) => !current[kind] || matches(l, kind)));
    const link = satisfied ?? compatible ?? candidates[0];
    // A listener switched while a scene is on keeps that scene and its simulation.
    if (link) baselineRef.current = applyLink(link, changed === 'listener' && current.scene !== null);
  }, [links, isShareView, isExpertMode, activeSceneId, activeSimulationId, activeListenerId, analysisConfigs, simulationConfigs, isViewerReady]);
}
