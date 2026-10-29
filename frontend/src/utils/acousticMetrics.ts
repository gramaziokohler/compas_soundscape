/**
 * Acoustic Metrics Utility
 * 
 * Shared utilities for fetching and formatting acoustic simulation results.
 * Used by both AcousticsSection and usePyroomAcousticsSimulation.
 */

import { apiService, simulationResultsJsonUrl } from '@/services/api';
import type { ImpulseResponseMetadata, SourceReceiverIRMapping } from '@/types/audio';

/**
 * Acoustic parameters from simulation results
 */
export interface AcousticParameters {
  rt60: number | null;
  edt: number | null;
  d50: number | null;
  c50: number | null;
  spl?: number | null;
  drr?: number | null;
  /** RT60/EDT measured over an adequate decay range (backend *_reliable) */
  rt60Reliable?: boolean;
  edtReliable?: boolean;
  /** Pure ISM simulation (no ray-traced diffuse tail) — RT60 is an estimate */
  rt60IsEstimate?: boolean;
  /** spl is a relative energy level, not physical SPL (pyroomacoustics path) */
  splIsRelative?: boolean;
}

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
 * Average the scalar per-pair `acoustic_parameters` of a results JSON
 * (pyroomacoustics and PFFDTD share the same measurement method).
 */
function aggregateScalarMetrics(results: unknown): AcousticParameters | null {
  if (!Array.isArray(results) || results.length === 0) return null;
  return aggregateParamList(results.filter((r: any) => r.acoustic_parameters).map((r: any) => r.acoustic_parameters));
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
    rt60: calculateAverage(allParams, 'rt60'),
    edt: calculateAverage(allParams, 'edt'),
    d50: calculateAverage(allParams, 'd50'),
    c50: calculateAverage(allParams, 'c50'),
    spl: calculateAverage(allParams, 'spl'),
    drr: calculateAverage(allParams, 'drr'),
    rt60Reliable: allReliable('rt60'),
    edtReliable: allReliable('edt'),
    rt60IsEstimate: allParams.some((p: any) => p.rt60_is_estimate === true),
    splIsRelative: true,
  };
}

/**
 * Fetch acoustic metrics from Pyroomacoustics simulation results
 * 
 * @param simulationId - The simulation ID to fetch results for
 * @returns Acoustic parameters or null if fetch fails
 */
export async function fetchPyroomAcousticMetrics(simulationId: string): Promise<AcousticParameters | null> {
  try {
    const jsonResponse = await fetch(simulationResultsJsonUrl(simulationId, 'pyroomacoustics'));
    
    if (!jsonResponse.ok) {
      console.error('[acousticMetrics] Failed to fetch JSON, status:', jsonResponse.status);
      return null;
    }
    
    const jsonData = await jsonResponse.json();
    return aggregateScalarMetrics(jsonData.results);
  } catch (error) {
    console.error('[acousticMetrics] Failed to fetch acoustic metrics:', error);
    return null;
  }
}

/**
 * Aggregate acoustic metrics from a source-receiver IR mapping (import-irs card).
 *
 * Each assigned IR carries `acoustic_parameters` measured at upload time by the
 * backend with the same method as the pyroomacoustics cards. This averages those
 * per-pair parameters exactly like `fetchPyroomAcousticMetrics` averages a
 * simulation's per-pair results. Returns null when no IR has metrics.
 */
