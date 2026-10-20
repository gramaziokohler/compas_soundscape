'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  useAcousticsSimulationStore,
  useModelVersionStore,
  useReceiversStore,
  useSoundscapeStore,
  findModelVersion,
  impactKey,
  versionLabel,
} from '@/store';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import { promptMatchesCard } from '@/store/soundscapeStore';
import { useLiveVersionImpact } from '@/hooks/useVersionImpact';
import { CloseIcon } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { FLOATING_WINDOW, MODEL_VERSION, SCENE_BOTTOM_BAR } from '@/utils/constants';
import { useFloatingWindow } from '@/hooks/useFloatingWindow';
import { ResizeHandles } from '@/components/ui/ResizeHandles';
import { buildSimulationImpactRequest, isRegionOutdated, parsePlacementId } from '@/utils/modelVersionImpact';
import { ImpactCounts, RegionChangesSection, ReviewRow, SectionTitle } from './ReviewImpactSections';
import { framePoint } from './reviewActions';

const PANEL_MARGIN = 12;

/** A listener / free sound now outside the room or inside a solid. */
interface PlacementRow {
  id: string;
  label: string;
  position: [number, number, number];
  receiverId: string | null;
  /** Sound card index for free-sound rows. */
  configIndex: number | null;
}

export interface ModelVersionReviewPanelProps {
  /** Right offset so the panel docks beside the right sidebar. */
  rightOffset: number;
  /** Start picking a new object for a sound card (entity-link mode). */
  onRelinkSound: (configIndex: number) => void;
  /** Expand a listener's card. */
  onRevealListener?: (receiverId: string) => void;
  /** Activate the sound's scene, expand it and expand the sound card. */
  onRevealSound?: (configIndex: number) => void;
}

const icon = (d: string) => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);
const WAVE_ICON = icon('M2 12h3l3-8 4 16 4-12 2 4h4');
const LINK_ICON = icon('M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71');
const UNLINK_ICON = icon('M18.84 12.25l1.72-1.71a5 5 0 0 0-7.07-7.07l-1.72 1.71M5.17 11.75l-1.71 1.71a5 5 0 0 0 7.07 7.07l1.71-1.71M8 2v3M2 8h3M16 22v-3M22 16h-3');
const LISTENER_ICON = icon('M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v3');

/**
 * ModelVersionReviewPanel
 *
 * Right-docked panel listing what a model update changed above tolerance in
 * the acoustic region and what it impacts: outdated simulations (re-run),
 * sounds that followed or lost their object (re-link / keep free), and
 * listeners or free sounds now inside a solid or outside the room (locate).
 * No geometry visualization — impacts only.
 */
