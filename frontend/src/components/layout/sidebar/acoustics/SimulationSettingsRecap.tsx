'use client';

import { useMemo } from 'react';
import { runResultsEngine, useRunSolveTime } from '@/hooks/useRunResults';
import { SettingsSummary } from '@/components/ui/SettingsSummary';
import { formatElapsed } from '@/utils/formatElapsed';
import { getSimulationSettingsRows } from '@/utils/simulationSettingsRows';
import type { EngineSimulationConfig } from '@/types/acoustics';

interface SimulationSettingsRecapProps {
  config: EngineSimulationConfig;
}

/**
 * SimulationSettingsRecap
 *
 * Share view: collapsible "Simulation settings ⌄" line of a generated simulation
 * card (where the editor shows "Solved in …"). Expanded, it lists the solve time
 * and the settings the run used, formatted like a scene's "Scene settings".
 *
 * Usage:
 * ```tsx
 * <Card beforeSettingsSummary={<SimulationSettingsRecap config={config} />} ... />
 * ```
 */
export function SimulationSettingsRecap({ config }: SimulationSettingsRecapProps) {
  const simulationId = 'currentSimulationId' in config ? config.currentSimulationId : undefined;
  const seconds = useRunSolveTime(simulationId, runResultsEngine(config.type));
  const rows = useMemo(
    () => getSimulationSettingsRows(config, seconds !== null ? formatElapsed(seconds) : null),
    [config, seconds],
  );
  return <SettingsSummary title="Simulation settings" rows={rows} chevron="trailing" />;
}
