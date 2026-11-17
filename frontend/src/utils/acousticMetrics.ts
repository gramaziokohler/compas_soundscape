/**
 * Acoustic Metrics Utility
 * 
 * Shared utilities for fetching and formatting acoustic simulation results.
 * Used by both AcousticsSection and usePyroomAcousticsSimulation.
 */

import { apiService, simulationResultsJsonUrl } from '@/services/api';
import type { ImpulseResponseMetadata, IRAcousticParameters, IRMetricBlocks, SourceReceiverIRMapping } from '@/types/audio';
import { isLowEnergyIR } from '@/utils/irEnergy';

/**
 * Acoustic parameters of a card: the mean over its source-listener pairs of each pair's ISO 3382-1
 * single numbers (the 500 Hz - 1 kHz mean of the same per-band analysis the band table shows).
 */
export interface AcousticParameters {
  t30: number | null;
  edt: number | null;
  c50: number | null;
  c80: number | null;
  /** 0-1 */
  d50: number | null;
  sti: number | null;
  /** T30 / EDT decay long and straight enough at 500 Hz and 1 kHz in every pair (backend *_reliable) */
  t30Reliable?: boolean;
  edtReliable?: boolean;
  /** Image-source-only simulation (no ray-traced diffuse tail): the decay times are an estimate */
  t30IsEstimate?: boolean;
}

/** The single-number keys a card averages (and the gradient map can show). */
export const ACOUSTIC_PARAMETER_KEYS = ['t30', 'edt', 'c50', 'c80', 'd50', 'sti'] as const;
export type AcousticParameterKey = (typeof ACOUSTIC_PARAMETER_KEYS)[number];

/**
 * Result of importing IRs from a simulation
 */
export interface IRImportResult {
  importedCount: number;
  totalCount: number;
  importedIRIds: string[];
  importedIRMetadataList: ImpulseResponseMetadata[];
  sourceReceiverMapping: SourceReceiverIRMapping;
}

/**
 * Calculate average of values for a given key from acoustic parameters array
 */
function calculateAverage(allParams: any[], key: string): number | null {
  const values = allParams
    .map((p: any) => p[key])
    .filter((v: any) => v !== undefined && !isNaN(v));
  return values.length > 0 
    ? values.reduce((a: number, b: number) => a + b, 0) / values.length 
    : null;
}

/**
 * True when the IR a card plays for this source-listener pair is tagged "Low energy"
 * (same check as the IR list badge). Such pairs are left out of every averaged metric.
 */
function isLowEnergyPair(
  mapping: SourceReceiverIRMapping | undefined,
  sourceId: string,
  receiverId: string,
): boolean {
  return isLowEnergyIR(mapping?.[sourceId]?.[receiverId]);
}

/**
 * Average the scalar per-pair `acoustic_parameters` of a results JSON
 * (pyroomacoustics and PFFDTD share the same measurement method), skipping
 * the pairs whose imported IR is tagged low energy in `mapping`.
 */
function aggregateScalarMetrics(results: unknown, mapping?: SourceReceiverIRMapping): AcousticParameters | null {
  if (!Array.isArray(results) || results.length === 0) return null;
  return aggregateParamList(
    results
      .filter((r: any) => r.acoustic_parameters && !isLowEnergyPair(mapping, r.source_id, r.receiver_id))
      .map((r: any) => r.acoustic_parameters),
  );
}

/** Average a list of per-pair acoustic parameters (null when empty). */
function aggregateParamList(allParams: any[]): AcousticParameters | null {
  if (allParams.length === 0) return null;

  // A pair contributes to the average only when its metric is a real number.
  const contributing = (key: string) => allParams.filter((p: any) => typeof p[key] === 'number' && !isNaN(p[key]));
  // Reliability: true when every contributing pair measured an adequate decay
  // range (missing backend flag on legacy data is treated as reliable).
  const allReliable = (key: string) =>
    contributing(key).length > 0 &&
    contributing(key).every((p: any) => p[`${key}_reliable`] === undefined || p[`${key}_reliable`] === true);

  return {
    t30: calculateAverage(allParams, 't30'),
    edt: calculateAverage(allParams, 'edt'),
    c50: calculateAverage(allParams, 'c50'),
    c80: calculateAverage(allParams, 'c80'),
    d50: calculateAverage(allParams, 'd50'),
    sti: calculateAverage(allParams, 'sti'),
    t30Reliable: allReliable('t30'),
    edtReliable: allReliable('edt'),
    t30IsEstimate: allParams.some((p: any) => p.t30_is_estimate === true),
  };
}

