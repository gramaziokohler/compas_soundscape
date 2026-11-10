'use client';

import { useEffect, useMemo } from 'react';
import { useAcousticsSimulationStore, useShareViewStore } from '@/store';
import { useActiveSceneId } from '@/hooks/useActiveSceneId';

/**
 * Share view: the acoustic simulations a visitor can pick for the powered
 * sound scene — every simulation sharing a link group with it (a scene can sit
 * in several groups, so several simulations).
 *
 * Returns null (show every shared simulation) outside the share view, while no
 * scene is on, or when the scene is linked to no simulation at all.
 *
 * When the powered scene changes, a simulation that is still active but no
 * longer listed is switched off, so nothing plays that the visitor can't see
 * (useShareLinkActivation then powers the newly linked one).
 *
 * Usage (AcousticsBubbles):
 * ```tsx
 * const linkedIds = useShareLinkedSimulations();
 * const shown = configs.filter((c) => !linkedIds || linkedIds.has(c.id));
 * ```
 */
export function useShareLinkedSimulations(): ReadonlySet<string> | null {
  const isShareView = useShareViewStore((s) => s.isShareView);
  const links = useShareViewStore((s) => s.links);
  const activeSceneId = useActiveSceneId();

  const linkedIds = useMemo(() => {
    if (!isShareView || !activeSceneId) return null;
    const ids = new Set<string>();
    for (const link of links) {
      if (link.sceneId === activeSceneId && link.simulationId) ids.add(link.simulationId);
    }
    return ids.size > 0 ? ids : null;
  }, [isShareView, links, activeSceneId]);

  useEffect(() => {
    if (!linkedIds) return;
    const sims = useAcousticsSimulationStore.getState();
    const active = sims.activeSimulationIndex !== null ? sims.simulationConfigs[sims.activeSimulationIndex] : undefined;
    if (active && !linkedIds.has(active.id)) sims.handleSetActiveSimulation(null);
    for (const id of sims.activeResonanceIds) {
      if (!linkedIds.has(id)) sims.toggleResonanceActive(id);
    }
    // Only on a scene change: a link group activated from a listener may power any simulation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSceneId]);

  return linkedIds;
}
