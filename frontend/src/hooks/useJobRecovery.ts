'use client';

import { useEffect, useRef, useState } from 'react';
import { apiService } from '@/services/api';
import { getStoredJobs, removeInflightJob } from '@/lib/job-tracker';
import {
  useSoundscapeStore,
  beginSoundGeneration,
  endSoundGeneration,
  applyRecoveredOrchestrateResult,
  resumeOrchestrateJob,
} from '@/store/soundscapeStore';
import { useSEDStore } from '@/store/sedStore';
import { useAnalysisStore, applyRecoveredLlmResult, resumeLlmJob } from '@/store/analysisStore';
import { useAcousticsSimulationStore } from '@/store/acousticsSimulationStore';
import { useReceiversStore } from '@/store/receiversStore';
import { useGridListenersStore } from '@/store/gridListenersStore';
import { useAudioControlsStore } from '@/store/audioControlsStore';
import { collapseVariantsToOne, groupSoundsByPosition } from '@/utils/positionKey';
import { isFreshHomeUrl } from '@/utils/homeStage';
import {
  importPyroomIRFiles,
  importChorasIRFiles,
  buildSimulationResultsText,
  buildChorasSimulationResultsText,
} from '@/utils/acousticMetrics';
import type { JobType, JobRecord } from '@/types';
import type { PyroomAcousticsSimulationConfig } from '@/types/acoustics';

const POLL_INTERVAL_MS = 1500;

/** Matches the backend `JOB_RESULT_TTL_S` (3600 s). */
const MAX_AGE_MS = 60 * 60 * 1000;

function isJobLikelyStillAlive(record: JobRecord): boolean {
  return Date.now() - record.timestamp < MAX_AGE_MS;
}

/**
 * Find the acoustics simulation card a job belongs to. Prefers the stable
 * `configId` recorded at submission; falls back to the persisted run id
 * (`currentSimulationRunId`) and finally the completed simulation id — so both
 * local records and backend-discovered jobs reattach after a window close.
 */
function findAcousticsConfigIndex(jobId: string, simulationId: string, record: JobRecord): number {
  const { simulationConfigs } = useAcousticsSimulationStore.getState();
  if (simulationConfigs.length === 0) return -1;

  const configId = record.meta?.configId;
  if (configId) {
    const byId = simulationConfigs.findIndex((c) => c.id === configId);
    if (byId >= 0) return byId;
  }

  const byRunId = simulationConfigs.findIndex(
    (c) => (c as { currentSimulationRunId?: string | null }).currentSimulationRunId === jobId,
  );
  if (byRunId >= 0) return byRunId;

  return simulationConfigs.findIndex((c) => {
    const sid = (c as { currentSimulationId?: string | null }).currentSimulationId;
    return sid != null && (sid === simulationId || sid === jobId);
  });
}

/**
 * Wait (briefly) for the matching simulation card to exist. On a cold reload
 * the soundscape restore and this recovery run concurrently, so the card may
 * not be in the store yet even though its persisted `currentSimulationRunId`
 * will bring it back a moment later.
 */
async function waitForAcousticsConfigIndex(
  jobId: string,
  simulationId: string,
  record: JobRecord,
  timeoutMs = 8000,
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  let index = findAcousticsConfigIndex(jobId, simulationId, record);
  while (index < 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    index = findAcousticsConfigIndex(jobId, simulationId, record);
  }
  return index;
}

/**
 * Rebuild the simulation-time source/receiver position snapshot from the live
 * stores (used by recovery, mirroring what the run path captures on completion).
 * Returns undefined when no placed sounds/receivers are available yet.
 */