/**
 * Fetch acoustic metrics from Pyroomacoustics simulation results
 * 
 * @param simulationId - The simulation ID to fetch results for
 * @param mapping - The card's imported IRs; pairs tagged low energy are skipped
 * @returns Acoustic parameters or null if fetch fails
 */
export async function fetchPyroomAcousticMetrics(
  simulationId: string,
  mapping?: SourceReceiverIRMapping,
): Promise<AcousticParameters | null> {
  try {
    const jsonResponse = await fetch(simulationResultsJsonUrl(simulationId, 'pyroomacoustics'));
    
    if (!jsonResponse.ok) {
      console.error('[acousticMetrics] Failed to fetch JSON, status:', jsonResponse.status);
      return null;
    }
    
    const jsonData = await jsonResponse.json();
    return aggregateScalarMetrics(jsonData.results, mapping);
  } catch (error) {
    console.error('[acousticMetrics] Failed to fetch acoustic metrics:', error);
    return null;
  }
}

/** The acoustic parameters of one IR (its own measurement, no averaging); null without any. */
export function acousticParametersOfIR(params: IRAcousticParameters | null | undefined): AcousticParameters | null {
  return params ? aggregateParamList([params]) : null;
}

/**
 * Format acoustic parameters into a display string
 * 
 * @param params - Acoustic parameters to format
 * @param includeC80 - Whether to include C80 in output (default: false)
 * @returns Formatted string with acoustic metrics
 */
export function formatAcousticMetrics(
  params: AcousticParameters | null,
): string {
  if (!params) return '';

  const metrics: string[] = [];

  if (params.t30 !== null) metrics.push(`T30: ${params.t30.toFixed(2)}s`);
  if (params.edt !== null) metrics.push(`EDT: ${params.edt.toFixed(2)}s`);
  if (params.c50 !== null) metrics.push(`C50: ${params.c50.toFixed(1)} dB`);
  if (params.c80 !== null) metrics.push(`C80: ${params.c80.toFixed(1)} dB`);
  if (params.d50 !== null) metrics.push(`D50: ${(params.d50 * 100).toFixed(1)}%`);
  if (params.sti !== null) metrics.push(`STI: ${params.sti.toFixed(2)}`);

  if (metrics.length === 0) return '';

  // Warnings are emitted as a separate "Note:" section (rendered in warning
  // color and smaller type by the card) — never inline in the metric line.
  const warnings: string[] = [];
  if (params.t30 !== null && params.t30IsEstimate) {
    warnings.push('T30 is an estimate: ISM-only simulation, no ray-traced diffuse tail');
  }
  if (params.t30 !== null && params.t30Reliable === false) {
    warnings.push('T30 is unreliable (decay too short or bent at 500 Hz - 1 kHz)');
  }
  if (params.edt !== null && params.edtReliable === false) {
    warnings.push('EDT is unreliable (low measured decay range)');
  }

  let out = `Acoustic Metrics:\n${metrics.join(', ')}\n`;
  if (warnings.length > 0) {
    out += `\nNote:\n${warnings.map((w) => `\u2022 ${w}`).join('\n')}\n`;
  }
  return out;
}

/**
 * Import all IR files from a Pyroomacoustics simulation to the library
 *
 * @param simulationId - The simulation ID
 * @param irFiles - Array of IR filenames to import
 * @param fetchIRFile - Optional override for fetching each WAV blob.
 *   Defaults to ``apiService.getPyroomacousticsIRFile`` (backward-compatible).
 * @param sourceDisplayNames - Optional map from sourceId to human-readable display name.
 * @param receiverDisplayNames - Optional map from receiverId to human-readable name.
 * @param resultsType - Which results JSON holds the run's per-pair metrics.
 * @returns Import result with all metadata and mappings
 */
