/**
 * SimulationResultContent Component
 *
 * Renders the results of a simulation (metrics and IR upload) for Choras and Pyroomacoustics cards.
 * Displayed in the `afterContent` slot of the card after completion.
 *
 * When grid receivers are detected in sourceReceiverIRMapping, the text metrics block
 * is replaced by a gradient-map metric selector (RT60 / EDT / D50 / C50) + color legend.
 *
 * Also exports SimulationSettingsSection — a collapsible, read-only text summary of the
 * simulation settings used (Simulation Mode, Rays, Air Absorption, …).
 */

'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { ImpulseResponseUpload } from '@/components/audio/ImpulseResponseUpload';
import type { SimulationConfig, ChorasSimulationConfig, PyroomAcousticsSimulationConfig } from '@/types/acoustics';
import type { ImpulseResponseMetadata, SourceReceiverIRMapping } from '@/types/audio';
import type { GradientMetric } from '@/store/uiStore';
import { useUIStore } from '@/store/uiStore';
import { useGridListenersStore } from '@/store';
import { fetchPerReceiverMetrics, type PerReceiverMetrics } from '@/utils/acousticMetrics';
import { GradientMapManager } from '@/lib/three/gradient-map-manager';
import { SIMULATION_POSITION_THRESHOLD } from '@/utils/constants';

// ─── Metric metadata ──────────────────────────────────────────────────────────

const METRICS: Array<{ key: GradientMetric; label: string; unit: string; format: (v: number) => string }> = [
  { key: 'rt60', label: 'RT60', unit: 's',  format: (v) => `${v.toFixed(2)}s`  },
  { key: 'edt',  label: 'EDT',  unit: 's',  format: (v) => `${v.toFixed(2)}s`  },
  { key: 'd50',  label: 'D50',  unit: '%',  format: (v) => `${(v*100).toFixed(0)}%` },
  { key: 'c50',  label: 'C50',  unit: 'dB', format: (v) => `${v.toFixed(1)}dB` },
  { key: 'spl',  label: 'SPL',  unit: 'dB', format: (v) => `${v.toFixed(1)}dB` },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
  /** Current positions of sound sources (for simulation-position drift detection) */
  currentSourcePositions?: Record<string, [number, number, number]>;
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
  currentSourcePositions,
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
}: SimulationResultContentProps) {
  const simulationConfig = config as any;
  const results: string | null = simulationConfig.simulationResults;
  const sourceReceiverIRMapping: SourceReceiverIRMapping | undefined = simulationConfig.sourceReceiverIRMapping;
  const simulationId: string | undefined = simulationConfig.currentSimulationId;
  const simType: 'pyroomacoustics' | 'choras' | undefined =
    config.type === 'pyroomacoustics' || config.type === 'choras' ? config.type : undefined;

  const [lowEnergyIRIds, setLowEnergyIRIds] = useState<Set<string>>(new Set());
  const handleLowEnergyIdsChange = useCallback((ids: Set<string>) => setLowEnergyIRIds(ids), []);

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
    } | undefined;
    if (!simPositions) return empty;

    const names: string[] = [];
    const sourceIds: string[] = [];
    const receiverIds: string[] = [];

    if (currentSourcePositions) {
      for (const [id, simPos] of Object.entries(simPositions.sources)) {
        const cur = currentSourcePositions[id];
        if (!cur) continue;
        const dist = Math.hypot(simPos[0] - cur[0], simPos[1] - cur[1], simPos[2] - cur[2]);
        if (dist > SIMULATION_POSITION_THRESHOLD) {
          names.push(sourceDisplayNames?.[id] || id);
          sourceIds.push(id);
        }
      }
    }

    if (currentReceiverPositions) {
      for (const [id, simPos] of Object.entries(simPositions.receivers)) {
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
  }, [isExpanded, simulationConfig, currentSourcePositions, currentReceiverPositions, sourceDisplayNames, receiverDisplayNames]);

  const mismatchedNames = mismatchInfo.names;

  // ── Gradient map state ──────────────────────────────────────────────────
  const setActiveGradientMap = useUIStore((s) => s.setActiveGradientMap);
  const gridListeners = useGridListenersStore((s) => s.gridListeners);

  const hasGridReceivers = useMemo(() => detectGridReceivers(sourceReceiverIRMapping), [sourceReceiverIRMapping]);

  const [perReceiverMetrics, setPerReceiverMetrics] = useState<PerReceiverMetrics | null>(null);
  const selectedMetric = controlledMetric;
  const setSelectedMetric = onMetricChange ?? (() => {});

  // User-editable range — initialised from data, reset when metric/data changes
  const [userMin, setUserMin] = useState<number | null>(null);
  const [userMax, setUserMax] = useState<number | null>(null);
  const prevMetricRef = useRef<string | null>(null);

  // Fetch per-receiver metrics once when grid receivers are present and we have a simulationId
  useEffect(() => {
    if (!hasGridReceivers || !simulationId || !simType) return;
    fetchPerReceiverMetrics(simulationId, simType).then((m) => {
      if (Object.keys(m).length > 0) setPerReceiverMetrics(m);
    });
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
    <div className="space-y-3">
      {/* Position mismatch warning */}
      {isExpanded && mismatchedNames.length > 0 && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-error/10 border border-error/40 text-error text-xs">
          <span className="font-bold shrink-0 mt-0.5">⚠</span>
          <div className="flex-1 flex flex-col gap-1.5">
            <span>
              <strong>{mismatchedNames.join(', ')}</strong>{' '}
              {mismatchedNames.length === 1 ? 'is' : 'are'} not at simulation position — results may not match the current layout.
            </span>
            {onResetPositions && (
              <button
                onClick={() => onResetPositions(mismatchInfo.sourceIds, mismatchInfo.receiverIds)}
                className="self-start px-2 py-0.5 rounded border border-error/40 bg-error/10 hover:bg-error/20 text-error hover:text-error-hover transition-colors"
              >
                Reset positions
              </button>
            )}
          </div>
        </div>
      )}

      {/* Gradient metric selector (replaces text metrics when grid receivers used) */}
      {hasGridReceivers && perReceiverMetrics ? (
        <div className="space-y-2">
          {/* Metric dropdown */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-neutral-400 shrink-0">Acoustic Metric</span>
            <select
              value={selectedMetric ?? ''}
              onChange={(e) => setSelectedMetric((e.target.value || null) as GradientMetric | null)}
              className="flex-1 text-[11px] bg-neutral-800 text-white border border-neutral-600 rounded px-2 py-1 outline-none focus:border-info cursor-pointer"
            >
              <option value="">— select —</option>
              {METRICS.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label} ({m.unit})
                </option>
              ))}
            </select>
          </div>

          {/* Gradient legend */}
          {selectedMetric && legendRange && (
            <div className="space-y-1">
              <div
                className="h-3.5 w-full rounded"
                style={{ background: GradientMapManager.CSS_GRADIENT }}
              />
              <div className="flex items-end justify-between gap-1">
                {/* Min input */}
                <div className="flex flex-col gap-0" style={{ width: '64px' }}>
                  <input
                    type="number"
                    step="any"
                    value={parseFloat(displayMin.toFixed(2))}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      if (!isNaN(v)) setUserMin(v);
                    }}
                    className="w-full text-[10px] text-center rounded px-1 py-0.5 outline-none bg-foreground text-background text-center"
                    style={{ borderBottom: '1px solid var(--color-info)55' }}
                  />
                </div>

                <span className="text-[9px] text-neutral-500 pb-0.5">
                  {METRICS.find((m) => m.key === selectedMetric)?.label}
                </span>

                {/* Max input */}
                <div className="flex flex-col gap-0" style={{ width: '64px' }}>
                  <input
                    type="number"
                    step="any"
                    value={parseFloat(displayMax.toFixed(2))}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      if (!isNaN(v)) setUserMax(v);
                    }}
                    className="w-full text-[10px] text-center rounded px-1 py-0.5 outline-none bg-foreground text-background text-center"
                    style={{ borderBottom: '1px solid var(--color-info)55' }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Text metrics block (no grid receivers) */
        results && (
          <div className="bg-slate-800 text-white p-3 rounded text-xs overflow-x-auto">
            <pre className="whitespace-pre-wrap font-sans text-xs">{results}</pre>
          </div>
        )
      )}

      {/* Low-energy IR warning */}
      {lowEnergyIRIds.size > 0 && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-error/10 border border-error/40 text-error text-xs">
          <span className="font-bold shrink-0">!</span>
          <span>
            {lowEnergyIRIds.size === 1
              ? '1 impulse response has very low energy and may produce poor auralization.'
              : `${lowEnergyIRIds.size} impulse responses have very low energy and may produce poor auralization.`}
          </span>
        </div>
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
      />
    </div>
  );
}

