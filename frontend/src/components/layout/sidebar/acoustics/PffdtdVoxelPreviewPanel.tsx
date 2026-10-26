/**
 * PffdtdVoxelPreviewPanel — the voxel grid a wave-based card will simulate.
 *
 * Runs a voxelisation-only job (no solve) for the card's geometry and grid
 * settings, then shows the grid size, the boundary nodes per material, and
 * grid problems (seeds too close to a surface, unreachable listeners, leaks,
 * materials lost to thin geometry). The boundary nodes can be drawn in 3D
 * over the model; clicking a located problem frames the camera on it.
 * The result turns "outdated" as soon as the request signature changes.
 */

'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAcousticMaterialStore, usePffdtdVisualsStore } from '@/store';
import { Badge } from '@/components/ui/Badge';
import { Notice } from '@/components/ui/Notice';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { ToggleField } from '@/components/ui/ToggleField';
import { PFFDTD_VISUALS } from '@/utils/constants';
import { pffdtdMaterialColor, resolvePffdtdMaterial } from '@/lib/acoustics/pffdtd-materials';
import type { PffdtdProblemSeverity, PffdtdVoxelPreviewPayload } from '@/types/pffdtd';

/** Wiring provided by the simulation card (AcousticsSection). */
export interface VoxelPreviewControl {
  /** Request signature of the card right now (compared with the result's). */
  currentSignature: string | null;
  /** Launch the preview with the card's current inputs. */
  onRun: () => void;
  disabled?: boolean;
}

interface PffdtdVoxelPreviewPanelProps extends VoxelPreviewControl {
  configId: string;
}

export const SEVERITY_ORDER: Record<PffdtdProblemSeverity, number> = { error: 0, warning: 1, info: 2 };
export const SEVERITY_DOT: Record<PffdtdProblemSeverity, string> = {
  error: 'bg-error',
  warning: 'bg-warning',
  info: 'bg-info',
};

function gridLine(grid: PffdtdVoxelPreviewPayload['grid']): string {
  const [nx, ny, nz] = grid.shape;
  return [
    `h = ${(grid.h * 100).toFixed(1)} cm`,
    `${nx}×${ny}×${nz}`,
    `${grid.nodes.toLocaleString()} nodes`,
    `${grid.boundary_nodes.toLocaleString()} boundary`,
    `${grid.gpu_memory_gb.toFixed(2)} GB`,
  ].join(' · ');
}