export async function importPyroomIRFiles(
  simulationId: string,
  irFiles: string[],
  fetchIRFile?: (simId: string, filename: string) => Promise<Blob>,
  sourceDisplayNames?: Record<string, string>,
  receiverDisplayNames?: Record<string, string>,
  resultsType: 'pyroomacoustics' | 'pffdtd' = 'pyroomacoustics',
): Promise<IRImportResult> {
  const importedIRMetadataList: ImpulseResponseMetadata[] = [];
  const sourceReceiverMapping: SourceReceiverIRMapping = {};

  const _fetchIR = fetchIRFile ?? ((simId, fn) => apiService.getPyroomacousticsIRFile(simId, fn));
  // The run measured each pair on its untrimmed response: the library keeps those metrics
  // instead of measuring the exported (trimmed) WAV again.
  const runMetrics = await fetchPairMetricBlocks(simulationId, resultsType);

  for (const irFilename of irFiles) {
    try {
      // Fetch the IR file blob
      const blob = await _fetchIR(simulationId, irFilename);
      const file = new File([blob], irFilename, { type: 'audio/wav' });
      
      // Extract source and receiver IDs from filename
      // Format: sim_{simulation_id}_src_{source_id}_rcv_{receiver_id}.wav
      const match = irFilename.match(/src_(.+?)_rcv_(.+?)\.wav$/);
      const sourceId = match ? match[1] : 'unknown';
      const receiverId = match ? match[2] : 'unknown';

      // Build IR name using display names when available, falling back to raw IDs
      const sourceName = sourceDisplayNames?.[sourceId] ?? sourceId;
      const receiverName = receiverDisplayNames?.[receiverId] ?? receiverId;
      const irName = `${sourceName} – ${receiverName}`;
      
      // Upload to IR library
      const irMetadata = await apiService.uploadImpulseResponse(
        file, irName, runMetrics[pairMetricsKey(sourceId, receiverId)],
      );
      importedIRMetadataList.push(irMetadata);
      
      // Build source-receiver mapping
      if (!sourceReceiverMapping[sourceId]) {
        sourceReceiverMapping[sourceId] = {};
      }
      sourceReceiverMapping[sourceId][receiverId] = irMetadata;
      
      console.log(`✓ Imported IR: ${irName} (source: ${sourceId}, receiver: ${receiverId})`);
    } catch (error) {
      console.error(`Failed to import IR ${irFilename}:`, error);
    }
  }
  
  return {
    importedCount: importedIRMetadataList.length,
    totalCount: irFiles.length,
    importedIRIds: importedIRMetadataList.map(m => m.id),
    importedIRMetadataList,
    sourceReceiverMapping
  };
}

/**
 * Build complete simulation results text
 *
 * @param simulationId - The simulation ID to fetch metrics for
 * @param mapping - The run's imported IRs; pairs tagged low energy are skipped
 * @returns Complete formatted results string
 */
export async function buildSimulationResultsText(
  simulationId: string,
  mapping?: SourceReceiverIRMapping,
): Promise<string> {
  let resultsText = '';

  // Fetch and format acoustic metrics
  const metrics = await fetchPyroomAcousticMetrics(simulationId, mapping);
  resultsText += formatAcousticMetrics(metrics);

  return resultsText;
}

// ─── Per-receiver metrics (for gradient map) ─────────────────────────────────

export interface PerReceiverMetrics {
  [receiverId: string]: Partial<AcousticParameters>;
}

/**
 * Per-receiver acoustic metrics of a run's per-pair results (`metricBlocksByPair`), averaged
 * across all sources that share the same receiver, skipping pairs whose imported IR is tagged
 * low energy in `mapping`. Null when no receiver has metrics.
 */
export function perReceiverMetricsOf(
  pairs: Record<string, IRMetricBlocks>,
  mapping?: SourceReceiverIRMapping,
): PerReceiverMetrics | null {
  // Accumulate per-receiver metric samples (averaged across sources)
  const sums: Record<string, Record<AcousticParameterKey, number[]>> = {};

  for (const [key, blocks] of Object.entries(pairs)) {
    const [sourceId, receiverId] = key.split('::');
    const params = blocks.acoustic_parameters;
    if (!receiverId || !params) continue;
    if (isLowEnergyPair(mapping, sourceId, receiverId)) continue;

    const s = (sums[receiverId] ??= Object.fromEntries(
      ACOUSTIC_PARAMETER_KEYS.map((k) => [k, [] as number[]]),
    ) as Record<AcousticParameterKey, number[]>);
    for (const k of ACOUSTIC_PARAMETER_KEYS) {
      const v = params[k];
      if (typeof v === 'number' && !isNaN(v)) s[k].push(v);
    }
  }

  const avg = (arr: number[]) =>
    arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

  const out: PerReceiverMetrics = {};
  for (const [receiverId, s] of Object.entries(sums)) {
    out[receiverId] = Object.fromEntries(
      ACOUSTIC_PARAMETER_KEYS.map((k) => [k, avg(s[k])]),
    ) as Partial<AcousticParameters>;
  }
  return Object.keys(out).length > 0 ? out : null;
}

