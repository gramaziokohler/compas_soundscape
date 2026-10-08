/**
 * SimulationPreflightPanel — the pre-simulation geometry check of a card.
 *
 * Runs the backend preflight (the exact mesh the simulation will use: welded,
 * oriented from the air side, double-sided where needed, merged into walls),
 * summarises problems by severity, shows the prepared mesh in 3D with
 * diagnostic colour modes, and lists issues that frame the camera on click.
 * The result turns "stale" as soon as the simulation inputs change.
 */

'use client';

import { useEffect, useState } from 'react';
import { useSimulationPreflightStore } from '@/store';
import { Badge } from '@/components/ui/Badge';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Notice } from '@/components/ui/Notice';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { ToggleField } from '@/components/ui/ToggleField';
import { PreflightIssueList } from './PreflightIssueList';
import { PreflightPreviewControls } from './PreflightPreviewControls';
import type { PreflightStats, SimulationEngine } from '@/types/simulationPreflight';

/** Wiring provided by the simulation card (AcousticsSection). */
export interface PreflightPanelControl {
  /** Input signature of the card right now (compared with the result's). */
  currentSignature: string | null;
  /** Launch the check with the card's current inputs. */
  onRun: () => void;
  /** The last Run was stopped by geometry errors. */
  runBlocked?: boolean;
  onRunAnyway?: () => void;
  onDismissBlocked?: () => void;
  disabled?: boolean;
}

interface SimulationPreflightPanelProps extends PreflightPanelControl {
  configId: string;
  engine: SimulationEngine;
}

const ENGINE_NOTE: Record<SimulationEngine, string> = {
  pyroomacoustics:
    'Open edges and thin surfaces are allowed; leaks, outside sources and blocked paths are flagged.',
  choras:
    'Choras meshes a closed air volume: every hole, open edge or zero-thickness surface is an error.',
};

function statsLine(stats: PreflightStats): string {
  const parts = [`${stats.welded_faces.toLocaleString()} faces → ${stats.simulated_walls.toLocaleString()} walls`];
  if (stats.flipped_faces) parts.push(`${stats.flipped_faces} flipped`);
  if (stats.two_sided_faces) parts.push(`${stats.two_sided_faces} double-sided`);
  parts.push(`air ≈ ${Math.round(stats.air_volume_m3).toLocaleString()} m³`);
  return parts.join(' · ');
}

export function SimulationPreflightPanel({
  configId,
  engine,
  currentSignature,
  onRun,
  runBlocked = false,
  onRunAnyway,
  onDismissBlocked,
  disabled = false,
}: SimulationPreflightPanelProps) {
  const entry = useSimulationPreflightStore((s) => s.entries[configId]);
  const previewConfigId = useSimulationPreflightStore((s) => s.previewConfigId);
  const setPreviewConfig = useSimulationPreflightStore((s) => s.setPreviewConfig);
  const cancelPreflight = useSimulationPreflightStore((s) => s.cancelPreflight);
  const [showInfo, setShowInfo] = useState(false);

  const isRunning = entry?.status === 'running';
  const isDone = entry?.status === 'done' && !!entry.payload;
  const isStale = isDone && !!currentSignature && entry.signature !== currentSignature;
  const isPreviewed = previewConfigId === configId;

  // Hide this card's preview when the card unmounts (collapsed / removed).
  useEffect(() => () => {
    const s = useSimulationPreflightStore.getState();
    if (s.previewConfigId === configId) s.setPreviewConfig(null);
  }, [configId]);

  return (
    <div className="card-stack--md">
      <div className="flex items-center gap-1.5">
        <span className="text-xxs text-secondary-hover">Geometry check</span>
        {isDone && entry.summary && (
          <>
            {entry.summary.n_errors > 0 && <Badge variant="error">{entry.summary.n_errors} error{entry.summary.n_errors > 1 ? 's' : ''}</Badge>}
            {entry.summary.n_warnings > 0 && <Badge variant="warning">{entry.summary.n_warnings} warning{entry.summary.n_warnings > 1 ? 's' : ''}</Badge>}
            {entry.summary.n_errors + entry.summary.n_warnings === 0 && <Badge variant="success">OK</Badge>}
            {isStale && <Badge title="Inputs changed since the last check">outdated</Badge>}
          </>
        )}
        <span className="flex-1" />
        <button
          type="button"
          disabled={disabled}
          onClick={() => (isRunning ? cancelPreflight(configId) : onRun())}
          className="cursor-pointer rounded border border-primary bg-transparent px-2 text-xxs font-semibold leading-4 text-primary transition-colors hover:bg-primary hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isRunning ? 'Cancel' : isDone ? 'Re-check' : 'Check geometry'}
        </button>
      </div>

      {runBlocked && isDone && onRunAnyway && onDismissBlocked && (
        <ConfirmDialog
          variant="warning"
          message={`The geometry check found ${entry.summary?.n_errors ?? 0} error(s) that will make the result wrong. Review them below, or run anyway.`}
          confirmLabel="Run anyway"
          cancelLabel="Review"
          onConfirm={onRunAnyway}
          onCancel={onDismissBlocked}
        />
      )}

      {isRunning && (
        <div className="card-field">
          <ProgressBar value={(entry?.progress ?? 0) / 100} label="Geometry check" />
          <span className="text-xxs text-secondary-hover">{entry?.statusText}</span>
        </div>
      )}
      {entry?.status === 'error' && entry.error && <Notice type="error" message={entry.error} />}

      {isDone && entry.payload && (
        <>
          <span className="text-xxs text-secondary-hover">{statsLine(entry.payload.stats)}</span>
          <ToggleField
            checked={isPreviewed}
            onChange={(on) => setPreviewConfig(on ? configId : null)}
            label="Show simulation mesh in 3D"
          />
          {isPreviewed && <PreflightPreviewControls />}
          <PreflightIssueList issues={entry.payload.issues} showInfo={showInfo} />
          <button
            type="button"
            className="cursor-pointer self-start text-xxs text-secondary-hover underline-offset-2 hover:underline"
            onClick={() => setShowInfo((v) => !v)}
          >
            {showInfo ? 'Hide details & auto-fixes' : 'Show details & auto-fixes'}
          </button>
          <p className="text-xxs text-secondary-hover">{ENGINE_NOTE[engine]}</p>
        </>
      )}
    </div>
  );
}
