/**
 * Run flow of a hybrid (wave below the crossover, rays above) simulation card.
 *
 * Same shape as runPffdtdSimulation: submit → record the in-flight job → poll the unified job →
 * import the IRs → write the completed patch. The job runs on the wave solver's queue and its
 * results are written and served like wave-based ones (pffdtd_* files), so the in-flight job is
 * tracked as a 'pffdtd' job and recovered by the same code after a refresh.
 */

import { apiService } from '@/services/api';
import { useUIStore } from '@/store/uiStore';
import { recordInflightJob, removeInflightJob } from '@/lib/job-tracker';
import { logSimulationResult } from '@/lib/study/simulationEvents';
import { importPffdtdIRFiles, buildPffdtdSimulationResultsText } from '@/utils/acousticMetrics';
import { captureGenerationSignature } from '@/utils/generationSignature';
import { SIMULATION_STATUS_MISS_TOLERANCE, PFFDTD } from '@/utils/constants';
import { simulationSourceSnapshot, type SimulationGeometryRequest } from '@/utils/simulationRequest';
import { hybridResultLine } from '@/lib/acoustics/hybrid';
import type { GridListenerSnapshot, HybridSimulationConfig, SimulationConfig } from '@/types/acoustics';

export interface RunHybridSimulationDeps {
  index: number;
  config: HybridSimulationConfig;
  request: SimulationGeometryRequest;
  update: (index: number, updates: Partial<SimulationConfig>) => void;
  pollIntervals: Map<number, ReturnType<typeof setInterval>>;
  receivers: Array<{ id: string; position: [number, number, number] }>;
  gridListenerSnapshot: GridListenerSnapshot[];
  onIRImported?: () => void;
}

type HybridPatch = Partial<HybridSimulationConfig>;

export async function runHybridSimulation(deps: RunHybridSimulationDeps): Promise<void> {
  const { index, config, request, pollIntervals, receivers, gridListenerSnapshot, onIRImported } = deps;
  const update = (patch: HybridPatch) => deps.update(index, patch as Partial<SimulationConfig>);
  const runSignature = captureGenerationSignature(config);
  const { versionId } = request;

  update({ isRunning: true, progress: 0, status: 'Submitting...', error: null });

  let jobId: string;
  try {
    ({ job_id: jobId } = await apiService.runHybridSimulationSpeckle(
      request,
      config.display_name || 'Simulation',
      config.settings,
      useUIStore.getState().globalSoundSpeed,
      useUIStore.getState().simulationMeshSettings,
    ));
  } catch (e) {
    update({ isRunning: false, error: e instanceof Error ? e.message : 'Failed' });
    return;
  }

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
      update({ progress: st.progress, status: statusStr });
      if (!st.completed && !st.cancelled && !st.error) return; // keep polling

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

      update({ status: 'Importing impulse responses...' });
      const irImportResult = await importPffdtdIRFiles(result.simulation_id, result.ir_files);
      logSimulationResult(index, 'hybrid', result.simulation_id, irImportResult);
      if (irImportResult.importedCount === 0) {
        update({ isRunning: false, error: 'Simulation completed but failed to import impulse responses.', currentSimulationRunId: null });
        return;
      }

      const hybridInfo = result.hybrid ?? null;
      const metricsText = await buildPffdtdSimulationResultsText(result.simulation_id);
      update({
        importedIRMetadata: irImportResult.importedIRMetadataList[0],
        isRunning: false,
        status: 'Complete!',
        progress: 100,
        state: 'completed',
        completedAt: Date.now(),
        ...runSignature,
        simulatedVersionId: versionId,
        simulationResults: `${hybridResultLine(hybridInfo)}\n${metricsText}`,
        hybridInfo,
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
