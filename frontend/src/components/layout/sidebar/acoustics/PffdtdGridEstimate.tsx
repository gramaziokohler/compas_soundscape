/**
 * PffdtdGridEstimate Component
 *
 * One line under the wave solver's grid settings: grid points over the acoustic region's box,
 * GPU memory needed vs what a wave solve can use right now (live from the backend: free memory +
 * what Stable Audio 3 releases by moving to system RAM), and the solve time per run. An error
 * notice when the grid does not fit. Estimates only: the backend plans the exact grid.
 */

'use client';

import { useAcousticRegionBounds } from '@/hooks/useAcousticRegionBounds';
import { usePffdtdGpuMemory } from '@/hooks/usePffdtdGpuMemory';
import { waveGridFit } from '@/lib/acoustics/pffdtd-grid';
import type { PffdtdPrecision } from '@/types/pffdtd';
import { Notice } from '@/components/ui/Notice';

interface PffdtdGridEstimateProps {
  /** Grid spacing h (m); null when unknown (hybrid before the crossover can be estimated). */
  gridSpacing: number | null;
  precision: PffdtdPrecision;
  /** IR length (s); null = unknown (hybrid's length from the room's decay): no runtime shown. */
  duration: number | null;
  /** The card shows the "does not fit" notice elsewhere (Hybrid simulation 2: at the top of the card). */
  hideWarning?: boolean;
}

const gb = (bytes: number) => `${(bytes / 1e9).toFixed(bytes < 1e9 ? 2 : 1)} GB`;

function formatDuration(s: number): string {
  if (s < 90) return `${Math.round(s)} s`;
  if (s < 5400) return `${Math.round(s / 60)} min`;
  return `${(s / 3600).toFixed(1)} h`;
}

export function PffdtdGridEstimate({ gridSpacing, precision, duration, hideWarning = false }: PffdtdGridEstimateProps) {
  const { bounds } = useAcousticRegionBounds();
  const memory = usePffdtdGpuMemory();
  if (gridSpacing === null || !bounds) return null;

  const extents = [0, 1, 2].map((i) => bounds.max[i] - bounds.min[i]) as [number, number, number];
  const available = memory?.available_bytes ?? null;
  const { grid, warning } = waveGridFit(extents, gridSpacing, precision, duration, available);
  if (!grid) return null;
  const availableTitle = memory
    ? memory.source === 'live'
      ? `Available now: ${gb(memory.free_bytes ?? 0)} free`
        + (memory.sa3_movable_bytes > 0 ? ` + ${gb(memory.sa3_movable_bytes)} Stable Audio 3 frees by moving to system RAM` : '')
        + (memory.solve_running ? ' + the memory of the wave solve running now' : '')
        + ', minus the solver overhead. Refreshed every few seconds.'
      : 'The configured budget (the GPU could not be queried).'
    : 'Checking the available GPU memory...';

  return (
    <>
      <span className="text-xxs text-secondary-hover" title={availableTitle}>
        ≈ {(grid.nodes / 1e6).toFixed(grid.nodes < 1e7 ? 1 : 0)} M points · {gb(grid.bytes)}
        {available !== null ? ` of ${gb(available)} available` : ''}
        {grid.runtimeS !== null ? ` · ~${formatDuration(grid.runtimeS)} per run` : ''}
      </span>
      {warning && !hideWarning && <Notice type="error" message={warning} />}
    </>
  );
}
