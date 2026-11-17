'use client';

import { useEffect, useState } from 'react';
import { simulationResultsJsonUrl } from '@/services/api';
import type { RunPairResult } from '@/lib/acoustics/band-metrics';

/**
 * The per-pair results of a simulation run (`acoustic_parameters` + `acoustic_parameters_bands` per
 * source-listener pair), fetched once: a card's single numbers, band rows, grid gradient map and IR
 * preview fallbacks all read this one fetch.
 *
 * Returns `undefined` until fetched, `null` when the run has no readable results JSON (an
 * import-IRs card, an expired run), else the results. A new run id fetches again.
 */
export function useRunResults(
  simulationId: string | null | undefined,
  simType: 'pyroomacoustics' | 'pffdtd' | undefined,
): RunPairResult[] | null | undefined {
  const [results, setResults] = useState<RunPairResult[] | null | undefined>(undefined);

  useEffect(() => {
    if (!simulationId || !simType) { setResults(null); return; }
    setResults(undefined);
    let cancelled = false;
    fetch(simulationResultsJsonUrl(simulationId, simType))
      .then((response) => (response.ok ? response.json() : null))
      .then((json: { results?: RunPairResult[] } | null) => { if (!cancelled) setResults(json?.results ?? null); })
      .catch(() => { if (!cancelled) setResults(null); });
    return () => { cancelled = true; };
  }, [simulationId, simType]);

  return results;
}