// =============================================================================
// SimulationSettingsSection
// =============================================================================

interface SettingRowProps { label: string; value: string }
function SettingRow({ label, value }: SettingRowProps) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-neutral-500 shrink-0">{label}</span>
      <span className="text-neutral-300 text-right">{value}</span>
    </div>
  );
}

interface SimulationSettingsSectionProps { config: SimulationConfig }

export function SimulationSettingsSection({ config }: SimulationSettingsSectionProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const rows: { label: string; value: string }[] = [];

  if (config.type === 'pyroomacoustics') {
    const s = (config as PyroomAcousticsSimulationConfig).settings;
    rows.push({ label: 'Simulation Mode', value: s.simulation_mode === 'foa' ? 'FOA' : 'Mono' });
    rows.push({ label: 'Rays', value: s.n_rays.toLocaleString() });
    rows.push({ label: 'Ray Tracing', value: s.ray_tracing ? 'Yes' : 'No' });
    rows.push({ label: 'Air Absorption', value: s.air_absorption ? 'Yes' : 'No' });
    rows.push({ label: 'Max Order (ISM)', value: String(s.max_order) });
    if (s.enable_grid) rows.push({ label: 'Grid Receivers', value: 'Yes' });
  } else if (config.type === 'choras' && 'simulation_method' in config.settings) {
    const s = (config as ChorasSimulationConfig).settings;
    rows.push({ label: 'Method', value: s.simulation_method });
    if (s.simulation_method === 'DE') {
      // no DE-specific display rows
    } else {
      rows.push({ label: 'Freq. Upper Limit', value: `${s.dg_freq_upper_limit} Hz` });
      rows.push({ label: 'Polynomial Order', value: String(s.dg_poly_order) });
      rows.push({ label: 'Points per Wavelength', value: String(s.dg_ppw) });
      rows.push({ label: 'CFL', value: String(s.dg_cfl) });
    }
  }

  if (rows.length === 0) return null;

  return (
    <div className="mt-3">
      <button
        onClick={() => setIsExpanded((v) => !v)}
        className="flex items-center gap-1.5 w-full text-left text-xs text-secondary-light hover:text-neutral-300 transition-colors"
      >
        {isExpanded ? <ChevronDown size={11} className="shrink-0" /> : <ChevronRight size={11} className="shrink-0" />}
        <span>Simulation Settings</span>
      </button>
      {isExpanded && (
        <div className="mt-2 space-y-1 text-xs">
          {rows.map(({ label, value }) => (
            <SettingRow key={label} label={label} value={value} />
          ))}
        </div>
      )}
    </div>
  );
}
