'use client';

import { useEffect, useRef } from 'react';
import { apiService } from '@/services/api';
import { getStoredJobs, removeInflightJob, clearAllJobs } from '@/lib/job-tracker';
import { useSoundscapeStore } from '@/store/soundscapeStore';
import { useAudioControlsStore } from '@/store/audioControlsStore';
import { usePyroomAcousticsStore } from '@/store/pyroomAcousticsStore';
import { useChorasStore } from '@/store/chorasStore';
import { useAcousticsSimulationStore } from '@/store/acousticsSimulationStore';
import { useSEDStore } from '@/store/sedStore';
import { useTextGenerationStore } from '@/store/textGenerationStore';
import { useAnalysisStore } from '@/store/analysisStore';
import type { JobType, JobRecord } from '@/types';

const POLL_INTERVAL_MS = 1500;

function isJobLikelyStillAlive(record: JobRecord): boolean {
  const MAX_AGE_MS = 30 * 60 * 1000;
  return Date.now() - record.timestamp < MAX_AGE_MS;
}

/**
 * Reads sessionStorage for in-flight job IDs that survived a page refresh,
 * checks their current status on the backend, and either processes the result
 * (if completed) or resumes polling (if still running).
 *
 * Returns { hasInflightJobs } so the caller (page.tsx) can skip destructive
 * cleanup (delete IRs, generated sounds) while jobs are being recovered.
 */
export function useJobRecovery(): { hasInflightJobs: boolean } {
  const recoveredRef = useRef(false);

  useEffect(() => {
    if (recoveredRef.current) return;
    recoveredRef.current = true;

    const storedJobs = getStoredJobs();
    if (storedJobs.length === 0) return;

    console.log('[useJobRecovery] Found', storedJobs.length, 'stored job(s), checking status...');

    storedJobs.forEach((record) => {
      if (!isJobLikelyStillAlive(record)) {
        removeInflightJob(record.jobId);
        return;
      }
      recoverJob(record);
    });
  }, []);

  return { hasInflightJobs: getStoredJobs().length > 0 };
}

async function recoverJob(record: JobRecord): Promise<void> {
  const { jobId, jobType } = record;

  try {
    const status = await apiService.getJobStatus(jobType, jobId);

    if (status.cancelled || status.error) {
      console.log(`[useJobRecovery] Job ${jobId} (${jobType}) is cancelled/error — cleaning up`);
      removeInflightJob(jobId);
      resetJobState(jobType);
      return;
    }

    if (status.completed) {
      console.log(`[useJobRecovery] Job ${jobId} (${jobType}) completed while away — processing result`);
      processCompletedJob(jobType, jobId, status.result);
      removeInflightJob(jobId);
      return;
    }

    // Still in progress — resume polling
    console.log(`[useJobRecovery] Job ${jobId} (${jobType}) still running — resuming polling`);
    startPolling(jobType, jobId);
  } catch {
    // Job not found or expired on the backend
    console.log(`[useJobRecovery] Job ${jobId} (${jobType}) not found on backend — cleaning up`);
    removeInflightJob(jobId);
    resetJobState(jobType);
  }
}

function startPolling(jobType: JobType, jobId: string): void {
  const interval = setInterval(async () => {
    try {
      const status = await apiService.getJobStatus(jobType, jobId);

      if (status.cancelled || status.error) {
        clearInterval(interval);
        removeInflightJob(jobId);
        resetJobState(jobType);
        return;
      }

      if (status.completed) {
        clearInterval(interval);
        processCompletedJob(jobType, jobId, status.result);
        removeInflightJob(jobId);
        return;
      }

      // Update progress indicators in relevant stores
      updateProgress(jobType, status.progress, status.status);
    } catch {
      clearInterval(interval);
      removeInflightJob(jobId);
      resetJobState(jobType);
    }
  }, POLL_INTERVAL_MS);
}

function updateProgress(jobType: JobType, progress: number, statusText: string): void {
  switch (jobType) {
    case 'sound':
      useSoundscapeStore.setState({
        soundGenProgress: statusText,
        soundGenProgressValue: progress,
        isSoundGenerating: true,
      });
      break;
    case 'tts':
      useSoundscapeStore.setState({
        soundGenProgress: `TTS: ${statusText}`,
        soundGenProgressValue: progress,
        isSoundGenerating: true,
      });
      break;
    case 'llm':
      useTextGenerationStore.setState({
        llmProgress: statusText,
        isGenerating: true,
      });
      break;
    case 'sed':
      useSEDStore.setState({
        sedProgress: statusText,
        isSEDAnalyzing: true,
      });
      break;
    case 'choras':
      break;
    case 'pyroom':
      break;
    case 'model_analysis':
      useAnalysisStore.setState({
        analysisStatus: statusText,
        isAnalyzing: true,
      });
      break;
  }
}

function resetJobState(jobType: JobType): void {
  switch (jobType) {
    case 'sound':
    case 'tts':
      useSoundscapeStore.setState({
        isSoundGenerating: false,
        soundGenProgress: '',
        soundGenProgressValue: 0,
      });
      break;
    case 'llm':
      useTextGenerationStore.setState({
        isGenerating: false,
        llmProgress: '',
      });
      break;
    case 'sed':
      useSEDStore.setState({
        isSEDAnalyzing: false,
        sedProgress: '',
      });
      break;
    case 'choras':
    case 'pyroom':
      break;
    case 'model_analysis':
      useAnalysisStore.setState({
        isAnalyzing: false,
        analysisStatus: '',
      });
      break;
  }
}

function processCompletedJob(
  jobType: JobType,
  jobId: string,
  result: any,
): void {
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
          isSoundGenerating: false,
          soundGenProgress: '',
          soundGenProgressValue: 0,
        });
      } else {
        useSoundscapeStore.setState({
          isSoundGenerating: false,
          soundGenProgress: '',
          soundGenProgressValue: 0,
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
          isSoundGenerating: false,
          soundGenProgress: '',
          soundGenProgressValue: 0,
        });
      } else {
        useSoundscapeStore.setState({
          isSoundGenerating: false,
          soundGenProgress: '',
          soundGenProgressValue: 0,
        });
      }
      break;
    }
    case 'llm': {
      useTextGenerationStore.setState({
        isGenerating: false,
        llmProgress: '',
      });
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
    case 'pyroom': {
      break;
    }
    case 'choras': {
      break;
    }
    case 'model_analysis': {
      useAnalysisStore.setState({
        isAnalyzing: false,
        analysisStatus: '',
      });
      break;
    }
  }
}
