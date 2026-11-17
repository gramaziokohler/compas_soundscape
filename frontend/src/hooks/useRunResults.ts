'use client';

import { useEffect, useState } from 'react';
import { simulationResultsJsonUrl } from '@/services/api';
import type { RunPairResult } from '@/lib/acoustics/band-metrics';
import type { AcousticSimulationMode } from '@/types/acoustics';

/** Engine whose result routes serve a run's files (hybrid runs are served like PFFDTD ones). */
export type RunResultsEngine = 'pyroomacoustics' | 'pffdtd';

/** The parts of a run's results JSON the frontend reads. */
interface RunResultsJson {
  results?: RunPairResult[];
  /** Wall-clock time of the run (geometry fetch to results), seconds; absent on older runs. */
  solve_time_s?: number;
}

/** The results route of a card type, or undefined for cards without a backend run. */
export function runResultsEngine(type: AcousticSimulationMode): RunResultsEngine | undefined {
  if (type === 'pyroomacoustics') return 'pyroomacoustics';
  if (type === 'pffdtd' || type === 'hybrid') return 'pffdtd';
  return undefined;
}

// One fetch per results file, shared by every reader (metrics table, footer solve time). A new
// run has a new simulation id, so a cached entry never goes stale; a failed fetch is dropped so
// the next reader retries.
const resultsJsonCache = new Map<string, Promise<RunResultsJson | null>>();

function fetchRunResultsJson(url: string): Promise<RunResultsJson | null> {
  const cached = resultsJsonCache.get(url);
  if (cached) return cached;
  const request = fetch(url)
    .then((response) => (response.ok ? (response.json() as Promise<RunResultsJson>) : null))
    .catch(() => null)
    .then((json) => {
      if (!json) resultsJsonCache.delete(url);
      return json;
    });
  resultsJsonCache.set(url, request);
  return request;
}

/** A run's results JSON: `undefined` until fetched, `null` when there is none readable. */
function useRunResultsJson(
  simulationId: string | null | undefined,
  engine: RunResultsEngine | undefined,
): RunResultsJson | null | undefined {
  const [json, setJson] = useState<RunResultsJson | null | undefined>(undefined);

  useEffect(() => {
    if (!simulationId || !engine) { setJson(null); return; }
    setJson(undefined);
    let cancelled = false;
    void fetchRunResultsJson(simulationResultsJsonUrl(simulationId, engine)).then((result) => {
      if (!cancelled) setJson(result);
    });
    return () => { cancelled = true; };
  }, [simulationId, engine]);

  return json;
}

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
  engine: RunResultsEngine | undefined,
): RunPairResult[] | null | undefined {
  const json = useRunResultsJson(simulationId, engine);
  return json === undefined ? undefined : json?.results ?? null;
}

/** How long the run took to solve (seconds), or null while loading / for runs that did not record it. */
export function useRunSolveTime(
  simulationId: string | null | undefined,
  engine: RunResultsEngine | undefined,
): number | null {
  const time = useRunResultsJson(simulationId, engine)?.solve_time_s;
  return typeof time === 'number' && Number.isFinite(time) && time >= 0 ? time : null;
}
