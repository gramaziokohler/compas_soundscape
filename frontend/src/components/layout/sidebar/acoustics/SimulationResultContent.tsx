/**
 * SimulationResultContent Component
 *
 * Renders the results of a simulation (metrics and IR upload) for Choras and Pyroomacoustics cards.
 * Displayed in the `afterContent` slot of the card after completion.
 *
 * When grid receivers are detected in sourceReceiverIRMapping, the text metrics block
 * is replaced by a gradient-map metric selector (RT60 / EDT / D50 / C50) + color legend.
 */

'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { ImpulseResponseUpload } from '@/components/audio/ImpulseResponseUpload';
import type { SimulationConfig } from '@/types/acoustics';
import type { ImpulseResponseMetadata, SourceReceiverIRMapping } from '@/types/audio';
import { Notice } from '@/components/ui/Notice';
import { Spinner } from '@/components/ui/Spinner';
import { CardSelect } from '@/components/ui/CardSelect';
import { NumberField } from '@/components/ui/NumberField';
import type { GradientMetric } from '@/store/uiStore';
import { useUIStore } from '@/store/uiStore';
import { useGridListenersStore } from '@/store';
import { fetchPerReceiverMetrics, fetchPyroomAcousticMetrics, fetchChorasAcousticMetrics, type PerReceiverMetrics, type AcousticParameters } from '@/utils/acousticMetrics';
import { GradientMapManager } from '@/lib/three/gradient-map-manager';
import { SIMULATION_POSITION_THRESHOLD } from '@/utils/constants';

// ─── Metric metadata ──────────────────────────────────────────────────────────

