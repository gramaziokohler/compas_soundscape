'use client';

import { useAcousticMaterialStore, useModelVersionStore, findModelVersion, versionLabel } from '@/store';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import { useSimulationVersionImpact } from '@/hooks/useVersionImpact';
import { assignedMaterialId, formatRelativeChange, isRegionOutdated, regionChanges } from '@/utils/modelVersionImpact';
import type { SimulationConfig } from '@/types/acoustics';
import { geometryIdsFor } from '@/components/scene/model-version/reviewActions';

interface SimulationOutdatedNoticeProps {
  config: SimulationConfig;
  /** Re-run this card on the loaded version. */
  onRerun: () => void;
}

/**
 * SimulationOutdatedNotice
 *
 * Shown on a completed simulation card simulated on another model version.
 * When its acoustic region changed above tolerance the results stay playable,
 * with a warning and actions: re-run on the loaded version, review the
 * changes, or load the version it ran on to compare. Below tolerance it only
 * notes the version it ran on.
 */
export function SimulationOutdatedNotice({ config, onRerun }: SimulationOutdatedNoticeProps) {
  const impact = useSimulationVersionImpact(config);
  const versions = useModelVersionStore((s) => s.versions);
  const loadedVersionId = useSpeckleEngineStore((s) => s.loadedModelVersionId);
  const materialAssignments = useAcousticMaterialStore((s) => s.materialAssignments);

  const ranOnId = config.simulatedVersionId;
  if (!impact || impact.status !== 'ready' || !impact.report || !ranOnId) return null;
  const report = impact.report;
  const ranOn = versionLabel(versions, ranOnId);
  const loadedLabel = versionLabel(versions, loadedVersionId);

  if (!isRegionOutdated(report)) {
    return <p className="mv-hint">Simulated on {ranOn} · no acoustic change above tolerance since.</p>;
  }

  const changes = regionChanges(report);
  const unassigned = changes
    .filter((o) => o.status === 'added' && !assignedMaterialId(o, materialAssignments, geometryIdsFor(o.raw_ids)))
    .length;
  const { before, after } = report.region;
  const details = [
    `${changes.length} surface${changes.length === 1 ? '' : 's'}`,
    unassigned > 0 ? `${unassigned} new without material` : null,
    before.bounding_volume_m3 !== after.bounding_volume_m3
      ? `volume ${formatRelativeChange(before.bounding_volume_m3, after.bounding_volume_m3)}`
      : null,
  ].filter(Boolean).join(', ');
  const store = useModelVersionStore.getState();
  const canLoadOld = !!findModelVersion(versions, ranOnId);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="mv-warning-box">
        <p className="font-semibold" style={{ marginBottom: 2 }}>Outdated results</p>
        Simulated on {ranOn}. Geometry changed above tolerance: {details}. You&apos;re hearing the {ranOn} acoustics.
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className="mv-btn mv-btn--primary" onClick={onRerun}>Re-run on {loadedLabel}</button>
        <button
          type="button"
          className="mv-btn"
          onClick={() => loadedVersionId && store.openReview(ranOnId, loadedVersionId)}
        >
          Show changes
        </button>
        {canLoadOld && (
          <button type="button" className="mv-btn" onClick={() => store.switchToVersion(ranOnId, loadedVersionId)}>
            Load {ranOn} to compare
          </button>
        )}
      </div>
    </div>
  );
}