export function ModelVersionReviewPanel({ rightOffset, onRelinkSound, onRevealListener, onRevealSound }: ModelVersionReviewPanelProps) {
  const review = useModelVersionStore((s) => s.review);
  const versions = useModelVersionStore((s) => s.versions);
  const tolerance = useModelVersionStore((s) => s.tolerance);
  const impacts = useModelVersionStore((s) => s.impacts);
  const linkReport = useModelVersionStore((s) => s.linkReconciliation);
  const acknowledged = useModelVersionStore((s) => s.acknowledgedRows);
  const loadedVersionId = useSpeckleEngineStore((s) => s.loadedModelVersionId);
  const simulationConfigs = useAcousticsSimulationStore((s) => s.simulationConfigs);
  const receivers = useReceiversStore((s) => s.receivers);
  const soundConfigs = useSoundscapeStore((s) => s.soundConfigs);
  const generatedSounds = useSoundscapeStore((s) => s.generatedSounds);
  const [showTolerance, setShowTolerance] = useState(false);

  // Floating window: drag by the header, resize from the edges; geometry is
  // remembered. First opening docks it on the right, beside the right sidebar.
  const { rect, startDrag, startResize } = useFloatingWindow({
    storageKey: FLOATING_WINDOW.VERSION_REVIEW_STORAGE_KEY,
    defaultSize: FLOATING_WINDOW.VERSION_REVIEW_DEFAULT_SIZE,
    minSize: FLOATING_WINDOW.VERSION_REVIEW_MIN_SIZE,
    active: review !== null,
    defaultRect: () => {
      const { w, h } = FLOATING_WINDOW.VERSION_REVIEW_DEFAULT_SIZE;
      const height = Math.min(h, window.innerHeight - SCENE_BOTTOM_BAR.HEIGHT - 2 * PANEL_MARGIN);
      return { w, h: height, x: window.innerWidth - rightOffset - PANEL_MARGIN - w, y: PANEL_MARGIN };
    },
  });

  const impact = useLiveVersionImpact(review?.fromVersionId ?? null, review?.toVersionId ?? null);

  // Every completed card's own comparison (version it ran on → loaded version).
  const simRequests = useMemo(
    () => simulationConfigs
      .map((config) => ({ config, request: buildSimulationImpactRequest(config, loadedVersionId, tolerance) }))
      .filter((r): r is { config: typeof r.config; request: NonNullable<typeof r.request> } => r.request !== null),
    [simulationConfigs, loadedVersionId, tolerance],
  );
  useEffect(() => {
    if (!review) return;
    for (const { request } of simRequests) useModelVersionStore.getState().ensureImpact(request);
  }, [review, simRequests]);

  if (!review || !rect) return null;
  const store = useModelVersionStore.getState();
  const fromLabel = versionLabel(versions, review.fromVersionId);
  const toLabel = versionLabel(versions, review.toVersionId);
  const report = impact?.status === 'ready' ? impact.report : null;

  const outdatedSims = simRequests.filter(({ request }) => {
    const entry = impacts[impactKey(request)];
    return entry?.status === 'ready' && entry.report !== null && isRegionOutdated(entry.report);
  });
  const linkRows = linkReport && linkReport.versionId === review.toVersionId ? linkReport : null;
  const lostRows = linkRows?.lost.filter((l) => !acknowledged.includes(`lost:${l.configId}`)) ?? [];

  const placementRows = (report?.placements ?? []).flatMap<PlacementRow>((p) => {
    const ref = parsePlacementId(p.id);
    if (!ref) return [];
    const where = p.status === 'outside' ? 'is outside the room' : `is inside ${p.object_name ?? 'a solid object'}`;
    if (ref.kind === 'receiver') {
      const r = receivers.find((x) => x.id === ref.refId);
      return r ? [{ id: p.id, label: `${r.name} ${where}`, position: r.position, receiverId: r.id, configIndex: null }] : [];
    }
    const index = soundConfigs.findIndex((c) => c.config_id === ref.refId);
    const event = (generatedSounds as Array<{ prompt_index?: number; position?: number[] }>).find((s) => promptMatchesCard(s.prompt_index, index));
    const name = soundConfigs[index]?.display_name || soundConfigs[index]?.prompt || 'A sound';
    return index >= 0 && event?.position?.length === 3
      ? [{ id: p.id, label: `${name} ${where}`, position: [event.position[0], event.position[1], event.position[2]] as [number, number, number], receiverId: null, configIndex: index }]
      : [];
  });

  const hasImpacts = outdatedSims.length > 0 || (linkRows?.followed.length ?? 0) > 0 || lostRows.length > 0 || placementRows.length > 0;
  const outsideRegion = report
    ? (report.counts.changed - report.region_counts.changed) + (report.counts.added - report.region_counts.added) + (report.counts.removed - report.region_counts.removed)
    : 0;

  return (
    <div
      className="mv-panel pointer-events-auto fixed"
      role="dialog"
      aria-label={`Changes ${fromLabel} to ${toLabel}`}
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, zIndex: 40 }}
    >
      <ResizeHandles onStart={startResize} />

      {/* Header — drag handle (presses on its buttons are ignored) */}
      <div
        className="flex items-center gap-2 flex-shrink-0 touch-none"
        style={{ padding: '9px 11px', cursor: 'grab', userSelect: 'none' }}
        onPointerDown={startDrag}
      >
        <span className="font-medium flex-1">Changes {fromLabel} → {toLabel}</span>
        <button type="button" className="mv-btn" style={{ border: 'none' }} onClick={() => setShowTolerance((v) => !v)} aria-expanded={showTolerance}>
          Tolerance {Math.round(tolerance.distance_m * 100)} cm · {tolerance.angle_deg}°
        </button>
        <button type="button" className="mv-btn" style={{ padding: 3, border: 'none' }} aria-label="Close" onClick={store.closeReview}>
          <CloseIcon />
        </button>
      </div>

      {showTolerance && (
        <div className="mv-popover__section flex items-center gap-3 flex-wrap flex-shrink-0">
          <label className="flex items-center gap-1.5 mv-muted">
            Distance
            <input
              type="number"
              className="mv-field"
              min={MODEL_VERSION.TOLERANCE_LIMITS.distance_cm.min}
              max={MODEL_VERSION.TOLERANCE_LIMITS.distance_cm.max}
              step={MODEL_VERSION.TOLERANCE_LIMITS.distance_cm.step}
              value={Math.round(tolerance.distance_m * 100)}
              onChange={(e) => {
                const cm = Number(e.target.value);
                if (Number.isFinite(cm)) store.setTolerance({ distance_m: Math.min(Math.max(cm, 0), MODEL_VERSION.TOLERANCE_LIMITS.distance_cm.max) / 100 });
              }}
            />
            cm
          </label>
          <label className="flex items-center gap-1.5 mv-muted">
            Angle
            <input
              type="number"
              className="mv-field"
              min={MODEL_VERSION.TOLERANCE_LIMITS.angle_deg.min}
              max={MODEL_VERSION.TOLERANCE_LIMITS.angle_deg.max}
              step={MODEL_VERSION.TOLERANCE_LIMITS.angle_deg.step}
              value={tolerance.angle_deg}
              onChange={(e) => {
                const deg = Number(e.target.value);
                if (Number.isFinite(deg)) store.setTolerance({ angle_deg: Math.min(Math.max(deg, 0), MODEL_VERSION.TOLERANCE_LIMITS.angle_deg.max) });
              }}
            />
            °
          </label>
          <p className="mv-hint w-full">Smaller changes are counted but never mark results outdated.</p>
        </div>
      )}

      <div className="mv-panel__body flex-1">
        {(!impact || impact.status === 'loading') && (
          <div className="mv-popover__section flex items-center gap-2 mv-muted">
            <Spinner size={12} /> Comparing {fromLabel} with {toLabel}…
          </div>
        )}
        {impact?.status === 'error' && (
          <div className="mv-popover__section flex items-center gap-2">
            <span className="flex-1" style={{ color: 'var(--color-error)' }}>{impact.error}</span>
          </div>
        )}

        {report && (
          <>
            <div className="mv-popover__section">
              <ImpactCounts counts={report.region_counts} />
              {outsideRegion > 0 && (
                <p className="mv-hint" style={{ paddingTop: 6 }}>
                  {outsideRegion} more change{outsideRegion === 1 ? '' : 's'} outside the acoustic region.
                </p>
              )}
            </div>
            <div className="mv-popover__section">
              <RegionChangesSection report={report} />
            </div>
          </>
        )}

        {(report || hasImpacts) && (
          <div className="mv-popover__section">
            <SectionTitle>Impact</SectionTitle>
            {!hasImpacts && <p className="mv-muted">Nothing else needs your attention.</p>}
            {outdatedSims.length > 0 && (
              <ReviewRow
                icon={WAVE_ICON}
                title="Open the outdated simulation"
                onClick={() => store.requestRevealSimulation(outdatedSims[0].config.id)}
                actions={
                  <button
                    type="button"
                    className="mv-btn"
                    onClick={() => store.requestRerun(outdatedSims.map(({ config }) => config.id))}
                  >
                    {outdatedSims.length === 1 ? 'Re-run' : outdatedSims.length === 2 ? 'Re-run both' : 'Re-run all'}
                  </button>
                }
              >
                {outdatedSims.length} simulation{outdatedSims.length === 1 ? '' : 's'} outdated
              </ReviewRow>
            )}
            {linkRows?.followed.map((f) => (
              <ReviewRow key={`followed:${f.configId}`} icon={LINK_ICON} title="Open the sound card" onClick={() => onRevealSound?.(f.configIndex)}>
                {f.soundName} followed {f.objectName}
                {f.movedM !== undefined ? <span className="mv-muted"> (moved {f.movedM.toFixed(1)} m)</span> : null}
              </ReviewRow>
            ))}
            {lostRows.map((l) => (
              <ReviewRow
                key={`lost:${l.configId}`}
                icon={UNLINK_ICON}
                title="Open the sound card"
                onClick={() => onRevealSound?.(l.configIndex)}
                actions={
                  <>
                    <button type="button" className="mv-btn" onClick={() => onRelinkSound(l.configIndex)}>Re-link</button>
                    <button type="button" className="mv-btn" onClick={() => store.acknowledgeRow(`lost:${l.configId}`)}>Keep free</button>
                  </>
                }
              >
                {l.soundName} lost {l.objectName ? l.objectName : 'its object'}
              </ReviewRow>
            ))}
            {placementRows.map((p) => (
              <ReviewRow
                key={p.id}
                icon={LISTENER_ICON}
                title={p.receiverId ? 'Open the listener card' : 'Open the sound card'}
                onClick={() => {
                  framePoint(p.position);
                  if (p.receiverId) onRevealListener?.(p.receiverId);
                  else if (p.configIndex !== null) onRevealSound?.(p.configIndex);
                }}
                actions={
                  <button
                    type="button"
                    className="mv-btn"
                    onClick={() => {
                      framePoint(p.position);
                      if (p.receiverId) onRevealListener?.(p.receiverId);
                    }}
                  >
                    Locate
                  </button>
                }
              >
                {p.label}
              </ReviewRow>
            ))}
          </div>
        )}
      </div>

      <div className="mv-popover__section flex justify-end gap-2 flex-shrink-0">
        {findModelVersion(versions, review.fromVersionId) && review.fromVersionId !== loadedVersionId && (
          <button type="button" className="mv-btn" onClick={() => store.switchToVersion(review.fromVersionId, loadedVersionId)}>
            Go back to {fromLabel}
          </button>
        )}
        <button type="button" className="mv-btn mv-btn--primary" onClick={() => { store.closeReview(); store.dismissBanner(); }}>
          Done
        </button>
      </div>
    </div>
  );
}
