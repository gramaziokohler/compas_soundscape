import { useEffect, useRef } from 'react';
import {
  linkKey,
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

    /** Activate every item of `link` that is not active yet; returns the resulting state. */
    const applyLink = (link: ShareLink): ActiveItems => {
      const next = { ...current };
      if (link.sceneId && link.sceneId !== current.scene) {
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
  }, [links, isExpertMode, activeSceneId, activeSimulationId, activeListenerId, analysisConfigs, simulationConfigs, isViewerReady]);
}
