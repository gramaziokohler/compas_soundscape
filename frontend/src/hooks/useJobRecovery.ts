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
import { usePyroomAcousticsStore } from '@/store/pyroomAcousticsStore';
import { useChorasStore } from '@/store/chorasStore';
import { useAudioControlsStore } from '@/store/audioControlsStore';
import {
  importPyroomIRFiles,
  importChorasIRFiles,
  buildSimulationResultsText,
  buildChorasSimulationResultsText,
  type IRImportResult,
} from '@/utils/acousticMetrics';
import type { JobType, JobRecord } from '@/types';

const POLL_INTERVAL_MS = 1500;

/** Matches the backend `JOB_RESULT_TTL_S` (3600 s). */
const MAX_AGE_MS = 60 * 60 * 1000;

function isJobLikelyStillAlive(record: JobRecord): boolean {
  return Date.now() - record.timestamp < MAX_AGE_MS;
}

function emptyIRImport(): IRImportResult {
  return {
    importedCount: 0,
    totalCount: 0,
    importedIRIds: [],
    importedIRMetadataList: [],
    sourceReceiverMapping: {},
  };
}

/** Find the pyroom instance card whose recorded simulation id matches. */
function findPyroomInstanceId(simulationId: string): string | undefined {
  const { instances } = usePyroomAcousticsStore.getState();
  for (const [id, inst] of Object.entries(instances)) {
    if (inst.currentSimulationId === simulationId) return id;
  }
  return undefined;
}

/** Find the choras instance card whose recorded simulation id matches. */
function findChorasInstanceId(simulationId: string): string | undefined {
  const { instances } = useChorasStore.getState();
  for (const [id, inst] of Object.entries(instances)) {
    if (inst.currentSimulationId === simulationId) return id;
  }
  return undefined;
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
    case 'pyroom': {
      const instanceId = record.meta?.instanceId ?? findPyroomInstanceId(record.jobId);
      if (instanceId) {
        usePyroomAcousticsStore.getState().patchInstance(instanceId, {
          isRunning: true,
          progress,
          status: statusText,
        });
      }
      break;
    }
    case 'choras': {
      const instanceId = record.meta?.instanceId ?? findChorasInstanceId(record.jobId);
      if (instanceId) {
        useChorasStore.getState().patchInstance(instanceId, {
          isRunning: true,
          progress,
          status: statusText,
        });
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
    case 'pyroom': {
      const instanceId = record.meta?.instanceId ?? findPyroomInstanceId(record.jobId);
      if (instanceId) {
        usePyroomAcousticsStore.getState().patchInstance(instanceId, {
          isRunning: false,
          _pollInterval: null,
        });
      }
      break;
    }
    case 'choras': {
      const instanceId = record.meta?.instanceId ?? findChorasInstanceId(record.jobId);
      if (instanceId) {
        useChorasStore.getState().patchInstance(instanceId, {
          isRunning: false,
          _pollInterval: null,
        });
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
      await recoverPyroomJob(jobId, result, record);
      break;
    case 'choras':
      await recoverChorasJob(jobId, result, record);
      break;
    case 'loop':
      recoverLoopJob(result, record);
      break;
    case 'llm':
      break;
  }
}

async function recoverPyroomJob(jobId: string, result: any, record: JobRecord): Promise<void> {
  const simulationId: string = result?.simulation_id || jobId;
  const instanceId = record.meta?.instanceId ?? findPyroomInstanceId(simulationId) ?? findPyroomInstanceId(jobId);
  if (!instanceId) return;

  const store = usePyroomAcousticsStore.getState();
  store.ensureInstance(instanceId);

  let irImportResult = emptyIRImport();
  if (Array.isArray(result?.ir_files) && result.ir_files.length > 0) {
    irImportResult = await importPyroomIRFiles(simulationId, result.ir_files);
  }
  const resultsText = await buildSimulationResultsText(simulationId);

  store.patchInstance(instanceId, {
    isRunning: false,
    progress: 100,
    status: 'Complete!',
    simulationResults: resultsText,
    currentSimulationId: simulationId,
    irImported: irImportResult.importedCount > 0,
    importedIRIds: irImportResult.importedIRIds,
    sourceReceiverIRMapping: irImportResult.sourceReceiverMapping,
    _pollInterval: null,
  });
}

async function recoverChorasJob(jobId: string, result: any, record: JobRecord): Promise<void> {
  const simulationId: string = result?.simulation_id || jobId;
  const instanceId = record.meta?.instanceId ?? findChorasInstanceId(simulationId) ?? findChorasInstanceId(jobId);
  if (!instanceId) return;

  const store = useChorasStore.getState();
  store.ensureInstance(instanceId);

  let irImportResult = emptyIRImport();
  if (Array.isArray(result?.ir_files) && result.ir_files.length > 0) {
    irImportResult = await importChorasIRFiles(simulationId, result.ir_files);
  }
  const resultsText = await buildChorasSimulationResultsText(simulationId, irImportResult);

  store.patchInstance(instanceId, {
    isRunning: false,
    progress: 100,
    status: 'Complete!',
    simulationResults: resultsText,
    currentSimulationId: simulationId,
    irImported: irImportResult.importedCount > 0,
    importedIRIds: irImportResult.importedIRIds,
    sourceReceiverIRMapping: irImportResult.sourceReceiverMapping,
    _pollInterval: null,
  });
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