const METRICS: Array<{ key: GradientMetric; label: string; unit: string; format: (v: number) => string }> = [
  { key: 'rt60', label: 'RT60', unit: 's',  format: (v) => `${v.toFixed(2)}s`  },
  { key: 'edt',  label: 'EDT',  unit: 's',  format: (v) => `${v.toFixed(2)}s`  },
  { key: 'd50',  label: 'D50',  unit: '%',  format: (v) => `${(v*100).toFixed(0)}%` },
  { key: 'c50',  label: 'C50',  unit: 'dB', format: (v) => `${v.toFixed(1)}dB` },
  // 'spl' is a relative energy level for pyroomacoustics (not physical SPL).
  { key: 'spl',  label: 'Level', unit: 'dB', format: (v) => `${v.toFixed(1)}dB` },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Count source-receiver IR pairs stored on a completed simulation. */
export function countComputedIRs(mapping: SourceReceiverIRMapping | undefined): number {
  if (!mapping) return 0;
  let count = 0;
  for (const receiverMap of Object.values(mapping)) {
    count += Object.keys(receiverMap).length;
  }
  return count;
}

/** One-line summary for a reduced simulation card header (mirrors sound-card collapsedInfo). */
export function getSimulationResultCollapsedInfo(config: SimulationConfig): string {
  if (config.state !== 'completed') return '';
  const mapping = (config as { sourceReceiverIRMapping?: SourceReceiverIRMapping }).sourceReceiverIRMapping;
  const count = countComputedIRs(mapping);
  if (count === 0) return '';
  return count === 1 ? '(1 IR)' : `(${count} IRs)`;
}

/** True if any receiver ID in the mapping looks like a grid-listener receiver */
function detectGridReceivers(mapping: SourceReceiverIRMapping | undefined): boolean {
  if (!mapping) return false;
  for (const srcId of Object.keys(mapping)) {
    for (const rcvId of Object.keys(mapping[srcId])) {
      if (rcvId.startsWith('grid-listener-')) return true;
    }
  }
  return false;
}

type MetricWarning = { metricKey: string; message: string };

function getMetricWarnings(params: AcousticParameters): MetricWarning[] {
  const warnings: MetricWarning[] = [];
  if (params.rt60 !== null && params.rt60IsEstimate) {
    warnings.push({
      metricKey: 'rt60',
      message: 'RT60 is an estimate: ISM-only simulation, no ray-traced diffuse tail',
    });
  }
  if (params.rt60 !== null && params.rt60Reliable === false) {
    warnings.push({
      metricKey: 'rt60',
      message: 'RT60 is unreliable (low measured decay range)',
    });
  }
  if (params.edt !== null && params.edtReliable === false) {
    warnings.push({
      metricKey: 'edt',
      message: 'EDT is unreliable (low measured decay range)',
    });
  }
  return warnings;
}

function getWarningForMetric(warnings: MetricWarning[], metricKey: string): string | undefined {
  const matches = warnings.filter((w) => w.metricKey === metricKey);
  return matches.length > 0 ? matches.map((w) => w.message).join(' · ') : undefined;
}

/** Compact spinner shown while the acoustic-metrics JSON is fetched from the backend. */
function MetricsLoading() {
  return (
    <div
      className="flex items-center gap-2 py-1.5 text-[11px]"
      style={{ color: 'var(--color-on-blue-muted)' }}
    >
      <Spinner size={12} />
      Loading metrics…
    </div>
  );
}

function AcousticMetricsPanel({ params }: { params: AcousticParameters }) {
  const warnings = getMetricWarnings(params);
  const columns: Array<{ key: string; label: string; value: string; unit?: string; warning?: string }> = [];

  if (params.rt60 !== null) {
    columns.push({
      key: 'rt60',
      label: 'RT60',
      value: params.rt60.toFixed(2),
      unit: 's',
      warning: getWarningForMetric(warnings, 'rt60'),
    });
  }
  if (params.edt !== null) {
    columns.push({
      key: 'edt',
      label: 'EDT',
      value: params.edt.toFixed(2),
      unit: 's',
      warning: getWarningForMetric(warnings, 'edt'),
    });
  }
  if (params.d50 !== null) {
    columns.push({
      key: 'd50',
      label: 'D50',
      value: (params.d50 * 100).toFixed(0),
      unit: '%',
    });
  }
  if (params.c50 !== null) {
    columns.push({
      key: 'c50',
      label: 'C50',
      value: params.c50.toFixed(1),
      unit: ' dB',
    });
  }
  if (params.spl !== null && params.spl !== undefined) {
    columns.push({
      key: 'spl',
      label: params.splIsRelative ? 'Energy' : 'SPL',
      value: params.spl.toFixed(1),
      unit: ' dB',
    });
  }

  if (columns.length === 0) return null;

  const cellBorder = { borderColor: 'var(--color-on-blue-faint)' };

  return (
    <div className="card-stack--md">
      <h3 className="text-xs font-semibold" style={{ color: 'var(--color-on-blue)' }}>
        Acoustic Metrics
      </h3>
      <table className="w-full border-collapse table-fixed">
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className="border px-1.5 py-0.5 text-[9px] font-medium"
                style={{ ...cellBorder, color: 'var(--color-on-blue-muted)' }}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {columns.map((col) => (
              <td
                key={col.key}
                className={`border px-1.5 py-1 text-center text-[10px] font-semibold tabular-nums ${col.warning ? 'text-warning' : ''}`}
                style={col.warning ? cellBorder : { ...cellBorder, color: 'var(--color-on-blue)' }}
                title={col.warning}
              >
                {col.value}
                {col.warning ? '*' : ''}
                {col.unit}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface SimulationResultContentProps {
  config: SimulationConfig;
  onClearIR: () => void;
  irRefreshTrigger?: number;
  onIRHover?: (sourceId: string | null, receiverId: string | null) => void;
  sourceDisplayNames?: Record<string, string>;
  receiverDisplayNames?: Record<string, string>;
  /** Whether the parent card is currently expanded */
  isExpanded?: boolean;
  /** Controlled selected metric — persisted by the parent across expand/collapse */
  selectedMetric?: GradientMetric | null;
  onMetricChange?: (metric: GradientMetric | null) => void;
  /** Current positions of sound sources keyed by sound ID (per-sound drift detection) */
  currentSoundPositions?: Record<string, [number, number, number]>;
  /** Display names of sound sources keyed by sound ID (for per-sound mismatch labels) */
  currentSoundNames?: Record<string, string>;
  /** Current positions of receivers/grid-listeners (for simulation-position drift detection) */
  currentReceiverPositions?: Record<string, [number, number, number]>;
  /** Called when user clicks "Reset positions" — should move mismatched objects back to sim positions */
  onResetPositions?: (sourceIds: string[], receiverIds: string[]) => void;
  /** Maps each receiver ID → { groupId, groupName } for grouping grid listener points under one parent */
  receiverGroups?: Record<string, { groupId: string; groupName: string }>;
  /** Called when user clicks the Go-To button next to a receiver group */
  onGoToReceiver?: (receiverId: string) => void;
  /** Increments when FPS mode exits — clears the active listener border */
  fpsExitTrigger?: number;
  /** When set, scrolls to and highlights the corresponding IR group */
  forcedActiveGroupId?: string | null;
  pairDefinitions?: Array<{ sourceId: string; receiverId: string }>;
  availableSourceCount?: number;
  availableReceiverCount?: number;
  allowPairUploads?: boolean;
  onPairIRUploaded?: (sourceId: string, receiverId: string, ir: ImpulseResponseMetadata) => void;
  onPairAssignmentCleared?: (sourceId: string, receiverId: string) => void;
  singleIRPerListener?: boolean;
  onListenerIRUploaded?: (pairs: Array<{ sourceId: string; receiverId: string }>, ir: ImpulseResponseMetadata) => void;
  onListenerAssignmentCleared?: (pairs: Array<{ sourceId: string; receiverId: string }>) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SimulationResultContent({
  config,
  onClearIR,
  irRefreshTrigger = 0,
  onIRHover,
  sourceDisplayNames,
  receiverDisplayNames,
  isExpanded = true,
  selectedMetric: controlledMetric = null,
  onMetricChange,
  currentSoundPositions,
  currentSoundNames,
  currentReceiverPositions,
  onResetPositions,
  receiverGroups,
  onGoToReceiver,
  fpsExitTrigger,
  forcedActiveGroupId,
  pairDefinitions,
  availableSourceCount,
  availableReceiverCount,
  allowPairUploads = false,
  onPairIRUploaded,
  onPairAssignmentCleared,
  singleIRPerListener = false,
  onListenerIRUploaded,
  onListenerAssignmentCleared,
}: SimulationResultContentProps) {
  const simulationConfig = config as any;
  const results: string | null = simulationConfig.simulationResults;

  const sourceReceiverIRMapping: SourceReceiverIRMapping | undefined = simulationConfig.sourceReceiverIRMapping;
  const simulationId: string | undefined = simulationConfig.currentSimulationId;
  const simType: 'pyroomacoustics' | 'choras' | undefined =
    config.type === 'pyroomacoustics' || config.type === 'choras' ? config.type : undefined;
  const simulationSourcePositions = (simulationConfig.simulationPositions as {
    sources?: Record<string, [number, number, number]>;
  } | undefined)?.sources;

  const [lowEnergyIRIds, setLowEnergyIRIds] = useState<Set<string>>(new Set());
  const handleLowEnergyIdsChange = useCallback((ids: Set<string>) => setLowEnergyIRIds(ids), []);

  const gridListeners = useGridListenersStore((s) => s.gridListeners);

  // ── Position mismatch detection ─────────────────────────────────────────
  const mismatchInfo = useMemo<{
    names: string[];
    sourceIds: string[];
    receiverIds: string[];
  }>(() => {
    const empty = { names: [], sourceIds: [], receiverIds: [] };
    if (!isExpanded) return empty;
    const simPositions = (simulationConfig as any).simulationPositions as {
      sources: Record<string, [number, number, number]>;
      receivers: Record<string, [number, number, number]>;
      soundToPosKey?: Record<string, string>;
      gridListeners?: Array<{
        id: string;
        name: string;
        points: [number, number, number][];
      }>;
    } | undefined;
    if (!simPositions) return empty;

    const names: string[] = [];
    const sourceIds: string[] = [];
    const receiverIds: string[] = [];

    // Per-sound detection: compare each sound's simulation-time position key
    // (soundToPosKey) to its CURRENT position. Keying by posKey alone breaks
    // because a dragged sound's posKey changes, so the sim-time key disappears
    // from currentSourcePositions.
    if (currentSoundPositions) {
      const soundToPosKey = simPositions.soundToPosKey ?? {};
      for (const [soundId, simPosKey] of Object.entries(soundToPosKey)) {
        const simPos = simPositions.sources[simPosKey];
        const cur = currentSoundPositions[soundId];
        if (!simPos || !cur) continue;
        const dist = Math.hypot(simPos[0] - cur[0], simPos[1] - cur[1], simPos[2] - cur[2]);
        if (dist > SIMULATION_POSITION_THRESHOLD) {
          names.push(currentSoundNames?.[soundId] || soundId);
          sourceIds.push(soundId);
        }
      }
    }

    // Grid listeners: a grid is mismatched when ANY of its current points differ
    // from the sim-time snapshot. Report one per-grid summary with a COUNT of the
    // listeners out of position (never a single generic "grid N" or per-point noise).
    const gridPointIds = new Set<string>();
    if (simPositions.gridListeners && gridListeners.length > 0) {
      const gridLookup = new Map(gridListeners.map((g) => [g.id, g]));
      for (const snap of simPositions.gridListeners) {
        const grid = gridLookup.get(snap.id);
        if (!grid) continue;
        snap.points.forEach((_, i) => gridPointIds.add(`${snap.id}-${i}`));
        let count = 0;
        const n = Math.max(snap.points.length, grid.points.length);
        for (let i = 0; i < n; i++) {
          const simP = snap.points[i];
          const curP = grid.points[i];
          if (!simP || !curP) {
            if (simP || curP) count++;
            continue;
          }
          const dist = Math.hypot(simP[0] - curP[0], simP[1] - curP[1], simP[2] - curP[2]);
          if (dist > SIMULATION_POSITION_THRESHOLD) count++;
        }
        if (count > 0) {
          names.push(`${snap.name || snap.id} — ${count} listener${count === 1 ? '' : 's'} out of position`);
          receiverIds.push(snap.id);
        }
      }
    }

    if (currentReceiverPositions) {
      for (const [id, simPos] of Object.entries(simPositions.receivers)) {
        // Grid point receivers are covered by the per-grid summary above
        if (gridPointIds.has(id)) continue;
        const cur = currentReceiverPositions[id];
        if (!cur) continue;
        const dist = Math.hypot(simPos[0] - cur[0], simPos[1] - cur[1], simPos[2] - cur[2]);
        if (dist > SIMULATION_POSITION_THRESHOLD) {
          names.push(receiverDisplayNames?.[id] || id);
          receiverIds.push(id);
        }
      }
    }

    return { names, sourceIds, receiverIds };
  }, [isExpanded, simulationConfig, currentSoundPositions, currentSoundNames, currentReceiverPositions, receiverDisplayNames, gridListeners]);

  const mismatchedNames = mismatchInfo.names;

  // ── Gradient map state ──────────────────────────────────────────────────
  const setActiveGradientMap = useUIStore((s) => s.setActiveGradientMap);

  const hasGridReceivers = useMemo(() => detectGridReceivers(sourceReceiverIRMapping), [sourceReceiverIRMapping]);

  const [perReceiverMetrics, setPerReceiverMetrics] = useState<PerReceiverMetrics | null>(null);
  const [acousticParams, setAcousticParams] = useState<AcousticParameters | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const selectedMetric = controlledMetric;
  const setSelectedMetric = onMetricChange ?? (() => {});

  // User-editable range — initialised from data, reset when metric/data changes
  const [userMin, setUserMin] = useState<number | null>(null);
  const [userMax, setUserMax] = useState<number | null>(null);
  const prevMetricRef = useRef<string | null>(null);

  // Fetch per-receiver metrics once when grid receivers are present and we have a simulationId
  useEffect(() => {
    if (!hasGridReceivers || !simulationId || !simType) return;
    let cancelled = false;
    setMetricsLoading(true);
    fetchPerReceiverMetrics(simulationId, simType)
      .then((m) => {
        if (cancelled) return;
        if (Object.keys(m).length > 0) setPerReceiverMetrics(m);
      })
      .finally(() => {
        if (!cancelled) setMetricsLoading(false);
      });
    return () => { cancelled = true; };
  }, [hasGridReceivers, simulationId, simType]);

  // Fetch aggregate acoustic metrics for the text-metrics panel (non-grid simulations)
  useEffect(() => {
    if (hasGridReceivers || !simulationId || !simType) {
      setAcousticParams(null);
      return;
    }
    let cancelled = false;
    setMetricsLoading(true);
    const fetchMetrics = simType === 'pyroomacoustics'
      ? fetchPyroomAcousticMetrics
      : fetchChorasAcousticMetrics;
    fetchMetrics(simulationId)
      .then((params) => {
        if (!cancelled) setAcousticParams(params);
      })
      .finally(() => {
        if (!cancelled) setMetricsLoading(false);
      });
    return () => { cancelled = true; };
  }, [hasGridReceivers, simulationId, simType]);

  // ── Gradient map: compute point values and dispatch to uiStore ──────────
  useEffect(() => {
    if (!isExpanded || !selectedMetric || !perReceiverMetrics) {
      setActiveGradientMap(null);
      return;
    }

    // Gather all grid listeners that contributed receivers to this simulation
    const allPointValues: Array<{ position: [number, number, number]; value: number }> = [];
    let primaryBbox: { min: [number, number, number]; max: [number, number, number] } | null = null;

    for (const g of gridListeners) {
      if (!g.boundingBox || g.hiddenForSimulation) continue;

      let contributed = false;
      g.points.forEach((pt, i) => {
        const rcvId = `${g.id}-${i}`;
        const params = perReceiverMetrics[rcvId];
        if (!params) return;
        const val = params[selectedMetric];
        if (val == null) return;
        allPointValues.push({ position: pt, value: val });
        contributed = true;
      });

      if (contributed && !primaryBbox) primaryBbox = g.boundingBox;
    }

    if (allPointValues.length === 0 || !primaryBbox) {
      setActiveGradientMap(null);
      return;
    }

    setActiveGradientMap({
      metric: selectedMetric,
      pointValues: allPointValues,
      boundingBox: primaryBbox,
      ...(userMin !== null && userMax !== null ? { range: { min: userMin, max: userMax } } : {}),
    });
  }, [isExpanded, selectedMetric, perReceiverMetrics, gridListeners, setActiveGradientMap, userMin, userMax]);

  // Clear gradient map when unmounted or card collapses
  useEffect(() => {
    return () => { setActiveGradientMap(null); };
  }, [setActiveGradientMap]);

  // ── Gradient legend values ──────────────────────────────────────────────
  const legendRange = useMemo(() => {
    if (!selectedMetric || !perReceiverMetrics) return null;
    const vals: number[] = [];
    for (const params of Object.values(perReceiverMetrics)) {
      const v = params[selectedMetric];
      if (v != null) vals.push(v);
    }
    if (vals.length === 0) return null;
    const minVal = Math.min(...vals);
    const maxVal = Math.max(...vals);
    const meta = METRICS.find((m) => m.key === selectedMetric)!;
    return { min: minVal, max: maxVal, format: meta.format };
  }, [selectedMetric, perReceiverMetrics]);

  useEffect(() => {
    if (!legendRange) { setUserMin(null); setUserMax(null); return; }
    // Reset when the metric or data changes
    if (selectedMetric !== prevMetricRef.current) {
      prevMetricRef.current = selectedMetric ?? null;
      setUserMin(legendRange.min);
      setUserMax(legendRange.max);
    } else if (userMin === null || userMax === null) {
      setUserMin(legendRange.min);
      setUserMax(legendRange.max);
    }
  }, [legendRange, selectedMetric]);

  const displayMin = userMin ?? legendRange?.min ?? 0;
  const displayMax = userMax ?? legendRange?.max ?? 1;

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="card-stack">
      {isExpanded && mismatchedNames.length > 0 && (
        <Notice type="error" message={
          <div className="flex-1 flex flex-col gap-1.5">
            <span>
              <strong>{mismatchedNames.join(', ')}</strong>{' '}
              {mismatchedNames.length === 1 ? 'is' : 'are'} not at simulation position — results may not match the current layout.
            </span>
            {onResetPositions && (
              <button
                onClick={() => onResetPositions(mismatchInfo.sourceIds, mismatchInfo.receiverIds)}
                className="self-start px-2 py-0.5 rounded border border-error bg-white/80 hover:bg-white/95 text-error hover:text-error-hover transition-colors"
              >
                Reset positions
              </button>
            )}
          </div>
        } />
      )}

      {/* Gradient metric selector (replaces text metrics when grid receivers used) */}
      {hasGridReceivers && perReceiverMetrics ? (
        <div className="card-stack--md">
          <h3 className="text-xs font-semibold" style={{ color: 'var(--color-on-blue)' }}>
            Acoustic Metrics
          </h3>
          {/* Metric dropdown */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] shrink-0" style={{ color: 'var(--color-on-blue-muted)' }}>Metric</span>
            <CardSelect
              value={selectedMetric ?? ''}
              onChange={(v) => setSelectedMetric((v || null) as GradientMetric | null)}
              compact
              className="flex-1"
              placeholder="— select —"
              options={METRICS.map((m) => ({
                value: m.key,
                label: `${m.label} (${m.unit})`,
              }))}
            />
          </div>

          {/* Gradient legend */}
          {selectedMetric && legendRange && (
            <div className="card-stack--tight">
              <div
                className="h-3.5 w-full rounded"
                style={{ background: GradientMapManager.CSS_GRADIENT }}
              />
              <div className="flex items-end justify-between gap-1">
                {/* Min input */}
                <NumberField
                  value={parseFloat(displayMin.toFixed(2))}
                  step="any"
                  containerStyle={{ width: '64px' }}
                  onChange={(v) => setUserMin(v)}
                  onBlueBackground
                />

                <span className="text-[9px] pb-0.5" style={{ color: 'var(--color-on-blue-muted)' }}>
                  {METRICS.find((m) => m.key === selectedMetric)?.label}
                </span>

                {/* Max input */}
                <NumberField
                  value={parseFloat(displayMax.toFixed(2))}
                  step="any"
                  containerStyle={{ width: '64px' }}
                  onChange={(v) => setUserMax(v)}
                  onBlueBackground
                />
              </div>
            </div>
          )}
        </div>
      ) : hasGridReceivers ? (
        metricsLoading ? <MetricsLoading /> : null
      ) : metricsLoading ? (
        <MetricsLoading />
      ) : (
        acousticParams && <AcousticMetricsPanel params={acousticParams} />
      )}

      {lowEnergyIRIds.size > 0 && (
        <Notice type="error" message={
          lowEnergyIRIds.size === 1
            ? '1 impulse response has very low energy and may produce poor auralization.'
            : `${lowEnergyIRIds.size} impulse responses have very low energy and may produce poor auralization.`
        } />
      )}

      {/* IR Library */}
      <ImpulseResponseUpload
        onClearIR={onClearIR}
        simulationResults={results}
        refreshTrigger={irRefreshTrigger}
        simulationIRIds={simulationConfig.importedIRIds}
        sourceReceiverIRMapping={sourceReceiverIRMapping}
        onIRHover={onIRHover}
        onLowEnergyIdsChange={handleLowEnergyIdsChange}
        sourceDisplayNames={sourceDisplayNames}
        receiverDisplayNames={receiverDisplayNames}
        simulationSourcePositions={simulationSourcePositions}
        currentSoundPositions={currentSoundPositions}
        receiverGroups={receiverGroups}
        onGoToReceiver={onGoToReceiver}
        fpsExitTrigger={fpsExitTrigger}
        forcedActiveGroupId={forcedActiveGroupId}
        pairDefinitions={pairDefinitions}
        availableSourceCount={availableSourceCount}
        availableReceiverCount={availableReceiverCount}
        allowPairUploads={allowPairUploads}
        onPairIRUploaded={onPairIRUploaded}
        onPairAssignmentCleared={onPairAssignmentCleared}
        singleIRPerListener={singleIRPerListener}
        onListenerIRUploaded={onListenerIRUploaded}
        onListenerAssignmentCleared={onListenerAssignmentCleared}
      />
    </div>
  );
}