// ─── PFFDTD (wave-based) helpers ───────────────────────────────────────────────

/**
 * Import all IR files from a wave-based (PFFDTD) simulation to the library.
 * Thin wrapper over ``importPyroomIRFiles`` using the PFFDTD file endpoint.
 */
export async function importPffdtdIRFiles(
  simulationId: string,
  irFiles: string[],
  sourceDisplayNames?: Record<string, string>,
  receiverDisplayNames?: Record<string, string>,
): Promise<IRImportResult> {
  return importPyroomIRFiles(
    simulationId,
    irFiles,
    (simId, fn) => apiService.getPffdtdIRFile(simId, fn),
    sourceDisplayNames,
    receiverDisplayNames,
    'pffdtd',
  );
}

/**
 * The metric blocks of every pair of a run's results JSON, keyed by `pairMetricsKey`
 * (empty when the JSON cannot be read: the upload then measures each IR itself).
 */
async function fetchPairMetricBlocks(
  simulationId: string,
  type: 'pyroomacoustics' | 'pffdtd',
): Promise<Record<string, IRMetricBlocks>> {
  try {
    const response = await fetch(simulationResultsJsonUrl(simulationId, type));
    if (!response.ok) return {};
    const data: { results?: Array<IRMetricBlocks & { source_id?: string; receiver_id?: string }> } = await response.json();
    const out: Record<string, IRMetricBlocks> = {};
    for (const r of data.results ?? []) {
      if (r.source_id == null || r.receiver_id == null || !r.acoustic_parameters) continue;
      out[pairMetricsKey(String(r.source_id), String(r.receiver_id))] = {
        acoustic_parameters: r.acoustic_parameters,
        acoustic_parameters_bands: r.acoustic_parameters_bands ?? null,
      };
    }
    return out;
  } catch {
    return {};
  }
}

/** Aggregate acoustic metrics of a wave-based simulation (same per-pair shape as pyroomacoustics). */
export async function fetchPffdtdAcousticMetrics(
  simulationId: string,
  mapping?: SourceReceiverIRMapping,
): Promise<AcousticParameters | null> {
  try {
    const data = await apiService.getPffdtdResults(simulationId);
    return data ? aggregateScalarMetrics(data.results, mapping) : null;
  } catch {
    return null;
  }
}

export const pairMetricsKey = (sourceId: string, receiverId: string) => `${sourceId}::${receiverId}`;

/**
 * Aggregate metrics of the IRs a card currently plays: each mapped pair uses the
 * parameters measured for its IR (a free-positioning or imported IR carries its own) and falls
 * back to the run's per-pair result (`metricBlocksByPair`). IRs tagged low energy are skipped.
 * Without a mapping, the run's pairs are averaged. O(pairs), so it can follow every move.
 */
export function aggregateMappedPairMetrics(
  mapping: SourceReceiverIRMapping | undefined,
  base: Record<string, IRMetricBlocks> | null | undefined,
): AcousticParameters | null {
  const pairs = Object.entries(mapping ?? {});
  if (pairs.length === 0) {
    return aggregateParamList(Object.values(base ?? {}).map((b) => b.acoustic_parameters).filter(Boolean));
  }
  const params: unknown[] = [];
  for (const [sourceId, receivers] of pairs) {
    for (const [receiverId, meta] of Object.entries(receivers)) {
      if (isLowEnergyIR(meta)) continue;
      const p = meta.acoustic_parameters ?? meta.acousticParameters
        ?? base?.[pairMetricsKey(sourceId, receiverId)]?.acoustic_parameters;
      if (p) params.push(p);
    }
  }
  return aggregateParamList(params);
}

/** Build simulation results text for a wave-based simulation (low-energy IRs in `mapping` skipped). */
export async function buildPffdtdSimulationResultsText(
  simulationId: string,
  mapping?: SourceReceiverIRMapping,
): Promise<string> {
  return formatAcousticMetrics(await fetchPffdtdAcousticMetrics(simulationId, mapping));
}
