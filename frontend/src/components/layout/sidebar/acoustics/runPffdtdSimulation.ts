/**
 * Run flow of a wave-based (PFFDTD) simulation card.
 *
 * The pyroomacoustics flow as a plain function: submit → record the in-flight
 * job (refresh recovery) → poll the unified job → import the IRs → write the
 * completed patch. Field data (SPL map / animation) is not loaded here; the
 * results view fetches it lazily from the results JSON.
 */

import { apiService } from '@/services/api';
import { useUIStore } from '@/store/uiStore';
import { recordInflightJob, removeInflightJob } from '@/lib/job-tracker';
import { logSimulationResult } from '@/lib/study/simulationEvents';
import { importPffdtdIRFiles, buildPffdtdSimulationResultsText } from '@/utils/acousticMetrics';
import { captureGenerationSignature } from '@/utils/generationSignature';
import { SIMULATION_STATUS_MISS_TOLERANCE, PFFDTD } from '@/utils/constants';
import { simulationSourceSnapshot, type SimulationGeometryRequest } from '@/utils/simulationRequest';
import type { GridListenerSnapshot, PffdtdSimulationConfig, SimulationConfig } from '@/types/acoustics';

export interface RunPffdtdSimulationDeps {
  index: number;
  config: PffdtdSimulationConfig;
  request: SimulationGeometryRequest;
  /** Store update of the card at `index`. */
  update: (index: number, updates: Partial<SimulationConfig>) => void;
  /** Per-card poll timers owned by AcousticsSection (cleared on cancel / unmount). */
  pollIntervals: Map<number, ReturnType<typeof setInterval>>;
  /** Receivers simulated (positions snapshot on completion). */
  receivers: Array<{ id: string; position: [number, number, number] }>;
  gridListenerSnapshot: GridListenerSnapshot[];
  onIRImported?: () => void;
}

type PffdtdPatch = Partial<PffdtdSimulationConfig>;

export async function runPffdtdSimulation(deps: RunPffdtdSimulationDeps): Promise<void> {
  const { index, config, request, pollIntervals, receivers, gridListenerSnapshot, onIRImported } = deps;
  const update = (patch: PffdtdPatch) => deps.update(index, patch as Partial<SimulationConfig>);
  // Inputs this run is made of — stored on completion as the Regenerate baseline.
  const runSignature = captureGenerationSignature(config);
  const { versionId } = request;

  update({ isRunning: true, progress: 0, status: 'Submitting...', error: null, runVoxelised: false, runProblems: undefined });

  let jobId: string;
  try {
    ({ job_id: jobId } = await apiService.runPffdtdSimulationSpeckle(
      request,
      config.display_name || 'Simulation',
      config.settings,
      useUIStore.getState().simulationMeshSettings,
    ));
  } catch (e) {
    update({ isRunning: false, error: e instanceof Error ? e.message : 'Failed' });
    return;
  }

  // Store the running job id so the cancel handler and recovery can reach it.
  update({ currentSimulationRunId: jobId });
  recordInflightJob(jobId, 'pffdtd', { configId: config.id, instanceId: config.simulationInstanceId, versionId });

  const stop = () => {
    const timer = pollIntervals.get(index);
    if (timer) clearInterval(timer);
    pollIntervals.delete(index);
    removeInflightJob(jobId);
  };

  let statusMisses = 0;
  const pollInterval = setInterval(async () => {
    try {
      let st;
      try {
        st = await apiService.getPffdtdSimulationStatus(jobId);
        statusMisses = 0;
      } catch (statusErr) {
        if (++statusMisses < SIMULATION_STATUS_MISS_TOLERANCE) return; // transient (e.g. API restart)
        throw statusErr;
      }

      const statusStr = st.queue_position != null
        ? `Queued — position ${st.queue_position} of ${st.queue_total}`
        : st.status;
      update({
        progress: st.progress,
        status: statusStr,
        runVoxelised: st.partial?.voxelised === true,
        // grid problems arrive with the voxelisation and stay with the result
        ...(st.partial?.problems ? { runProblems: st.partial.problems } : {}),
      });
      if (!st.completed && !st.cancelled && !st.error) return; // keep polling

      // ── Terminal states ──────────────────────────────────────────────
      stop();
      if (st.cancelled) {
        update({ isRunning: false, progress: 0, status: 'Cancelled', currentSimulationRunId: null });
        return;
      }
      if (st.error) {
        update({ isRunning: false, status: 'Error', error: st.error, currentSimulationRunId: null });
        return;
      }
      const result = st.result;
      if (!result?.ir_files?.length) {
        update({ isRunning: false, error: 'Simulation completed but generated no impulse responses.', currentSimulationRunId: null });
        return;
      }

      // ── Import IRs + build results text ──────────────────────────────
      update({ status: 'Importing impulse responses...' });
      const irImportResult = await importPffdtdIRFiles(result.simulation_id, result.ir_files);
      logSimulationResult(index, 'pffdtd', result.simulation_id, irImportResult);
      if (irImportResult.importedCount === 0) {
        update({ isRunning: false, error: 'Simulation completed but failed to import impulse responses.', currentSimulationRunId: null });
        return;
      }

      const resultsText = await buildPffdtdSimulationResultsText(result.simulation_id);
      update({
        importedIRMetadata: irImportResult.importedIRMetadataList[0],
        isRunning: false,
        status: 'Complete!',
        progress: 100,
        state: 'completed',
        completedAt: Date.now(),
        ...runSignature,
        // Geometry this result was simulated on (drives the outdated check).
        simulatedVersionId: versionId,
        simulationResults: resultsText,
        importedIRIds: irImportResult.importedIRIds,
        sourceReceiverIRMapping: irImportResult.sourceReceiverMapping,
        currentSimulationRunId: null,
        currentSimulationId: result.simulation_id,
        simulationPositions: {
          ...simulationSourceSnapshot(request),
          receivers: Object.fromEntries(receivers.map((r) => [r.id, r.position])),
          gridListeners: gridListenerSnapshot,
        },
      });
      onIRImported?.();
    } catch (pollErr) {
      stop();
      update({
        isRunning: false,
        status: 'Error',
        error: pollErr instanceof Error ? pollErr.message : 'Status check failed',
        currentSimulationRunId: null,
      });
    }
  }, PFFDTD.STATUS_POLL_INTERVAL_MS);

  pollIntervals.set(index, pollInterval);
}