function buildRecoveredSimulationPositions(): PyroomAcousticsSimulationConfig['simulationPositions'] | undefined {
  const soundscapeData = useSoundscapeStore.getState().soundscapeData;
  if (!soundscapeData || soundscapeData.length === 0) return undefined;

  const sourceSounds = collapseVariantsToOne(
    soundscapeData as Array<{ id: string; position: [number, number, number]; prompt_index?: number; copy_index?: number }>,
    useAudioControlsStore.getState().selectedVariants,
  );
  const { uniquePositions, soundToPosKey } = groupSoundsByPosition(sourceSounds);
  if (uniquePositions.size === 0) return undefined;

  const receivers = useReceiversStore.getState().receivers;
  const gridListeners = useGridListenersStore.getState().gridListeners;

  return {
    sources: Object.fromEntries(uniquePositions.entries()),
    receivers: Object.fromEntries(receivers.map((r) => [r.id, r.position])),
    soundToPosKey: Object.fromEntries(soundToPosKey.entries()),
    gridListeners: gridListeners
      .filter((g) => !g.hiddenForSimulation)
      .map((g) => ({
        id: g.id,
        name: g.name,
        xSpacing: g.xSpacing,
        ySpacing: g.ySpacing,
        zOffset: g.zOffset,
        selectedObjectIds: g.selectedObjectIds,
        boundingBox: g.boundingBox,
        points: g.points,
      })),
  };
}

/**
 * Reads in-flight job records — from `localStorage` (survives a window close)
 * unioned with the backend's per-workspace job listing (survives cleared local
 * storage / another device) — checks their current status, and either processes
 * the result (if completed) or resumes polling (if still running).
 *
 * Returns `{ hasInflightJobs, recoveryResolved }`. `recoveryResolved` flips true
 * once the (async) backend listing has been consulted, so callers can defer
 * destructive cleanup until discovery completes.
 */
export function useJobRecovery(): { hasInflightJobs: boolean; recoveryResolved: boolean; recoveredSomething: boolean } {
  const recoveredRef = useRef(false);
  const [recoveryResolved, setRecoveryResolved] = useState(false);
  const [remoteJobCount, setRemoteJobCount] = useState(0);
  const [recoveredSomething, setRecoveredSomething] = useState(false);

  useEffect(() => {
    if (recoveredRef.current) return;
    recoveredRef.current = true;

    // The fresh Home stage starts empty by design and has no save target, so a
    // recovered result (the backend lists finished jobs too, for an hour) would
    // land there as unsaved work. Leave the local records untouched — the jobs
    // reattach when their model/project is reopened.
    if (isFreshHomeUrl()) {
      setRecoveryResolved(true);
      return;
    }

    void (async () => {
      try {
        const local = getStoredJobs();

        // Backend listing: catches jobs whose local record was cleared or that
        // were started on another device signed into the same workspace.
        const remote = await apiService.getActiveJobs();
        const known = new Set(local.map((j) => j.jobId));
        const remoteRecords: JobRecord[] = remote
          .filter((j) => !known.has(j.jobId))
          .map((j) => ({ jobId: j.jobId, jobType: j.jobType, timestamp: Date.now() }));
        setRemoteJobCount(remoteRecords.length);

        const records = [...local, ...remoteRecords].filter(isJobLikelyStillAlive);
        if (records.length === 0) return;
        setRecoveredSomething(true);

        console.log('[useJobRecovery] Recovering', records.length, 'job(s)...');
        for (const record of records) {
          await recoverJob(record);
        }
      } catch (err) {
        console.log('[useJobRecovery] Discovery failed', err);
      } finally {
        setRecoveryResolved(true);
      }
    })();
  }, []);

  return {
    hasInflightJobs: getStoredJobs().length > 0 || remoteJobCount > 0,
    recoveryResolved,
    recoveredSomething,
  };
}

function recoverLlmJob(record: JobRecord, status: Awaited<ReturnType<typeof apiService.getJobStatus>>): void {
  const { jobId } = record;
  const kind = record.meta?.kind;
  const configIndex = record.meta?.configIndex;
  const scenarioId = record.meta?.scenarioId;

  if (status.cancelled || status.error) {
    removeInflightJob(jobId);
    if (kind !== 'orchestrate') {
      useAnalysisStore.setState({
        isAnalyzing: false,
        analysisStatus: '',
        analysisProgress: 0,
        analyzingConfigIndex: null,
      });
    }
    return;
  }

  if (status.completed) {
    if (kind === 'orchestrate') {
      applyRecoveredOrchestrateResult(status.result, scenarioId);
    } else if (configIndex != null && kind) {
      applyRecoveredLlmResult(kind, configIndex, status.result);
    }
    removeInflightJob(jobId);
    return;
  }

  if (kind === 'orchestrate') {
    resumeOrchestrateJob(jobId, scenarioId);
  } else if (kind) {
    resumeLlmJob(jobId, configIndex, kind);
  } else {
    // Backend-discovered llm job without local metadata — cannot map it to a
    // config. Drop the record rather than resurrect unknown state.
    removeInflightJob(jobId);
  }
}

