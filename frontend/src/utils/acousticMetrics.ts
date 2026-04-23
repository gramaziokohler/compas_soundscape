/**
 * Acoustic Metrics Utility
 * 
 * Shared utilities for fetching and formatting acoustic simulation results.
 * Used by both AcousticsSection and usePyroomAcousticsSimulation.
 */

import { apiService } from '@/services/api';
import type { ImpulseResponseMetadata, SourceReceiverIRMapping } from '@/types/audio';

// API base URL constant
const API_BASE_URL = 'http://localhost:8000';

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
 * Fetch acoustic metrics from Pyroomacoustics simulation results
 * 
 * @param simulationId - The simulation ID to fetch results for
 * @returns Acoustic parameters or null if fetch fails
 */
export async function fetchPyroomAcousticMetrics(simulationId: string): Promise<AcousticParameters | null> {
  try {
    const jsonResponse = await fetch(
      `${API_BASE_URL}/pyroomacoustics/get-result-file/${simulationId}/json`
    );
    
    if (!jsonResponse.ok) {
      console.error('[acousticMetrics] Failed to fetch JSON, status:', jsonResponse.status);
      return null;
    }
    
    const jsonData = await jsonResponse.json();
    
    if (!jsonData.results || !Array.isArray(jsonData.results) || jsonData.results.length === 0) {
      return null;
    }
    
    // Calculate average acoustic parameters across all source-receiver pairs
    const allParams = jsonData.results
      .filter((r: any) => r.acoustic_parameters)
      .map((r: any) => r.acoustic_parameters);
    
    if (allParams.length === 0) {
      return null;
    }
    
    console.log('[acousticMetrics] Acoustic parameters found:', allParams);
    
    return {
      rt60: calculateAverage(allParams, 'rt60'),
      edt: calculateAverage(allParams, 'edt'),
      d50: calculateAverage(allParams, 'd50'),
      c50: calculateAverage(allParams, 'c50'),
      spl: calculateAverage(allParams, 'spl'),
      drr: calculateAverage(allParams, 'drr')
    };
  } catch (error) {
    console.error('[acousticMetrics] Failed to fetch acoustic metrics:', error);
    return null;
  }
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

  if (params.rt60 !== null) metrics.push(`RT60: ${params.rt60.toFixed(2)}s`);
  if (params.edt !== null) metrics.push(`EDT: ${params.edt.toFixed(2)}s`);
  if (params.d50 !== null) metrics.push(`D50: ${(params.d50 * 100).toFixed(1)}%`);
  if (params.c50 !== null) metrics.push(`C50: ${params.c50.toFixed(1)} dB`);
  if (params.spl !== null && params.spl !== undefined) metrics.push(`SPL: ${params.spl.toFixed(1)} dB`);

  if (metrics.length === 0) return '';

  return `Acoustic Metrics:\n${metrics.join(', ')}\n`;
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
  type: 'pyroomacoustics' | 'choras',
): Promise<PerReceiverMetrics> {
  try {
    const url =
      type === 'choras'
        ? `${API_BASE_URL}/choras/get-result-file/${simulationId}/json`
        : `${API_BASE_URL}/pyroomacoustics/get-result-file/${simulationId}/json`;

    const response = await fetch(url);
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

      // Handle both scalar values (Pyroom) and per-frequency arrays (Choras)
      const extract = (key: string): number | null => {
        const v = params[key];
        if (Array.isArray(v) && v.length > 0) return typeof v[0] === 'number' ? v[0] : null;
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

// ─── Choras (DE/DG) helpers ─────────────────────────────────────────────────

/**
 * Import all IR files from a Choras simulation to the library.
 * Thin wrapper over ``importPyroomIRFiles`` using the Choras file endpoint.
 */
export async function importChorasIRFiles(
  simulationId: string,
  irFiles: string[],
  sourceDisplayNames?: Record<string, string>,
  receiverDisplayNames?: Record<string, string>,
): Promise<IRImportResult> {
  return importPyroomIRFiles(
    simulationId,
    irFiles,
    (simId, fn) => apiService.getChorasIRFile(simId, fn),
    sourceDisplayNames,
    receiverDisplayNames,
  );
}

/**
 * Fetch acoustic metrics from a Choras DE simulation results JSON.
 *
 * DE results contain per-frequency arrays (t20, t30, c80, d50) rather than
 * scalar values; we use the average across frequency bands for display.
 */
export async function fetchChorasAcousticMetrics(
  simulationId: string,
): Promise<AcousticParameters | null> {
  try {
    const response = await fetch(
      `${API_BASE_URL}/choras/get-result-file/${simulationId}/json`,
    );
    if (!response.ok) return null;

    const data = await response.json();
    if (!data.results || data.results.length === 0) return null;

    // Average acoustic parameters across all source-receiver pairs
    const allParams = data.results
      .filter((r: any) => r.acoustic_parameters)
      .map((r: any) => r.acoustic_parameters);

    if (allParams.length === 0) return null;

    /** Average the first element of each per-frequency array, or null if absent */
    const avgFirst = (key: string): number | null => {
      const values = allParams
        .map((p: any) => {
          const v = p[key];
          return Array.isArray(v) && v.length > 0 ? v[0] : typeof v === 'number' ? v : null;
        })
        .filter((v: any) => v !== null && !isNaN(v));
      return values.length > 0
        ? (values as number[]).reduce((a, b) => a + b, 0) / values.length
        : null;
    };

    return {
      rt60: avgFirst('rt60'),
      edt:  avgFirst('edt'),
      d50:  avgFirst('d50'),
      c50:  avgFirst('c50'),
      spl:  avgFirst('spl'),
      drr:  avgFirst('drr'),
    };
  } catch {
    return null;
  }
}

/**
 * Build simulation results text for a Choras simulation.
 */
export async function buildChorasSimulationResultsText(
  simulationId: string,
  _irImportResult: IRImportResult,
): Promise<string> {
  const metrics = await fetchChorasAcousticMetrics(simulationId);
  return formatAcousticMetrics(metrics);
}
