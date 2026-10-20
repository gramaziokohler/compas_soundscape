'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useModelVersionStore, versionLabel } from '@/store';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import { useSimulationVersionImpact } from '@/hooks/useVersionImpact';
import { MODEL_VERSION } from '@/utils/constants';
import { describeObjectChange, formatRelativeChange, isRegionOutdated, regionChanges } from '@/utils/modelVersionImpact';
import type { SimulationConfig } from '@/types/acoustics';
import type { ModelVersionObjectStatus } from '@/types/modelVersionImpact';

interface SimulationVersionBadgeProps {
  config: SimulationConfig;
}

const DOT_CLASS: Record<ModelVersionObjectStatus, string> = {
  changed: 'mv-status-dot mv-status-dot--changed',
  added: 'mv-status-dot mv-status-dot--added',
  removed: 'mv-status-dot mv-status-dot--removed',
  below_tolerance: 'mv-status-dot',
};

/**
 * SimulationVersionBadge
 *
 * Header badge of an expanded simulation card simulated on another model
 * version: shown only when that card's acoustic region changed above tolerance
 * between the version it ran on and the loaded one. Hover (or focus) lists the
 * acoustic-region changes.
 *
 * Usage:
 * ```tsx
 * <Card headerBadge={<SimulationVersionBadge config={config} />} ... />
 * ```
 */
export function SimulationVersionBadge({ config }: SimulationVersionBadgeProps) {
  const impact = useSimulationVersionImpact(config);
  const versions = useModelVersionStore((s) => s.versions);
  const loadedVersionId = useSpeckleEngineStore((s) => s.loadedModelVersionId);
  const badgeRef = useRef<HTMLSpanElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null);

  const hide = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setAnchor(null);
  }, []);
  useEffect(() => hide, [hide]);

  const report = impact?.status === 'ready' ? impact.report : null;
  if (!report || !isRegionOutdated(report) || !config.simulatedVersionId) return null;

  const ranOn = versionLabel(versions, config.simulatedVersionId);
  const loaded = versionLabel(versions, loadedVersionId);
  const changes = regionChanges(report);
  const shown = changes.slice(0, MODEL_VERSION.REGION_GROUP_THRESHOLD);
  const hidden = changes.length - shown.length;
  const { before, after } = report.region;

  const show = (delayMs: number) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const rect = badgeRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = MODEL_VERSION.HOVER_CARD_WIDTH_PX;
      setAnchor({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        top: rect.bottom + 6,
      });
    }, delayMs);
  };

  return (
    <>
      <span
        ref={badgeRef}
        className="mv-badge"
        tabIndex={0}
        role="status"
        aria-label={`Outdated: acoustic region changed since ${ranOn}`}
        onMouseEnter={() => show(MODEL_VERSION.HOVER_CARD_DELAY_MS / 2)}
        onMouseLeave={hide}
        onFocus={() => show(0)}
        onBlur={hide}
      >
        <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01" />
        </svg>
        Outdated · {ranOn}
      </span>

      {anchor && typeof document !== 'undefined' && createPortal(
        <div
          className="mv-panel"
          role="tooltip"
          style={{ position: 'fixed', left: anchor.left, top: anchor.top, width: MODEL_VERSION.HOVER_CARD_WIDTH_PX, zIndex: 10000, padding: '9px 11px', pointerEvents: 'none' }}
        >
          <p className="font-medium">Acoustic region changed {ranOn} → {loaded}</p>
          <p className="mv-hint" style={{ margin: '2px 0 6px' }}>
            {report.region_counts.changed} changed · {report.region_counts.added} added · {report.region_counts.removed} removed
            {' '}(tolerance {Math.round(report.tolerance.distance_m * 100)} cm · {report.tolerance.angle_deg}°)
          </p>
          {shown.map((obj) => (
            <div key={`${obj.status}:${obj.key}`} className="flex items-center gap-2" style={{ padding: '2px 0' }}>
              <span className={DOT_CLASS[obj.status]} aria-hidden="true" />
              <span
                className={obj.status === 'removed' ? 'truncate mv-muted' : 'truncate'}
                style={obj.status === 'removed' ? { textDecoration: 'line-through' } : undefined}
              >
                {obj.name} · {describeObjectChange(obj)}
              </span>
            </div>
          ))}
          {hidden > 0 && <p className="mv-hint" style={{ paddingTop: 2 }}>+{hidden} more — open Show changes for the full list.</p>}
          <p className="mv-hint" style={{ paddingTop: 6 }}>
            Bounding volume {formatRelativeChange(before.bounding_volume_m3, after.bounding_volume_m3)} · surface {Math.round(before.area_m2)} → {Math.round(after.area_m2)} m²
          </p>
        </div>,
        document.body,
      )}
    </>
  );
}