async function recoverJob(record: JobRecord): Promise<void> {
  const { jobId, jobType } = record;

  try {
    const status = await apiService.getJobStatus(jobType, jobId);

    if (jobType === 'llm') {
      recoverLlmJob(record, status);
      return;
    }

    if (status.cancelled || status.error) {
      console.log(`[useJobRecovery] Job ${jobId} (${jobType}) is cancelled/error — cleaning up`);
      removeInflightJob(jobId);
      resetJobState(jobType, record);
      return;
    }

    if (status.completed) {
      console.log(`[useJobRecovery] Job ${jobId} (${jobType}) completed while away — processing result`);
      await processCompletedJob(jobType, jobId, status.result, record);
      removeInflightJob(jobId);
      return;
    }

    // Still in progress — resume polling
    console.log(`[useJobRecovery] Job ${jobId} (${jobType}) still running — resuming polling`);
    startPolling(jobType, jobId, record);
  } catch {
    // Job not found or expired on the backend
    console.log(`[useJobRecovery] Job ${jobId} (${jobType}) not found on backend — cleaning up`);
    removeInflightJob(jobId);
    resetJobState(jobType, record);
  }
}

function startPolling(jobType: JobType, jobId: string, record: JobRecord): void {
  // Route isSoundGenerating through the shared counter so a recovered job can
  // never clobber a live concurrent generation's flag.
  if (jobType === 'sound' || jobType === 'tts') beginSoundGeneration();
  const interval = setInterval(async () => {
    try {
      const status = await apiService.getJobStatus(jobType, jobId);

      if (status.cancelled || status.error) {
        clearInterval(interval);
        removeInflightJob(jobId);
        if (jobType === 'sound' || jobType === 'tts') endSoundGeneration();
        resetJobState(jobType, record);
        return;
      }

      if (status.completed) {
        clearInterval(interval);
        if (jobType === 'sound' || jobType === 'tts') endSoundGeneration();
        await processCompletedJob(jobType, jobId, status.result, record);
        removeInflightJob(jobId);
        return;
      }

      // Update progress indicators in relevant stores
      updateProgress(jobType, status.progress, status.status, record);
    } catch {
      clearInterval(interval);
      removeInflightJob(jobId);
      if (jobType === 'sound' || jobType === 'tts') endSoundGeneration();
      resetJobState(jobType, record);
    }
  }, POLL_INTERVAL_MS);
}

function updateProgress(jobType: JobType, progress: number, statusText: string, record: JobRecord): void {
  switch (jobType) {
    case 'sound':
      useSoundscapeStore.setState({
        soundGenProgress: statusText,
        soundGenProgressValue: progress,
        soundGenStatusText: statusText,
      });
      break;
    case 'tts':
      useSoundscapeStore.setState({
        soundGenProgress: `TTS: ${statusText}`,
        soundGenProgressValue: progress,
        soundGenStatusText: statusText,
      });
      break;
    case 'sed':
      useSEDStore.setState({
        sedProgress: statusText,
        isSEDAnalyzing: true,
      });
      break;
    case 'pyroom':
    case 'choras': {
      const index = findAcousticsConfigIndex(record.jobId, record.jobId, record);
      if (index >= 0) {
        useAcousticsSimulationStore.getState().handleUpdateConfig(index, {
          isRunning: true,
          progress,
          status: statusText,
        } as any);
      }
      break;
    }
    case 'loop':
      break;
    case 'llm':
      break;
  }
}

