/**
 * useDirectionalSources
 *
 * How many simulated sources currently carry a directivity, and how many
 * listeners a wave-based (PFFDTD) run would have to start from: directional
 * sources make PFFDTD run reciprocally — one GPU run per listener, four for FOA.
 *
 * Returns `{ directionalCount, listenerCount, runs(simulationMode) }`.
 */

import { useCallback, useMemo } from 'react';
import { useSoundscapeStore } from '@/store/soundscapeStore';
import { useReceiversStore } from '@/store/receiversStore';
import { useGridListenersStore } from '@/store/gridListenersStore';
import { useAudioControlsStore } from '@/store/audioControlsStore';
import { collapseVariantsToOne, groupSoundsByPosition } from '@/utils/positionKey';
import { PYROOMACOUSTICS_SIMULATION_MODE_FOA } from '@/utils/constants';

export function useDirectionalSources() {
  const soundscapeData = useSoundscapeStore((s) => s.soundscapeData);
  const selectedVariants = useAudioControlsStore((s) => s.selectedVariants);
  const receivers = useReceiversStore((s) => s.receivers);
  const gridListeners = useGridListenersStore((s) => s.gridListeners);

  const directionalCount = useMemo(() => {
    if (!soundscapeData?.length) return 0;
    const { sourceDirectivities } = groupSoundsByPosition(collapseVariantsToOne(soundscapeData, selectedVariants));
    return [...sourceDirectivities.values()].filter(Boolean).length;
  }, [soundscapeData, selectedVariants]);

  const listenerCount = useMemo(
    () =>
      receivers.filter((r) => !r.hiddenForSimulation).length +
      gridListeners.filter((g) => !g.hiddenForSimulation).reduce((n, g) => n + g.points.length, 0),
    [receivers, gridListeners],
  );

  const runs = useCallback(
    (simulationMode: string) => listenerCount * (simulationMode === PYROOMACOUSTICS_SIMULATION_MODE_FOA ? 4 : 1),
    [listenerCount],
  );

  return { directionalCount, listenerCount, runs };
}
