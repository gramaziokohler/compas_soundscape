/**
 * Hybrid2CheckPanel — the Check step of "Hybrid simulation 2": the geometry check, laid out from
 * the verdict down to the details.
 *
 * 1. Status: running (progress, Cancel), not checked yet, or the verdict (ready / warnings to review
 *    / errors block the run) with "outdated" when the inputs changed, and Re-check.
 * 2. "Run anyway" when the last run was stopped by errors.
 * 3. Key figures: walls, air volume, leaking rays.
 * 4. Issues (errors and warnings): hover highlights in 3D, click frames the camera.
 * 5. 3D preview: the toggle, then its colour and filter options (collapsible).
 * 6. Details and auto-fixes (collapsible): mesh statistics and the info-level notes.
 *
 * Same store and job as SimulationPreflightPanel (kept for the other cards); this is only the layout.
 */

'use client';

import { useEffect, useMemo } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw, XCircle } from 'lucide-react';
import { useSimulationPreflightStore } from '@/store';
import { Badge } from '@/components/ui/Badge';
import { CollapsibleGroup } from '@/components/ui/CollapsibleGroup';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Notice } from '@/components/ui/Notice';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { ToggleField } from '@/components/ui/ToggleField';
import { PreflightIssueList } from './PreflightIssueList';
import { PreflightPreviewControls } from './PreflightPreviewControls';
import type { PreflightPanelControl } from './SimulationPreflightPanel';
import type { PreflightStats } from '@/types/simulationPreflight';

interface Hybrid2CheckPanelProps extends PreflightPanelControl {
  configId: string;
  /** A "Start simulation" button at the end (a completed card has no footer button). */
  onStart?: () => void;
  startDisabled?: boolean;
  startDisabledReason?: string;
}

type Verdict = 'ok' | 'warnings' | 'errors';