function resetJobState(jobType: JobType, record: JobRecord): void {
  switch (jobType) {
    case 'sound':
    case 'tts':
      useSoundscapeStore.setState({
        soundGenProgress: '',
        soundGenProgressValue: 0,
        soundGenStatusText: '',
      });
      break;
    case 'sed':
      useSEDStore.setState({
        isSEDAnalyzing: false,
        sedProgress: '',
      });
      break;
    case 'pyroom':
    case 'choras': {
      const index = findAcousticsConfigIndex(record.jobId, record.jobId, record);
      if (index >= 0) {
        useAcousticsSimulationStore.getState().handleUpdateConfig(index, {
          isRunning: false,
          progress: 0,
          currentSimulationRunId: null,
        } as any);
      }
      break;
    }
    case 'loop': {
      const soundId = record.meta?.soundId;
      if (soundId) {
        useAudioControlsStore.setState((state) => {
          const next = { ...state.loopAnalysisInProgress };
          delete next[soundId];
          return { loopAnalysisInProgress: next };
        }, false, 'audio/loopRecoveryEnd');
      }
      break;
    }
    case 'llm':
      break;
  }
}

async function processCompletedJob(
  jobType: JobType,
  jobId: string,
  result: any,
  record: JobRecord,
): Promise<void> {
  switch (jobType) {
    case 'sound': {
      const store = useSoundscapeStore.getState();
      if (result && Array.isArray(result)) {
        const events = result.map((s: any) => ({
          ...s,
          geometry: s.geometry || { vertices: [], faces: [] },
          isUploaded: true,
        }));
        const existingIds = new Set(store.generatedSounds.map((e: any) => e.id));
        const newEvents = events.filter((e: any) => !existingIds.has(e.id));
        const merged = [...store.generatedSounds, ...newEvents];
        useSoundscapeStore.setState({
          generatedSounds: merged,
          // Keep the save/3D source of truth in sync (the live generation path
          // writes both; recovery must too, or the result never persists).
          soundscapeData: merged.length > 0 ? merged : null,
          soundGenProgress: '',
          soundGenProgressValue: 0,
          soundGenStatusText: '',
        });
      } else {
        useSoundscapeStore.setState({
          soundGenProgress: '',
          soundGenProgressValue: 0,
          soundGenStatusText: '',
        });
      }
      break;
    }
    case 'tts': {
      const store = useSoundscapeStore.getState();
      if (result && Array.isArray(result)) {
        const events = result.map((s: any) => ({
          ...s,
          id: s.id || `tts_${s.prompt_index ?? 0}_${s.copy_index ?? 0}_${s.voice_name || 'TTS'}`,
          geometry: s.geometry || { vertices: [], faces: [] },
          isUploaded: true,
          category: 'speech',
        }));
        const existingIds = new Set(store.generatedSounds.map((e: any) => e.id));
        const newEvents = events.filter((e: any) => !existingIds.has(e.id));
        const merged = [...store.generatedSounds, ...newEvents];
        useSoundscapeStore.setState({
          generatedSounds: merged,
          // Keep the save/3D source of truth in sync (see the sound case above).
          soundscapeData: merged.length > 0 ? merged : null,
          soundGenProgress: '',
          soundGenProgressValue: 0,
          soundGenStatusText: '',
        });
      } else {
        useSoundscapeStore.setState({
          soundGenProgress: '',
          soundGenProgressValue: 0,
          soundGenStatusText: '',
        });
      }
      break;
    }
    case 'sed': {
      if (result) {
        useSEDStore.setState({
          isSEDAnalyzing: false,
          sedProgress: '',
          sedDetectedSounds: result.detected_sounds || [],
          sedAudioInfo: result.audio_info || null,
        });
      } else {
        useSEDStore.setState({
          isSEDAnalyzing: false,
          sedProgress: '',
        });
      }
      break;
    }
    case 'pyroom':
      await recoverAcousticsJob('pyroom', jobId, result, record);
      break;
    case 'choras':
      await recoverAcousticsJob('choras', jobId, result, record);
      break;
    case 'loop':
      recoverLoopJob(result, record);
      break;
    case 'llm':
      break;
  }
}

