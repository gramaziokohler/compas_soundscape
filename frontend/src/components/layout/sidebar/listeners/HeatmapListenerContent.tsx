'use client';

import { useCallback, useMemo } from 'react';
import { SurfaceGridEditor } from './SurfaceGridEditor';
import { GenerateButton } from '@/components/ui/GenerateButton';
import { CardSelect } from '@/components/ui/CardSelect';
import { Notice } from '@/components/ui/Notice';
import { GradientMapManager } from '@/lib/three/gradient-map-manager';
import { useHeatmapListenersStore } from '@/store';
import { useHeatmapRun } from '@/hooks/useHeatmapRun';
import { useHeatmapLevels } from '@/hooks/useHeatmapGradient';
import { HEATMAP_LISTENER_CONFIG } from '@/utils/constants';
import type { HeatmapListenerData, HeatmapMetric } from '@/types/heatmap';

type BBox = { min: [number, number, number]; max: [number, number, number] };

interface HeatmapListenerContentProps {
  heatmap: HeatmapListenerData;
  color: string;
  onComputeBounds: (objectIds: string[]) => BBox | null;
  /** Heatmap powered (its gradient plane shown). */
  isPowered: boolean;
  onPowerOn: () => void;
}

const SPL_A_VALUE = 'spl_a';

function metricLabel(metric: HeatmapMetric, bands: readonly number[]): string {
  if (metric === 'spl_a') return 'SPL dB(A)';
  const f = bands[metric];
  return `SPL ${HEATMAP_LISTENER_CONFIG.BAND_LABELS[f] ?? `${f} Hz`} (dB)`;
}

/**
 * HeatmapListenerContent Component
 *
 * Heatmap card body: the shared surface editor, the simulation card it maps
 * (the active one), the compute control, and — once computed — the metric
 * selector and the colour legend. The map follows each sound's volume, mute
 * and solo live (useHeatmapLevels); recomputing is only needed when the
 * geometry, materials, sources or surface change.
 */
export function HeatmapListenerContent({
  heatmap,
  color,
  onComputeBounds,
  isPowered,
  onPowerOn,
}: HeatmapListenerContentProps) {
  const { activeCardName, canRun, disabledReason, run, result, isRunning, isOutdated, start, cancel } = useHeatmapRun(heatmap);
  const levels = useHeatmapLevels(heatmap.id);
  const payload = useHeatmapListenersStore((s) => (result ? s.payloads[result.heatmapId] : undefined));

  const onUpdate = useCallback(
    (updates: Partial<Omit<HeatmapListenerData, 'id'>>) =>
      useHeatmapListenersStore.getState().updateHeatmapListener(heatmap.id, updates),
    [heatmap.id],
  );
  const onSetBounds = useCallback(
    (ids: string[], bbox: BBox) => useHeatmapListenersStore.getState().setHeatmapListenerBounds(heatmap.id, ids, bbox),
    [heatmap.id],
  );

  const metricOptions = useMemo(() => [
    { value: SPL_A_VALUE, label: 'dB(A)' },
    ...(levels?.bands ?? []).map((f, i) => ({
      value: String(i),
      label: HEATMAP_LISTENER_CONFIG.BAND_LABELS[f] ?? `${f} Hz`,
    })),
  ], [levels?.bands]);

  const handleMetricChange = useCallback((value: string) => {
    useHeatmapListenersStore.getState().setMetric(heatmap.id, value === SPL_A_VALUE ? 'spl_a' : Number(value));
  }, [heatmap.id]);

  const status = isRunning ? 'generating' : 'idle';
  const outsideCount = payload ? payload.inside.filter((inside) => !inside).length : 0;

  return (
    <div className="card-stack">
      <SurfaceGridEditor
        grid={heatmap}
        color={color}
        onComputeBounds={onComputeBounds}
        isPowered={isPowered}
        onPowerOn={onPowerOn}
        onUpdate={onUpdate}
        onSetBounds={onSetBounds}
        undoStoreId="heatmapListeners"
        defaultSpacing={HEATMAP_LISTENER_CONFIG.DEFAULT_SPACING}
        pointNoun="map point"
      />

      <div className="flex items-center gap-1.5 text-[10px]">
        <span className="shrink-0 text-secondary-hover">Simulation</span>
        <span
          className="flex-1 truncate text-right"
          style={{ color: activeCardName ? 'var(--color-foreground)' : 'var(--color-secondary-hover)' }}
          title="The heatmap uses the geometry and materials of the active simulation card"
        >
          {activeCardName ?? 'none active'}
        </span>
      </div>

      {isOutdated && !isRunning && (
        <Notice type="warning" variant="tag" message="Outdated: the surface, sources or simulation changed" />
      )}
      {run?.status === 'error' && run.error && <Notice type="error" variant="bar" message={run.error} />}

      <GenerateButton
        status={status}
        progress={run?.progress ?? 0}
        statusText={run?.statusText}
        label={result ? 'Recompute heatmap' : 'Compute heatmap'}
        disabled={!canRun}
        disabledReason={disabledReason}
        onGenerate={start}
        onStop={cancel}
      />

      {levels && (
        <div className="card-stack--md">
          <div className="flex items-center gap-2">
            <span className="text-[10px] shrink-0 text-secondary-hover">Show</span>
            <CardSelect
              value={levels.metric === 'spl_a' ? SPL_A_VALUE : String(levels.metric)}
              onChange={handleMetricChange}
              compact
              className="flex-1"
              options={metricOptions}
              forceMenu
            />
          </div>
          {levels.min !== null && levels.max !== null ? (
            <div className="card-stack--tight">
              <div className="h-3.5 w-full rounded" style={{ background: GradientMapManager.CSS_GRADIENT }} />
              <div className="flex items-center justify-between text-[10px] text-secondary-hover">
                <span>{levels.min.toFixed(1)}</span>
                <span>{metricLabel(levels.metric, levels.bands)}</span>
                <span>{levels.max.toFixed(1)}</span>
              </div>
            </div>
          ) : (
            <Notice type="info" variant="tag" message="Every source is muted" />
          )}
          {outsideCount > 0 && (
            <span className="text-[10px] text-secondary-hover">
              {outsideCount} point{outsideCount !== 1 ? 's' : ''} outside the room left out
            </span>
          )}
          {!isPowered && (
            <button
              onClick={onPowerOn}
              className="self-start text-[10px] underline cursor-pointer text-secondary-hover hover:text-foreground"
            >
              Show on the model
            </button>
          )}
        </div>
      )}
    </div>
  );
}
