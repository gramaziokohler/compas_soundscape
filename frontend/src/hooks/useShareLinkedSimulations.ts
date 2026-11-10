'use client';

import { useEffect } from 'react';
import { useAcousticsSimulationStore } from '@/store';
import { useActiveSceneId } from '@/hooks/useActiveSceneId';
import { useShareLinkedIds } from '@/hooks/useShareLinkedIds';

/**
 * Share view: the acoustic simulations a visitor can pick for the powered
 * sound scene (see useShareLinkedIds; null = show all).
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
  const activeSceneId = useActiveSceneId();
  const linkedIds = useShareLinkedIds('simulation');

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
