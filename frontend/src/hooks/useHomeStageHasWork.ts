'use client';

import {
  useSoundscapeStore,
  useReceiversStore,
  useGridListenersStore,
  useAcousticsSimulationStore,
  useAnalysisStore,
} from '@/store';

/**
 * True when the domain stores hold any user work (sounds, listeners,
 * simulations, analyses). The Home stage starts empty on every load, so any
 * content there is an edit. Non-reactive — reads live store state.
 */
export function homeStageHasWork(): boolean {
  const sc = useSoundscapeStore.getState();
  return (
    sc.soundConfigs.length > 0 ||
    (sc.generatedSounds?.length ?? 0) > 0 ||
    useReceiversStore.getState().receivers.length > 0 ||
    useGridListenersStore.getState().gridListeners.length > 0 ||
    useAcousticsSimulationStore.getState().simulationConfigs.length > 0 ||
    useAnalysisStore.getState().analysisConfigs.length > 0
  );
}

/**
 * Reactive version of {@link homeStageHasWork} for rendering (e.g. the
 * "progress not saved" hint on the bare Home page).
 *
 * Usage:
 * ```tsx
 * const hasWork = useHomeStageHasWork();
 * ```
 */
export function useHomeStageHasWork(): boolean {
  const hasSounds = useSoundscapeStore(
    (s) => s.soundConfigs.length > 0 || (s.generatedSounds?.length ?? 0) > 0,
  );
  const hasReceivers = useReceiversStore((s) => s.receivers.length > 0);
  const hasGridListeners = useGridListenersStore((s) => s.gridListeners.length > 0);
  const hasSimulations = useAcousticsSimulationStore((s) => s.simulationConfigs.length > 0);
  const hasAnalyses = useAnalysisStore((s) => s.analysisConfigs.length > 0);
  return hasSounds || hasReceivers || hasGridListeners || hasSimulations || hasAnalyses;
}