export function buildAcousticMetricsFromIRMapping(
  mapping: SourceReceiverIRMapping | undefined,
): AcousticParameters | null {
  const allParams: any[] = [];
  for (const receiverMap of Object.values(mapping || {})) {
    for (const meta of Object.values(receiverMap)) {
      const params = (meta as any)?.acoustic_parameters ?? (meta as any)?.acousticParameters;
      if (params) allParams.push(params);
    }
  }

  if (allParams.length === 0) return null;

  const contributing = (key: string) =>
    allParams.filter((p: any) => typeof p[key] === 'number' && !isNaN(p[key]));
  const allReliable = (key: string) =>
    contributing(key).length > 0 &&
    contributing(key).every((p: any) => p[`${key}_reliable`] === undefined || p[`${key}_reliable`] === true);

  return {
    rt60: calculateAverage(allParams, 'rt60'),
    edt: calculateAverage(allParams, 'edt'),
    d50: calculateAverage(allParams, 'd50'),
    c50: calculateAverage(allParams, 'c50'),
    spl: calculateAverage(allParams, 'spl'),
    drr: calculateAverage(allParams, 'drr'),
    rt60Reliable: allReliable('rt60'),
    edtReliable: allReliable('edt'),
    rt60IsEstimate: allParams.some((p: any) => p.rt60_is_estimate === true),
    splIsRelative: true,
  };
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

  if (params.rt60 !== null) {
    metrics.push(`RT60: ${params.rt60.toFixed(2)}s`);
  }
  if (params.edt !== null) metrics.push(`EDT: ${params.edt.toFixed(2)}s`);
  if (params.d50 !== null) metrics.push(`D50: ${(params.d50 * 100).toFixed(1)}%`);
  if (params.c50 !== null) metrics.push(`C50: ${params.c50.toFixed(1)} dB`);
  if (params.spl !== null && params.spl !== undefined) {
    metrics.push(
      params.splIsRelative
        ? `Energy: ${params.spl.toFixed(1)} dB (relative)`
        : `SPL: ${params.spl.toFixed(1)} dB`,
    );
  }

  if (metrics.length === 0) return '';

  // Warnings are emitted as a separate "Note:" section (rendered in warning
  // color and smaller type by the card) — never inline in the metric line.
  const warnings: string[] = [];
  if (params.rt60 !== null && params.rt60IsEstimate) {
    warnings.push('RT60 is an estimate: ISM-only simulation, no ray-traced diffuse tail');
  }
  if (params.rt60 !== null && params.rt60Reliable === false) {
    warnings.push('RT60 is unreliable (low measured decay range)');
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
 * @returns Import result with all metadata and mappings
 */
export async function importPyroomIRFiles(
  simulationId: string,
  irFiles: string[],
  fetchIRFile?: (simId: string, filename: string) => Promise<Blob>,
  sourceDisplayNames?: Record<string, string>,
  receiverDisplayNames?: Record<string, string>,
): Promise<IRImportResult> {
  const importedIRMetadataList: ImpulseResponseMetadata[] = [];
  const sourceReceiverMapping: SourceReceiverIRMapping = {};

  const _fetchIR = fetchIRFile ?? ((simId, fn) => apiService.getPyroomacousticsIRFile(simId, fn));

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
      const irMetadata = await apiService.uploadImpulseResponse(file, irName);
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
 * @returns Complete formatted results string
 */
export async function buildSimulationResultsText(
  simulationId: string,
): Promise<string> {
  let resultsText = '';

  // Fetch and format acoustic metrics
  const metrics = await fetchPyroomAcousticMetrics(simulationId);
  resultsText += formatAcousticMetrics(metrics);

  return resultsText;
}

// ─── Per-receiver metrics (for gradient map) ─────────────────────────────────

export interface PerReceiverMetrics {
  [receiverId: string]: Partial<AcousticParameters>;
}

/**
 * Fetch per-receiver acoustic metrics from a simulation results JSON.
 * Values are averaged across all sources that share the same receiver.
 */
export async function fetchPerReceiverMetrics(
  simulationId: string,
  type: 'pyroomacoustics' | 'pffdtd',
): Promise<PerReceiverMetrics> {
  try {
    const response = await fetch(simulationResultsJsonUrl(simulationId, type));
    if (!response.ok) return {};
    const data = await response.json();
    if (!data.results || !Array.isArray(data.results)) return {};

    // Accumulate per-receiver metric samples (averaged across sources)
    const sums: Record<string, { rt60: number[]; edt: number[]; d50: number[]; c50: number[]; spl: number[] }> = {};

    for (const result of data.results) {
      const receiverId: string = result.receiver_id;
      const params = result.acoustic_parameters;
      if (!receiverId || !params) continue;

      if (!sums[receiverId]) sums[receiverId] = { rt60: [], edt: [], d50: [], c50: [], spl: [] };

      const extract = (key: string): number | null => {
        const v = params[key];
        return typeof v === 'number' && !isNaN(v) ? v : null;
      };

      const rt60 = extract('rt60'); if (rt60 !== null) sums[receiverId].rt60.push(rt60);
      const edt  = extract('edt');  if (edt  !== null) sums[receiverId].edt.push(edt);
      const d50  = extract('d50');  if (d50  !== null) sums[receiverId].d50.push(d50);
      const c50  = extract('c50');  if (c50  !== null) sums[receiverId].c50.push(c50);
      const spl  = extract('spl');  if (spl  !== null) sums[receiverId].spl.push(spl);
    }

    const avg = (arr: number[]) =>
      arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

    const out: PerReceiverMetrics = {};
    for (const [receiverId, s] of Object.entries(sums)) {
      out[receiverId] = { rt60: avg(s.rt60), edt: avg(s.edt), d50: avg(s.d50), c50: avg(s.c50), spl: avg(s.spl) };
    }
    return out;
  } catch {
    return {};
  }
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
  );
}

/** Aggregate acoustic metrics of a wave-based simulation (same per-pair shape as pyroomacoustics). */
export async function fetchPffdtdAcousticMetrics(simulationId: string): Promise<AcousticParameters | null> {
  try {
    const data = await apiService.getPffdtdResults(simulationId);
    return data ? aggregateScalarMetrics(data.results) : null;
  } catch {
    return null;
  }
}

/** Per-pair metrics of a run's results JSON, keyed by `pairMetricsKey(source_id, receiver_id)`. */
export type PairMetrics = Record<string, Record<string, number | boolean | null>>;

export const pairMetricsKey = (sourceId: string, receiverId: string) => `${sourceId}::${receiverId}`;

/** Fetch a wave-based run's per-pair metrics once; free-positioning updates then need no refetch. */
export async function fetchPffdtdPairMetrics(simulationId: string): Promise<PairMetrics | null> {
  try {
    const data = await apiService.getPffdtdResults(simulationId);
    if (!data) return null;
    const out: PairMetrics = {};
    for (const r of data.results) {
      if (r.acoustic_parameters) out[pairMetricsKey(r.source_id, r.receiver_id)] = r.acoustic_parameters;
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Aggregate metrics of the IRs a card currently plays: each mapped pair uses the
 * parameters measured for its IR (a free-positioning IR carries its own) and falls back
 * to the run's per-pair result. O(pairs), so it can follow every move.
 */
export function aggregateMappedPairMetrics(
  mapping: SourceReceiverIRMapping | undefined,
  base: PairMetrics | null,
): AcousticParameters | null {
  const params: unknown[] = [];
  for (const [sourceId, receivers] of Object.entries(mapping ?? {})) {
    for (const [receiverId, meta] of Object.entries(receivers)) {
      const p = meta.acoustic_parameters ?? meta.acousticParameters ?? base?.[pairMetricsKey(sourceId, receiverId)];
      if (p) params.push(p);
    }
  }
  return aggregateParamList(params);
}

/** Build simulation results text for a wave-based simulation. */
export async function buildPffdtdSimulationResultsText(simulationId: string): Promise<string> {
  return formatAcousticMetrics(await fetchPffdtdAcousticMetrics(simulationId));
}
