'use client';

import { useEffect, useRef } from 'react';
import {
  runWithoutUndo,
  useAcousticsSimulationStore,
  useAnalysisStore,
  useSpeckleStore,
  useUIStore,
} from '@/store';
import type { SavedObjectVisibility } from '@/types/card';

/**
 * useApplySavedObjectVisibility Hook
 *
 * Restores the Object Explorer hide / isolate / exclude view saved on a scene or
 * simulation card (`savedObjectVisibility`, see `utils/savedObjectVisibility.ts`)
 * when that card is powered on.
 *
 * - Scene power = `activeSoundParentIndex` set while `isInSoundsStep`; simulation
 *   power = `activeSimulationIndex`. Cards are tracked by identity (`scene_id` /
 *   config `id`), never by index, because indices shift when cards are added or removed.
 * - Applies only on a transition to a card that HAS a saved view. Powering off, or
 *   powering on a card without one, leaves the current hide/show state untouched.
 * - Scene and simulation both powered: the one powered most recently wins.
 * - Gated by `ready` (domain restored AND the viewer's world tree loaded): the viewer
 *   resets its visibility intent when it is created, so applying earlier would be
 *   wiped. The first run after `ready` re-applies the already-powered card's view
 *   (hidden state is not otherwise persisted); that restore records no undo step.
 *
 * Mount once, in `page.tsx` (the left Sidebar is unmounted in Simple mode).
 *
 * Usage:
 * ```tsx
 * useApplySavedObjectVisibility(domainRestored && worldTreeVersion > 0);
 * ```
 */
export function useApplySavedObjectVisibility(ready: boolean): void {
  const parentIndex = useUIStore((s) => s.activeSoundParentIndex);
  const inSoundsStep = useUIStore((s) => s.isInSoundsStep);

  const sceneKey = useAnalysisStore((s) => {
    if (!inSoundsStep || parentIndex === null || parentIndex === undefined) return null;
    const config = s.analysisConfigs[parentIndex];
    return config ? (config.scene_id ?? `index-${parentIndex}`) : null;
  });
  const simKey = useAcousticsSimulationStore((s) => {
    const index = s.activeSimulationIndex;
    if (index === null || index === undefined) return null;
    const config = s.simulationConfigs[index];
    return config ? (config.id ?? `index-${index}`) : null;
  });

  // Plain refs (not state): they only record what the last effect run saw.
  const initializedRef = useRef(false);
  const prevSceneKeyRef = useRef<string | null>(null);
  const prevSimKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!ready) return;

    const isFirstRun = !initializedRef.current;
    const sceneChanged = sceneKey !== prevSceneKeyRef.current;
    const simChanged = simKey !== prevSimKeyRef.current;
    initializedRef.current = true;
    prevSceneKeyRef.current = sceneKey;
    prevSimKeyRef.current = simKey;

    const sceneSaved = (): SavedObjectVisibility | undefined => {
      const { analysisConfigs } = useAnalysisStore.getState();
      const parent = useUIStore.getState().activeSoundParentIndex;
      return parent === null || parent === undefined ? undefined : analysisConfigs[parent]?.savedObjectVisibility;
    };
    const simSaved = (): SavedObjectVisibility | undefined => {
      const { simulationConfigs, activeSimulationIndex } = useAcousticsSimulationStore.getState();
      return activeSimulationIndex === null || activeSimulationIndex === undefined
        ? undefined
        : simulationConfigs[activeSimulationIndex]?.savedObjectVisibility;
    };

    let snapshot: SavedObjectVisibility | undefined;
    if (isFirstRun) {
      // Refresh / load: whichever powered card has a saved view (simulation over scene).
      snapshot = (simKey ? simSaved() : undefined) ?? (sceneKey ? sceneSaved() : undefined);
    } else if (simChanged && simKey) {
      snapshot = simSaved();
    } else if (sceneChanged && sceneKey) {
      snapshot = sceneSaved();
    }
    if (!snapshot) return;

    const apply = () => useSpeckleStore.getState().applyVisibilitySnapshot(snapshot);
    // A restore on load is not a user step (Ctrl+Z must never "undo the load").
    if (isFirstRun) runWithoutUndo(apply);
    else apply();
  }, [ready, sceneKey, simKey]);
}
