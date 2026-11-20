/**
 * SimulationResultContent Component
 *
 * Renders the results of a simulation (metrics and IR upload) for Pyroomacoustics and PFFDTD cards.
 * Displayed in the `afterContent` slot of the card after completion.
 *
 * When grid receivers are detected in sourceReceiverIRMapping, the text metrics block
 * is replaced by a gradient-map metric selector (RT60 / EDT / D50 / C50) + color legend.
 */

'use client';

import { useCanEdit } from '@/hooks/useCanEdit';
import { useState, useEffect, useMemo, useRef } from 'react';
import { ImpulseResponseUpload } from '@/components/audio/ImpulseResponseUpload';
import type { SimulationConfig } from '@/types/acoustics';
import { ACOUSTIC_METRICS, AcousticMetricsTable, acousticMetricMeta } from './AcousticMetricsTable';
import { aggregateMappedBandMetrics, metricBlocksByPair, withBandHeadline } from '@/lib/acoustics/band-metrics';
import { runResultsEngine, useRunResults } from '@/hooks/useRunResults';
import { hybridRunSummary } from '@/lib/acoustics/hybrid';
import type { ImpulseResponseMetadata, SourceReceiverIRMapping } from '@/types/audio';
import { Notice } from '@/components/ui/Notice';
import { Spinner } from '@/components/ui/Spinner';
import { CardSelect } from '@/components/ui/CardSelect';
import { NumberField } from '@/components/ui/NumberField';
import type { GradientMetric } from '@/store/uiStore';
import { useUIStore } from '@/store/uiStore';
import { useGridListenersStore, usePffdtdFreeStore } from '@/store';
import { aggregateMappedPairMetrics, perReceiverMetricsOf } from '@/utils/acousticMetrics';
import { PffdtdFieldResults } from './PffdtdFieldResults';
import { PffdtdFreePositioningResults } from './PffdtdFreePositioningResults';
import { Badge } from '@/components/ui/Badge';
import { GradientMapManager } from '@/lib/three/gradient-map-manager';
import { SIMULATION_POSITION_THRESHOLD } from '@/utils/constants';
import { directivityKeySuffix, positionKeyBase } from '@/utils/positionKey';
import { useSoundscapeStore } from '@/store/soundscapeStore';

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
  /** True when the card renders as a solid generated (blue) card — drives on-blue tokens. */
  onBlueBackground?: boolean;
  /** Linear IR peak-offset (-1..1) applied to the IR previews. */
  irGain?: number;
  /** Whether IR previews peak-normalize to 1.0 (matches the audio normalize toggle). */
  irNormalizeEnabled?: boolean;
  /** Reports each IR's peak amplitude upward (used by the import-irs gain slider). */
  onIRPeaksChange?: (peaks: Record<string, number>) => void;
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
  onBlueBackground = false,
  irGain = 0,
  irNormalizeEnabled = false,
  onIRPeaksChange,
}: SimulationResultContentProps) {
  const canEdit = useCanEdit();
  const simulationConfig = config as any;

  const sourceReceiverIRMapping: SourceReceiverIRMapping | undefined = simulationConfig.sourceReceiverIRMapping;
  const simulationId: string | undefined = simulationConfig.currentSimulationId;
  const simType = runResultsEngine(config.type);
  // Wave-based IRs carry no content above the grid's max frequency.
  const bandLimitHz = config.type === 'pffdtd' ? config.settings.fmax : null;
  // Import-irs cards carry per-IR metrics in their mapping — no simulation to fetch.
  const isImportIrs = config.type === 'import-irs';
  const simulationSourcePositions = (simulationConfig.simulationPositions as {
    sources?: Record<string, [number, number, number]>;
  } | undefined)?.sources;

  const gridListeners = useGridListenersStore((s) => s.gridListeners);
  // Current directivities: a changed pattern / orientation outdates the IR like a move.
  const liveSounds = useSoundscapeStore((s) => s.soundscapeData);
  // Free-source runs start at the listeners: no per-source field outputs to show.
  const freeSourceRun = usePffdtdFreeStore((s) => (simulationId ? s.grids[simulationId]?.block?.mode === 'source' : false));
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
        // Every variant of a card is mapped (one shared source): list the card once.
        const pushName = (name: string) => { if (!names.includes(name)) names.push(name); };
        if (dist > SIMULATION_POSITION_THRESHOLD) {
          pushName(currentSoundNames?.[soundId] || soundId);
          sourceIds.push(soundId);
          continue;
        }
        const liveDirectivity = liveSounds?.find((s) => s.id === soundId)?.directivity;
        if (directivityKeySuffix(liveDirectivity) !== simPosKey.slice(positionKeyBase(simPosKey).length)) {
          pushName(`${currentSoundNames?.[soundId] || soundId} (directivity changed)`);
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
  }, [isExpanded, simulationConfig, currentSoundPositions, currentSoundNames, currentReceiverPositions, receiverDisplayNames, gridListeners, liveSounds]);

  const mismatchedNames = mismatchInfo.names;

  // ── Gradient map state ──────────────────────────────────────────────────
  const setActiveGradientMap = useUIStore((s) => s.setActiveGradientMap);

  const hasGridReceivers = useMemo(() => detectGridReceivers(sourceReceiverIRMapping), [sourceReceiverIRMapping]);
  // Import-irs cards show the aggregate metrics table only (no per-listener gradient).
  const canUseGrid = hasGridReceivers && !isImportIrs;

  // A metric key saved by an older version (e.g. 'rt60') reads as no selection
  const selectedMetric = acousticMetricMeta(controlledMetric) ? controlledMetric : null;
  const setSelectedMetric = onMetricChange ?? (() => {});

  // User-editable range — initialised from data, reset when metric/data changes
  const [userMin, setUserMin] = useState<number | null>(null);
  const [userMax, setUserMax] = useState<number | null>(null);
  const prevMetricRef = useRef<string | null>(null);

  // The run's per-pair results, fetched once: the single numbers, band rows, grid gradient map and
  // each IR preview's fallback (IRs imported before their metadata kept metrics) all derive from
  // it, and re-aggregate locally when the mapping changes (free-positioning moves, imported IRs).
  const runResults = useRunResults(simulationId, simType);
  const metricsLoading = !!simulationId && !!simType && runResults === undefined;
  const runPairMetrics = useMemo(() => metricBlocksByPair(runResults), [runResults]);

  const perReceiverMetrics = useMemo(
    () => (canUseGrid ? perReceiverMetricsOf(runPairMetrics, sourceReceiverIRMapping) : null),
    [canUseGrid, runPairMetrics, sourceReceiverIRMapping],
  );
  // Band rows of the metrics table (undefined while loading, null without any), averaged over the
  // IRs the card plays; its single numbers are read off them so both always agree.
  const bandMetrics = useMemo(
    () => (canUseGrid || runResults === undefined
      ? undefined
      : aggregateMappedBandMetrics(sourceReceiverIRMapping, runResults ?? undefined)),
    [canUseGrid, runResults, sourceReceiverIRMapping],
  );
  const shownParams = useMemo(
    () => (canUseGrid ? null : withBandHeadline(aggregateMappedPairMetrics(sourceReceiverIRMapping, runPairMetrics), bandMetrics)),
    [canUseGrid, sourceReceiverIRMapping, runPairMetrics, bandMetrics],
  );

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
    if (!acousticMetricMeta(selectedMetric)) return null;
    return { min: minVal, max: maxVal };
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
            {onResetPositions && canEdit && (
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
      {canUseGrid && perReceiverMetrics ? (
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
              options={ACOUSTIC_METRICS.map((m) => ({
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
                  {acousticMetricMeta(selectedMetric)?.label}
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
      ) : canUseGrid ? (
        metricsLoading ? <MetricsLoading /> : null
      ) : metricsLoading ? (
        <MetricsLoading />
      ) : (
        <AcousticMetricsTable params={shownParams} bands={bandMetrics} showPairCount />
      )}

      {config.type === 'hybrid' && config.hybridInfo && (
        <p className="text-[11px]" style={{ color: 'var(--color-on-blue-muted)' }}>
          {hybridRunSummary(config.hybridInfo)}
        </p>
      )}

      {bandLimitHz !== null && (
        <div className="flex">
          <Badge
            variant="neutral"
            onBlueBackground={onBlueBackground}
            title="The wave solver resolves frequencies up to the grid's max frequency only"
          >
            band-limited to {bandLimitHz} Hz
          </Badge>
        </div>
      )}

      {/* Wave-based field plane: SPL map + pressure-wave animation (their files
          are not served to the share view) */}
      {config.type === 'pffdtd' && simulationId && isExpanded && canEdit && (
        <PffdtdFreePositioningResults configId={config.id} simulationId={simulationId} />
      )}
      {config.type === 'pffdtd' && simulationId && isExpanded && canEdit && !freeSourceRun && (
        <PffdtdFieldResults
          configId={config.id}
          simulationId={simulationId}
          sourceDisplayNames={sourceDisplayNames}
          onBlueBackground={onBlueBackground}
        />
      )}

      {/* IR Library — uploads / assignments are edits (and need an identity):
          the share view only lists the card's IRs. */}
      <ImpulseResponseUpload
        onClearIR={onClearIR}
        refreshTrigger={irRefreshTrigger}
        onBlueBackground={onBlueBackground}
        simulationIRIds={simulationConfig.importedIRIds}
        sourceReceiverIRMapping={sourceReceiverIRMapping}
        runPairMetrics={runPairMetrics}
        onIRHover={onIRHover}
        sourceDisplayNames={sourceDisplayNames}
        receiverDisplayNames={receiverDisplayNames}
        simulationSourcePositions={simulationSourcePositions}
        currentSoundPositions={currentSoundPositions}
        receiverGroups={receiverGroups}
        onGoToReceiver={onGoToReceiver}
        fpsExitTrigger={fpsExitTrigger}
        forcedActiveGroupId={forcedActiveGroupId}
        pairDefinitions={canEdit ? pairDefinitions : undefined}
        availableSourceCount={availableSourceCount}
        availableReceiverCount={availableReceiverCount}
        allowPairUploads={canEdit && allowPairUploads}
        onPairIRUploaded={canEdit ? onPairIRUploaded : undefined}
        onPairAssignmentCleared={canEdit ? onPairAssignmentCleared : undefined}
        singleIRPerListener={singleIRPerListener}
        onListenerIRUploaded={canEdit ? onListenerIRUploaded : undefined}
        onListenerAssignmentCleared={canEdit ? onListenerAssignmentCleared : undefined}
        irGain={irGain}
        irNormalizeEnabled={irNormalizeEnabled}
        onIRPeaksChange={onIRPeaksChange}
      />
    </div>
  );
}
