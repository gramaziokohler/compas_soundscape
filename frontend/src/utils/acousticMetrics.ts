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
  c80?: number | null;
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
      c80: calculateAverage(allParams, 'c80'),
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
  includeC80: boolean = false
): string {
  if (!params) return '';
  
  const metrics: string[] = [];
  
  if (params.rt60 !== null) metrics.push(`RT60: ${params.rt60.toFixed(2)}s`);
  if (params.edt !== null) metrics.push(`EDT: ${params.edt.toFixed(2)}s`);
  if (params.d50 !== null) metrics.push(`D50: ${(params.d50 * 100).toFixed(1)}%`);
  if (params.c50 !== null) metrics.push(`C50: ${params.c50.toFixed(1)} dB`);
  if (includeC80 && params.c80 !== null && params.c80 !== undefined) metrics.push(`C80: ${params.c80.toFixed(1)} dB`);
  
  if (metrics.length === 0) return '';
  
  return `Acoustic Metrics:\n${metrics.join(', ')}\n`;
}

/**
 * Import all IR files from a Pyroomacoustics simulation to the library
 * 
 * @param simulationId - The simulation ID
 * @param irFiles - Array of IR filenames to import
 * @returns Import result with all metadata and mappings
 */
export async function importPyroomIRFiles(
  simulationId: string,
  irFiles: string[]
): Promise<IRImportResult> {
  const importedIRMetadataList: ImpulseResponseMetadata[] = [];
  const sourceReceiverMapping: SourceReceiverIRMapping = {};
  let source_Id = 'source_1'; // Placeholder source ID
  let source_count = 0;
  let receiver_Id = 'receiver_1'; // Placeholder receiver ID
  let receiver_count = 0;
  
  for (const irFilename of irFiles) {
    try {
      // Fetch the IR file blob
      const blob = await apiService.getPyroomacousticsIRFile(simulationId, irFilename);
      const file = new File([blob], irFilename, { type: 'audio/wav' });
      
      // Extract source and receiver IDs from filename
      // Format: sim_{simulation_id}_src_{source_id}_rcv_{receiver_id}.wav
      const match = irFilename.match(/src_(.+?)_rcv_(.+?)\.wav$/);
      const sourceId = match ? match[1] : 'unknown';
      if (source_Id !== match[1]) {
        source_count++;
        source_Id = match[1];
      }
 
      const receiverId = match ? match[2] : 'unknown';
      if (receiver_Id !== match[2]) {
        receiver_count++;
        receiver_Id = match[2];
      }
      
      // Build IR name - just source-receiver pair for clarity
    //   const irName = `S:${sourceId} R:${receiverId}`;
      const irName = `Source${source_count}_Receiver${receiver_count}`;
      
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
  resultsText += formatAcousticMetrics(metrics, false);
  
  return resultsText;
}
