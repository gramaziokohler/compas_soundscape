'use client';

import { runResultsEngine, useRunSolveTime } from '@/hooks/useRunResults';
import { formatElapsed } from '@/utils/formatElapsed';
import type { SimulationConfig } from '@/types/acoustics';

interface SimulationSolveTimeProps {
  config: SimulationConfig;
}

/**
 * SimulationSolveTime
 *
 * "Solved in 2min 14s" footer line of a generated simulation card, read from the run's results
 * JSON (`solve_time_s`, written by every engine: geometry fetch to results). Renders nothing for
 * cards without a backend run or runs that predate the field.
 *
 * Usage:
 * ```tsx
 * <Card footerNote={<SimulationSolveTime config={config} />} ... />
 * ```
 */
export function SimulationSolveTime({ config }: SimulationSolveTimeProps) {
  const simulationId = 'currentSimulationId' in config ? config.currentSimulationId : undefined;
  const seconds = useRunSolveTime(simulationId, runResultsEngine(config.type));
  if (seconds === null) return null;
  return <span className="tabular-nums">Solved in {formatElapsed(seconds)}</span>;
}