export function PffdtdVoxelPreviewPanel({ configId, currentSignature, onRun, disabled = false }: PffdtdVoxelPreviewPanelProps) {
  const entry = usePffdtdVisualsStore((s) => s.voxelPreviews[configId]);
  const overlay = usePffdtdVisualsStore((s) => s.overlay);
  const setOverlay = usePffdtdVisualsStore((s) => s.setOverlay);
  const cancelVoxelPreview = usePffdtdVisualsStore((s) => s.cancelVoxelPreview);
  const focusedProblemId = usePffdtdVisualsStore((s) => s.focusedProblemId);
  const focusProblem = usePffdtdVisualsStore((s) => s.focusProblem);
  const availableMaterials = useAcousticMaterialStore((s) => s.availableMaterials);
  const [showInfo, setShowInfo] = useState(false);

  const isRunning = entry?.status === 'running';
  const payload = entry?.status === 'done' ? entry.payload : null;
  const isStale = !!payload && !!currentSignature && entry?.signature !== currentSignature;
  const isShown = overlay?.configId === configId && overlay.kind === 'voxels';

  // Hide this card's voxel overlay when the card unmounts (collapsed / removed).
  useEffect(() => () => {
    const s = usePffdtdVisualsStore.getState();
    if (s.overlay?.configId === configId && s.overlay.kind === 'voxels') s.setOverlay(null);
  }, [configId]);

  const problems = useMemo(
    () =>
      (payload?.problems ?? [])
        .filter((p) => showInfo || p.severity !== 'info')
        .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]),
    [payload, showInfo],
  );
  const nErrors = payload?.problems.filter((p) => p.severity === 'error').length ?? 0;
  const nWarnings = payload?.problems.filter((p) => p.severity === 'warning').length ?? 0;

  const rigidColor = typeof document !== 'undefined'
    ? getComputedStyle(document.documentElement).getPropertyValue(PFFDTD_VISUALS.COLOR_VARS.RIGID).trim()
    : undefined;

  return (
    <div className="card-stack--md">
      <div className="flex items-center gap-1.5">
        <span className="text-xxs text-secondary-hover">Voxel grid</span>
        {payload && (
          <>
            {nErrors > 0 && <Badge variant="error">{nErrors} error{nErrors > 1 ? 's' : ''}</Badge>}
            {nWarnings > 0 && <Badge variant="warning">{nWarnings} warning{nWarnings > 1 ? 's' : ''}</Badge>}
            {nErrors + nWarnings === 0 && <Badge variant="success">OK</Badge>}
            {isStale && <Badge title="Inputs changed since the last preview">outdated</Badge>}
          </>
        )}
        <span className="flex-1" />
        <button
          type="button"
          disabled={disabled && !isRunning}
          onClick={() => (isRunning ? cancelVoxelPreview(configId) : onRun())}
          className="cursor-pointer rounded border border-primary bg-transparent px-2 text-xxs font-semibold leading-4 text-primary transition-colors hover:bg-primary hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isRunning ? 'Cancel' : payload ? 'Re-preview' : 'Preview voxels'}
        </button>
      </div>

      {isRunning && (
        <div className="card-field">
          <ProgressBar value={(entry?.progress ?? 0) / 100} label="Voxel preview" />
          <span className="text-xxs text-secondary-hover">{entry?.statusText}</span>
        </div>
      )}
      {entry?.status === 'error' && entry.error && <Notice type="error" message={entry.error} />}

      {payload && (
        <>
          <span className="text-xxs text-secondary-hover">{gridLine(payload.grid)}</span>
          <ToggleField
            checked={isShown}
            disabled={!entry?.points}
            onChange={(on) => setOverlay(on ? { configId, kind: 'voxels', simulationId: null, sourceId: null } : null)}
            label="Show voxel grid in 3D"
          />

          {/* Material legend: boundary nodes per material (same colours as the 3D points) */}
          <ul className="card-stack--tight">
            {payload.materials.map((m) => {
              const material = resolvePffdtdMaterial(m.material_id, availableMaterials);
              return (
                <li key={m.index} className="flex items-center gap-1.5 text-xxs">
                  <span
                    className="h-2 w-2 flex-none rounded-sm"
                    style={{ backgroundColor: pffdtdMaterialColor(m.material_id, availableMaterials) ?? rigidColor }}
                  />
                  <span className="min-w-0 flex-1 truncate">{material?.name ?? m.material_id ?? m.name}</span>
                  <span className="text-secondary-hover">{m.count.toLocaleString()}</span>
                </li>
              );
            })}
            {payload.rigid_count > 0 && (
              <li className="flex items-center gap-1.5 text-xxs">
                <span className="h-2 w-2 flex-none rounded-sm" style={{ backgroundColor: rigidColor }} />
                <span className="min-w-0 flex-1 truncate">Rigid (no material)</span>
                <span className="text-secondary-hover">{payload.rigid_count.toLocaleString()}</span>
              </li>
            )}
          </ul>

          {payload.leak_check.note && <p className="text-xxs text-secondary-hover">{payload.leak_check.note}</p>}

          {problems.length === 0 ? (
            <p className="text-xxs text-secondary-hover">No grid problems found.</p>
          ) : (
            <ul className="card-stack--tight max-h-[min(40vh,320px)] overflow-y-auto">
              {problems.map((problem) => {
                const located = problem.positions.length > 0;
                const isFocused = focusedProblemId === problem.id;
                return (
                  <li key={problem.id}>
                    <button
                      type="button"
                      className={`flex w-full cursor-pointer items-start gap-1.5 rounded px-1 text-left text-xs leading-4 transition-colors hover:bg-secondary-light ${isFocused ? 'bg-secondary-light' : ''}`}
                      onClick={() => {
                        // Located problems also switch the voxel overlay on (the camera frames them).
                        if (located && !isShown) setOverlay({ configId, kind: 'voxels', simulationId: null, sourceId: null });
                        focusProblem(isFocused ? null : problem.id);
                      }}
                      title={located ? 'Show in 3D' : undefined}
                    >
                      <span className={`mt-1 h-2 w-2 flex-none rounded-full ${SEVERITY_DOT[problem.severity]}`} />
                      <span className="min-w-0 flex-1">
                        {problem.title}
                        {isFocused && <span className="card-collapse-body block text-xxs text-secondary-hover">{problem.detail}</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <button
            type="button"
            className="cursor-pointer self-start text-xxs text-secondary-hover underline-offset-2 hover:underline"
            onClick={() => setShowInfo((v) => !v)}
          >
            {showInfo ? 'Hide details' : 'Show details'}
          </button>
        </>
      )}
    </div>
  );
}
