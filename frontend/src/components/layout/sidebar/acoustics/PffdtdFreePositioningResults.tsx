/**
 * PffdtdFreePositioningResults — free positioning on a completed wave-based card.
 *
 * Shows the run's candidate grid (mode, valid points, effective spacing), a
 * "Show grid" switch for the viewer overlay, and the state of each moved free
 * object: deriving its IR, playing the IR of a grid point (and how far it
 * snapped), or outside the grid / expired (re-run). The moves themselves are
 * handled by hooks/usePffdtdFreeMovement.ts; the grid is loaded there too.
 */

'use client';

import { usePffdtdFreeStore } from '@/store';
import { ToggleField } from '@/components/ui/ToggleField';
import { Notice } from '@/components/ui/Notice';
import type { PffdtdFreeObjectStatus } from '@/store';

interface PffdtdFreePositioningResultsProps {
  configId: string;
  simulationId: string;
}

const cm = (m: number) => `${Math.round(m * 100)} cm`;

function statusLine(o: PffdtdFreeObjectStatus): string {
  switch (o.state) {
    case 'pending':
      return `${o.label}: deriving its IR…`;
    case 'ready':
      return `${o.label}: IR of the grid point ${cm(o.distanceM ?? 0)} away`;
    default:
      return `${o.label}: ${o.message ?? 'no IR'}`;
  }
}

export function PffdtdFreePositioningResults({ configId, simulationId }: PffdtdFreePositioningResultsProps) {
  const grid = usePffdtdFreeStore((s) => s.grids[simulationId]);
  const objects = usePffdtdFreeStore((s) => s.objects[simulationId]);
  const show = usePffdtdFreeStore((s) => !!s.showGrid[configId]);
  const setShowGrid = usePffdtdFreeStore((s) => s.setShowGrid);

  if (!grid || grid.status === 'none' || grid.status === 'loading') return null;
  if (grid.status === 'expired' || grid.status === 'error') {
    return (
      <Notice
        type="warning"
        message={
          grid.status === 'expired'
            ? 'Free positioning: the stored grid signals have expired. Re-run to move listeners or sources again.'
            : `Free positioning unavailable: ${grid.error ?? 'failed to load the grid'}`
        }
      />
    );
  }
  const block = grid.block;
  if (!block) return null;

  const statuses = Object.values(objects ?? {});
  const problems = statuses.filter((o) => o.state !== 'pending' && o.state !== 'ready' && o.state !== 'superseded');
  const side = block.mode === 'listener' ? 'listeners' : 'sources';
  const coarsened = block.spacing_m > block.requested_spacing_m * 1.01;

  return (
    <div className="card-stack--tight">
      <span className="text-xxs text-secondary-hover">
        Free {block.mode === 'listener' ? 'listener' : 'source'}: move the {side} — each plays the IR of the nearest of{' '}
        {block.n_valid} grid points ({cm(block.spacing_m)} apart{coarsened ? `, coarsened from ${cm(block.requested_spacing_m)} to fit memory` : ''})
        within {cm(block.snap_radius_m)}.
      </span>
      <ToggleField checked={show} onChange={(checked) => setShowGrid(configId, checked)} label="Show grid" />
      {statuses
        .filter((o) => o.state === 'pending' || o.state === 'ready')
        .map((o) => (
          <span key={o.label} className="text-xxs text-secondary-hover">
            {statusLine(o)}
          </span>
        ))}
      {problems.length > 0 && (
        <Notice
          type="warning"
          message={
            <ul className="card-stack--tight list-disc pl-3">
              {problems.map((o) => (
                <li key={o.label}>{statusLine(o)}</li>
              ))}
            </ul>
          }
        />
      )}
      {block.mode === 'source' && (
        <span className="text-xxs text-secondary-hover">
          The runs start at the listeners (reciprocity), so there is no strength-G volume or wave animation.
        </span>
      )}
    </div>
  );
}