const VERDICT_STYLE: Record<Verdict, { color: string; Icon: typeof CheckCircle2 }> = {
  ok: { color: 'var(--color-success)', Icon: CheckCircle2 },
  warnings: { color: 'var(--color-warning)', Icon: AlertTriangle },
  errors: { color: 'var(--color-error)', Icon: XCircle },
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function verdictTitle(verdict: Verdict, errors: number, warnings: number): string {
  if (verdict === 'errors') return `${plural(errors, 'error')} will make the result wrong`;
  if (verdict === 'warnings') return `Ready, ${plural(warnings, 'warning')} to review`;
  return 'Geometry ready to simulate';
}

/** A small figure tile: label over value. */
function Figure({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="min-w-0 flex-1 rounded px-1.5 py-1" style={{ backgroundColor: 'var(--color-secondary-lighter)' }} title={title}>
      <div className="truncate text-xxs text-secondary-hover">{label}</div>
      <div className="truncate text-xs font-semibold">{value}</div>
    </div>
  );
}

function statsDetails(stats: PreflightStats): string[] {
  const rows = [
    `${stats.input_faces.toLocaleString()} input faces, ${stats.welded_faces.toLocaleString()} after welding`,
    `${stats.components.toLocaleString()} parts, ${stats.closed_components.toLocaleString()} closed`,
  ];
  if (stats.flipped_faces) rows.push(`${stats.flipped_faces.toLocaleString()} faces flipped to face the air`);
  if (stats.two_sided_faces) rows.push(`${stats.two_sided_faces.toLocaleString()} faces made double-sided`);
  if (stats.duplicate_faces) rows.push(`${stats.duplicate_faces.toLocaleString()} duplicate faces removed`);
  if (stats.dropped_unassigned_faces) rows.push(`${stats.dropped_unassigned_faces.toLocaleString()} faces without a material left out`);
  rows.push(`Air volume by ${stats.air_volume_method}`);
  return rows;
}

export function Hybrid2CheckPanel({
  configId,
  currentSignature,
  onRun,
  runBlocked = false,
  onRunAnyway,
  onDismissBlocked,
  disabled = false,
  onStart,
  startDisabled = false,
  startDisabledReason,
}: Hybrid2CheckPanelProps) {
  const entry = useSimulationPreflightStore((s) => s.entries[configId]);
  const previewConfigId = useSimulationPreflightStore((s) => s.previewConfigId);
  const setPreviewConfig = useSimulationPreflightStore((s) => s.setPreviewConfig);
  const cancelPreflight = useSimulationPreflightStore((s) => s.cancelPreflight);

  const isRunning = entry?.status === 'running';
  const payload = entry?.status === 'done' ? entry.payload ?? null : null;
  const isStale = !!payload && !!currentSignature && entry?.signature !== currentSignature;
  const isPreviewed = previewConfigId === configId;
  const errors = entry?.summary?.n_errors ?? 0;
  const warnings = entry?.summary?.n_warnings ?? 0;
  const verdict: Verdict = errors > 0 ? 'errors' : warnings > 0 ? 'warnings' : 'ok';
  const problems = useMemo(() => payload?.issues.filter((i) => i.severity !== 'info') ?? [], [payload]);
  const notes = useMemo(() => payload?.issues.filter((i) => i.severity === 'info') ?? [], [payload]);

  // Hide this card's preview when the step unmounts (back to Setup, card collapsed or removed).
  useEffect(() => () => {
    const s = useSimulationPreflightStore.getState();
    if (s.previewConfigId === configId) s.setPreviewConfig(null);
  }, [configId]);

  const recheck = (
    <button
      type="button"
      disabled={disabled}
      onClick={() => (isRunning ? cancelPreflight(configId) : onRun())}
      className="flex shrink-0 cursor-pointer items-center gap-1 rounded border border-primary bg-transparent px-2 text-xxs font-semibold leading-4 text-primary transition-colors hover:bg-primary hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
    >
      {!isRunning && <RefreshCw size={10} />}
      {isRunning ? 'Cancel' : payload ? 'Re-check' : 'Check geometry'}
    </button>
  );

  return (
    <div className="card-stack">
      {/* 1. Status */}
      {isRunning ? (
        <div className="card-field">
          <div className="flex items-center gap-2">
            <span className="flex-1 text-xs">Checking the geometry...</span>
            {recheck}
          </div>
          <ProgressBar value={(entry?.progress ?? 0) / 100} label="Geometry check" />
          {entry?.statusText && <span className="text-xxs text-secondary-hover">{entry.statusText}</span>}
        </div>
      ) : payload ? (
        <div
          className="flex items-center gap-2 rounded border px-2 py-1.5"
          style={{ borderColor: VERDICT_STYLE[verdict].color }}
        >
          {(() => {
            const { Icon, color } = VERDICT_STYLE[verdict];
            return <Icon size={16} className="shrink-0" style={{ color }} />;
          })()}
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold leading-4">{verdictTitle(verdict, errors, warnings)}</div>
            {isStale && (
              <Badge title="The settings, materials or positions changed since this check">outdated: re-check</Badge>
            )}
          </div>
          {recheck}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <span className="flex-1 text-xs text-secondary-hover">The geometry has not been checked yet.</span>
          {recheck}
        </div>
      )}
      {entry?.status === 'error' && entry.error && <Notice type="error" message={entry.error} />}

      {/* 2. Run anyway */}
      {runBlocked && payload && onRunAnyway && onDismissBlocked && (
        <ConfirmDialog
          variant="warning"
          message={`The run was stopped: ${plural(errors, 'error')} in the geometry will make the result wrong.`}
          confirmLabel="Run anyway"
          cancelLabel="Review"
          onConfirm={onRunAnyway}
          onCancel={onDismissBlocked}
        />
      )}

      {payload && (
        <>
          {/* 3. Key figures */}
          <div className="flex gap-1">
            <Figure
              label="Walls"
              value={payload.stats.simulated_walls.toLocaleString()}
              title={`${payload.stats.welded_faces.toLocaleString()} faces merged into ${payload.stats.simulated_walls.toLocaleString()} walls`}
            />
            <Figure label="Air volume" value={`${Math.round(payload.stats.air_volume_m3).toLocaleString()} m³`} />
            <Figure
              label="Leaking rays"
              value={`${(payload.stats.leak_fraction * 100).toFixed(payload.stats.leak_fraction < 0.01 ? 1 : 0)} %`}
              title="Share of test rays that escape the room through openings"
            />
          </div>

          {/* 4. Issues */}
          <div className="card-field">
            <span className="text-xxs text-secondary-hover">
              Issues{problems.length > 0 ? ` (${problems.length})` : ''}
            </span>
            {problems.length > 0
              ? <PreflightIssueList issues={problems} showInfo={false} />
              : <p className="text-xxs text-secondary-hover">No problems found.</p>}
          </div>

          {/* 5. 3D preview */}
          <div className="card-stack--md">
            <ToggleField
              checked={isPreviewed}
              onChange={(on) => setPreviewConfig(on ? configId : null)}
              label="Show the simulation mesh in 3D"
            />
            {isPreviewed && (
              <CollapsibleGroup label="Preview options" variant="section">
                <PreflightPreviewControls hasDiffractionEdges={!!payload.diffraction_edges?.length} />
              </CollapsibleGroup>
            )}
          </div>

          {/* 6. Details */}
          <CollapsibleGroup label={`Details and auto-fixes${notes.length ? ` (${notes.length})` : ''}`} variant="section">
            <ul className="card-stack--tight text-xxs leading-4 text-secondary-hover">
              {statsDetails(payload.stats).map((row) => <li key={row}>{row}</li>)}
            </ul>
            {notes.length > 0 && <PreflightIssueList issues={notes} showInfo />}
          </CollapsibleGroup>
        </>
      )}

      {onStart && (
        <button
          type="button"
          onClick={onStart}
          disabled={startDisabled || isRunning}
          title={startDisabled ? startDisabledReason : isRunning ? 'Wait for the geometry check to finish' : undefined}
          className="btn-primary"
        >
          Start simulation
        </button>
      )}
    </div>
  );
}