/**
 * Restore a completed (or still-running, then completed) acoustics simulation
 * job into the matching `acousticsSimulationStore` card — the UI source of
 * truth for pyroom/choras. Re-imports the IRs, rebuilds the metrics text and
 * the simulation-time position snapshot, and marks the card complete.
 *
 * Idempotent: if the card already holds this simulation's results, it only
 * clears the in-flight run id (no duplicate IR upload).
 */
async function recoverAcousticsJob(
  jobType: 'pyroom' | 'choras',
  jobId: string,
  result: any,
  record: JobRecord,
): Promise<void> {
  const simulationId: string = result?.simulation_id || jobId;
  // Local records carry a configId, so we know the card should come back with
  // the bootstrap restore — wait briefly for it. Backend-discovered records are
  // resolved immediately by the persisted run id (or dropped if the card is gone).
  const index = record.meta?.configId
    ? await waitForAcousticsConfigIndex(jobId, simulationId, record)
    : findAcousticsConfigIndex(jobId, simulationId, record);
  if (index < 0) {
    console.log(`[useJobRecovery] ${jobType} job ${jobId} completed but no matching simulation card — result dropped`);
    return;
  }

  const store = useAcousticsSimulationStore.getState();
  const config = store.simulationConfigs[index] as { currentSimulationId?: string | null; importedIRIds?: string[]; simulationPositions?: unknown } | undefined;

  // Already applied on an earlier recovery — avoid re-uploading the IR files.
  if (config?.currentSimulationId === simulationId && (config?.importedIRIds?.length ?? 0) > 0) {
    store.handleUpdateConfig(index, {
      isRunning: false,
      progress: 100,
      status: 'Complete!',
      currentSimulationRunId: null,
    } as any);
    return;
  }

  const irFiles: string[] = Array.isArray(result?.ir_files) ? result.ir_files : [];
  if (irFiles.length === 0) {
    store.handleUpdateConfig(index, {
      isRunning: false,
      status: 'Error',
      error: 'Simulation completed but generated no impulse responses.',
      currentSimulationRunId: null,
    } as any);
    return;
  }

  const irImportResult = jobType === 'pyroom'
    ? await importPyroomIRFiles(simulationId, irFiles)
    : await importChorasIRFiles(simulationId, irFiles);

  if (irImportResult.importedCount === 0) {
    store.handleUpdateConfig(index, {
      isRunning: false,
      status: 'Error',
      error: 'Simulation completed but failed to import impulse responses.',
      currentSimulationRunId: null,
    } as any);
    return;
  }

  const resultsText = jobType === 'pyroom'
    ? await buildSimulationResultsText(simulationId)
    : await buildChorasSimulationResultsText(simulationId, irImportResult);

  const simulationPositions = buildRecoveredSimulationPositions();

  store.handleUpdateConfig(index, {
    state: 'completed',
    isRunning: false,
    progress: 100,
    status: 'Complete!',
    error: null,
    completedAt: Date.now(),
    simulationResults: resultsText,
    importedIRIds: irImportResult.importedIRIds,
    sourceReceiverIRMapping: irImportResult.sourceReceiverMapping,
    currentSimulationId: simulationId,
    currentSimulationRunId: null,
    ...(simulationPositions ? { simulationPositions } : {}),
  } as any);
}

function recoverLoopJob(result: any, record: JobRecord): void {
  const soundId = record.meta?.soundId;
  if (!soundId || !result) return;

  const startFrac = Math.max(0, Math.min(1, result.start));
  const endFrac = Math.max(0, Math.min(1, result.end));

  useAudioControlsStore.setState((state) => {
    const next = { ...state.loopAnalysisInProgress };
    delete next[soundId];
    return {
      loopAnalysisInProgress: next,
      soundLoopable: { ...state.soundLoopable, [soundId]: true },
    };
  }, false, 'audio/loopRecovered');

  useAudioControlsStore.getState().setSoundTrim(soundId, {
    start: startFrac,
    end: Math.max(startFrac + 0.02, endFrac),
  });
}
