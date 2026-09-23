import { API_BASE_URL, SPECKLE_INGESTION } from '@/utils/constants';
import type { CompasGeometry, SoundEvent, SoundGenerationConfig, FileUploadResponse, JobType } from '@/types';
import type { ImpulseResponseMetadata } from '@/types/audio';
import type { ModalAnalysisRequest, ModalAnalysisResult } from '@/types/modal';
import type { SpeckleProjectModelsResponse, SpeckleModelLatestVersion } from '@/types/speckle-models';
import type { SoundscapeSavePayload, SoundscapeSaveResponse, SoundscapeLoadResponse, SoundscapeStats } from '@/types/soundscape';

/**
 * Enhanced error handling for API calls
 * Converts network errors and HTTP errors into user-friendly messages
 */
function handleApiError(error: unknown, context: string): never {
  // Network errors (no connection, CORS, etc.)
  if (error instanceof TypeError && error.message === 'Failed to fetch') {
    throw new Error(`Unable to connect to the server. Please check if the backend is running at ${API_BASE_URL}`);
  }

  // Generic network/fetch errors
  if (error instanceof TypeError) {
    throw new Error(`Network error: ${error.message}`);
  }

  // API errors with custom messages
  if (error instanceof Error) {
    throw error;
  }

  // Unknown errors
  throw new Error(`${context}: An unexpected error occurred`);
}

/**
 * Wrapper for fetch calls with consistent error handling and session cookie.
 */
async function fetchWithErrorHandling(
  url: string,
  options?: RequestInit,
  context: string = 'API request'
): Promise<Response> {
  try {
    const response = await fetch(url, {
      ...options,
      credentials: 'include',
    });
    return response;
  } catch (error) {
    handleApiError(error, context);
  }
}

// ─── Speckle file-ingestion polling ─────────────────────────────────────────
//
// `POST /api/upload` triggers Speckle's `startFileIngestion`, which creates the
// model version asynchronously. Every upload caller (viewer, file-upload store,
// model analysis) needs the real version_id/object_id, so `uploadFile` waits
// here until ingestion succeeds instead of each caller racing the pipeline.

export interface SpeckleIngestionStatus {
  status: string;
  progress_message: string | null;
  version_id: string | null;
  object_id: string | null;
  error: string | null;
}

/** Single probe of an ingestion job's status. Throws on transport/HTTP error. */
async function fetchSpeckleIngestionStatus(ingestionId: string): Promise<SpeckleIngestionStatus> {
  const response = await fetchWithErrorHandling(
    `${API_BASE_URL}/api/speckle/ingestion/${encodeURIComponent(ingestionId)}`,
    undefined,
    'Speckle ingestion status'
  );

  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: 'Failed to get ingestion status' }));
    throw new Error(err.detail || 'Failed to get ingestion status');
  }

  return response.json();
}

/**
 * Poll an ingestion job until it produces a model version.
 * Transient probe failures are retried; terminal job states throw.
 */
async function waitForSpeckleIngestion(
  ingestionId: string
): Promise<{ versionId: string; objectId: string }> {
  for (let attempt = 0; attempt < SPECKLE_INGESTION.MAX_ATTEMPTS; attempt++) {
    let terminalError: Error | null = null;
    try {
      const status = await fetchSpeckleIngestionStatus(ingestionId);
      if (status.status === 'success' && status.version_id) {
        return { versionId: status.version_id, objectId: status.object_id ?? '' };
      }
      if (status.status === 'failed' || status.status === 'cancelled' || status.status === 'invalid') {
        terminalError = new Error(status.error || `Speckle ingestion ${status.status}`);
      }
    } catch (err) {
      // Transient polling failures (network/502) — keep waiting.
      console.warn('[api] Speckle ingestion status poll failed, retrying:', err);
    }
    if (terminalError) throw terminalError;
    await new Promise((resolve) => setTimeout(resolve, SPECKLE_INGESTION.POLL_INTERVAL_MS));
  }
  throw new Error('Speckle ingestion did not finish in time');
}

// ─── Unified job-store polling (GET/POST /api/jobs/{id} and /cancel) ────────
//
// All generation/simulation jobs now live on the Redis job store and are polled
// and cancelled through the unified routers/jobs.py endpoints. The per-domain
// status/cancel routes were deleted. The wrappers below translate the unified
// response back into the legacy envelope the stores/hooks were written against,
// so call sites keep working unchanged.

const JOB_LIMIT_MESSAGE =
  'Too many generations already running for this session. Please wait for one to finish before starting another.';

/** Raw unified job-store status (JobStatusResponse from routers/jobs.py). */
interface UnifiedJobStatus {
  job_id: string;
  type: string;
  status: string; // 'queued' | 'running' | 'completed' | 'cancelled' | 'error'
  progress: number;
  status_text: string;
  queue_position: number | null;
  queue_total: number | null;
  // Result shape varies per job type (array of sounds, dict, metrics, …).
  partial: any;
  result: any;
  error: string | null;
}

/** GET /api/jobs/{id} → raw unified status. */
async function getUnifiedJobStatus(jobId: string): Promise<UnifiedJobStatus> {
  const response = await fetchWithErrorHandling(
    `${API_BASE_URL}/api/jobs/${jobId}`,
    undefined,
    'Job status'
  );
  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: 'Failed to get job status' }));
    throw new Error(err.detail || 'Failed to get job status');
  }
  return response.json();
}

/** POST /api/jobs/{id}/cancel — cancel is best-effort, never throws. */
async function cancelUnifiedJob(jobId: string): Promise<void> {
  try {
    await fetchWithErrorHandling(
      `${API_BASE_URL}/api/jobs/${jobId}/cancel`,
      { method: 'POST' },
      'Cancel job'
    );
  } catch {
    // Silently fail — cancel is best-effort
  }
}

/**
 * Translate the unified job-store status into the legacy per-domain envelope
 * (`completed`/`cancelled` booleans, human `status` text, `partial_sounds`
 * alias for `partial`) so stores and hooks don't need to change.
 */
function toLegacyJobStatus(job: UnifiedJobStatus) {
  return {
    progress: job.progress,
    status: job.status_text || job.status,
    completed: job.status === 'completed',
    cancelled: job.status === 'cancelled',
    error: job.error,
    result: job.result,
    partial: job.partial,
    partial_sounds: job.partial,
    queue_position: job.queue_position,
    queue_total: job.queue_total,
  };
}

export interface ServiceVersionInfo {
  name: string;
  version: string;
  device?: string;
}

export interface LLMProviderInfo {
  name: string;
  version: string | null;
  installed: boolean;
}

export interface LLMProviders {
  google: LLMProviderInfo;
  openai: LLMProviderInfo;
  anthropic: LLMProviderInfo;
}

export interface ServiceVersions {
  pyroomacoustics: ServiceVersionInfo;
  tangoflux: ServiceVersionInfo;
  audioldm2: ServiceVersionInfo;
  bbc: ServiceVersionInfo;
  llm_providers: LLMProviders;
  yamnet: ServiceVersionInfo;
  acousticDE: ServiceVersionInfo;
  edg_acoustics: ServiceVersionInfo;
  'gemini-tts': ServiceVersionInfo;
}

export interface TokenStatus {
  speckle_token_set: boolean;
  speckle_project_name: string;
  google_api_key_set: boolean;
  openai_api_key_set: boolean;
  anthropic_api_key_set: boolean;
}

export interface TokenUpdate {
  speckle_token?: string;
  speckle_project_name?: string;
  google_api_key?: string;
  openai_api_key?: string;
  anthropic_api_key?: string;
}

/** Identity resolved from the Cloudflare Access JWT (or anonymous fallback). */
export interface CurrentUser {
  email: string | null;
  user_id: string | null;
  display_name: string | null;
  workspace_id: string | null;
}

export interface WorkspaceSummary {
  id: string;
  owner_hash: string;
  name: string;
  sharing_mode: 'private' | 'link';
  revision: number;
  role: 'owner' | 'editor' | 'viewer';
  created_at: string;
  updated_at: string;
}

export interface WorkspaceMember {
  user_hash: string;
  email: string | null;
  display_name: string | null;
  role: 'owner' | 'editor' | 'viewer';
  joined_at: string;
}

export interface WorkspaceDetail extends WorkspaceSummary {
  members?: WorkspaceMember[];
  presence?: number;
}

/** Invite metadata for the management list. `id` is a hash, not the secret token. */
export interface WorkspaceInvite {
  id: string;
  role: 'editor' | 'viewer';
  created_by: string;
  created_at: string;
  expires_at: string | null;
  revoked: boolean;
  max_uses: number;
  used_count: number;
}

// API Service Layer
export const apiService = {
  // ─── Identity ─────────────────────────────────────────────────────────────
  /** Current identity (email from Cloudflare Access; anonymous fallback). */
  async getCurrentUser(): Promise<CurrentUser> {
    const response = await fetchWithErrorHandling(
      `${API_BASE_URL}/api/me`,
      undefined,
      'Get current user'
    );
    if (!response.ok) {
      throw new Error('Failed to resolve identity');
    }
    return response.json();
  },

  async setDisplayName(displayName: string): Promise<CurrentUser> {
    const response = await fetchWithErrorHandling(
      `${API_BASE_URL}/api/me/display-name`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: displayName }),
      },
      'Set display name'
    );
    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: 'Failed to set display name' }));
      throw new Error(err.detail || 'Failed to set display name');
    }
    return response.json();
  },

  async listWorkspaces(): Promise<WorkspaceSummary[]> {
    const response = await fetchWithErrorHandling(
      `${API_BASE_URL}/api/workspaces`,
      undefined,
      'List workspaces'
    );
    if (!response.ok) return [];
    const data = await response.json();
    return data.workspaces ?? [];
  },

  // ─── Workspaces / collaboration ─────────────────────────────────────────
  async getWorkspace(workspaceId: string): Promise<WorkspaceDetail> {
    const response = await fetchWithErrorHandling(
      `${API_BASE_URL}/api/workspaces/${encodeURIComponent(workspaceId)}`,
      undefined,
      'Get workspace'
    );
    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: 'Failed to load workspace' }));
      throw new Error(typeof err.detail === 'string' ? err.detail : 'Failed to load workspace');
    }
    return response.json();
  },

  async createWorkspace(name?: string): Promise<WorkspaceDetail> {
    const response = await fetchWithErrorHandling(
      `${API_BASE_URL}/api/workspaces`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      },
      'Create workspace'
    );
    if (!response.ok) throw new Error('Failed to create workspace');
    return response.json();
  },

  async switchWorkspace(workspaceId: string): Promise<WorkspaceDetail> {
    const response = await fetchWithErrorHandling(
      `${API_BASE_URL}/api/workspaces/${encodeURIComponent(workspaceId)}/switch`,
      { method: 'POST' },
      'Switch workspace'
    );
    if (!response.ok) throw new Error('Failed to switch workspace');
    return response.json();
  },

  async updateWorkspace(workspaceId: string, patch: { name?: string; sharing_mode?: 'private' | 'link' }): Promise<WorkspaceDetail> {
    const response = await fetchWithErrorHandling(
      `${API_BASE_URL}/api/workspaces/${encodeURIComponent(workspaceId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      },
      'Update workspace'
    );
    if (!response.ok) throw new Error('Failed to update workspace');
    return response.json();
  },

  async createWorkspaceInvite(
    workspaceId: string,
    role: 'editor' | 'viewer' = 'editor',
    options?: { expiresInS?: number; maxUses?: number },
  ): Promise<{ token: string; role: string; url: string; expires_at: string | null; max_uses: number }> {
    const response = await fetchWithErrorHandling(
      `${API_BASE_URL}/api/workspaces/${encodeURIComponent(workspaceId)}/invites`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role,
          expires_in_s: options?.expiresInS,
          max_uses: options?.maxUses,
        }),
      },
      'Create invite'
    );
    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: 'Failed to create invite' }));
      throw new Error(typeof err.detail === 'string' ? err.detail : 'Failed to create invite');
    }
    return response.json();
  },

  async listWorkspaceInvites(workspaceId: string): Promise<WorkspaceInvite[]> {
    const response = await fetchWithErrorHandling(
      `${API_BASE_URL}/api/workspaces/${encodeURIComponent(workspaceId)}/invites`,
      undefined,
      'List invites'
    );
    if (!response.ok) return [];
    const data = await response.json();
    return data.invites ?? [];
  },

  async revokeWorkspaceInvite(workspaceId: string, inviteId: string): Promise<void> {
    const response = await fetchWithErrorHandling(
      `${API_BASE_URL}/api/workspaces/${encodeURIComponent(workspaceId)}/invites/${encodeURIComponent(inviteId)}`,
      { method: 'DELETE' },
      'Revoke invite'
    );
    if (!response.ok) throw new Error('Failed to revoke invite');
  },

  async leaveWorkspace(workspaceId: string): Promise<void> {
    const response = await fetchWithErrorHandling(
      `${API_BASE_URL}/api/workspaces/${encodeURIComponent(workspaceId)}/leave`,
      { method: 'POST' },
      'Leave workspace'
    );
    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: 'Failed to leave workspace' }));
      throw new Error(typeof err.detail === 'string' ? err.detail : 'Failed to leave workspace');
    }
  },

  async updateWorkspaceMemberRole(workspaceId: string, userHash: string, role: 'editor' | 'viewer'): Promise<WorkspaceDetail> {
    const response = await fetchWithErrorHandling(
      `${API_BASE_URL}/api/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(userHash)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      },
      'Update member role'
    );
    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: 'Failed to update member role' }));
      throw new Error(typeof err.detail === 'string' ? err.detail : 'Failed to update member role');
    }
    return response.json();
  },

  async removeWorkspaceMember(workspaceId: string, userHash: string): Promise<WorkspaceDetail> {
    const response = await fetchWithErrorHandling(
      `${API_BASE_URL}/api/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(userHash)}`,
      { method: 'DELETE' },
      'Remove member'
    );
    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: 'Failed to remove member' }));
      throw new Error(typeof err.detail === 'string' ? err.detail : 'Failed to remove member');
    }
    return response.json();
  },

  async transferWorkspaceOwnership(workspaceId: string, userHash: string): Promise<WorkspaceDetail> {
    const response = await fetchWithErrorHandling(
      `${API_BASE_URL}/api/workspaces/${encodeURIComponent(workspaceId)}/transfer`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_hash: userHash }),
      },
      'Transfer ownership'
    );
    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: 'Failed to transfer ownership' }));
      throw new Error(typeof err.detail === 'string' ? err.detail : 'Failed to transfer ownership');
    }
    return response.json();
  },

  async joinWorkspace(token: string): Promise<WorkspaceDetail> {
    const response = await fetchWithErrorHandling(
      `${API_BASE_URL}/api/workspaces/join`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      },
      'Join workspace'
    );
    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: 'Failed to join workspace' }));
      throw new Error(typeof err.detail === 'string' ? err.detail : 'Failed to join workspace');
    }
    return response.json();
  },

  async workspaceHeartbeat(workspaceId: string): Promise<{ presence: number; revision: number }> {
    const response = await fetchWithErrorHandling(
      `${API_BASE_URL}/api/workspaces/${encodeURIComponent(workspaceId)}/presence`,
      { method: 'POST' },
      'Workspace presence'
    );
    if (!response.ok) return { presence: 1, revision: 0 };
    return response.json();
  },

  // File Upload
  async uploadFile(file: File): Promise<FileUploadResponse | CompasGeometry> {
    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetchWithErrorHandling(
        `${API_BASE_URL}/api/upload`,
        {
          method: 'POST',
          body: formData
        },
        'File upload'
      );

      if (!response.ok) {
        const err = await response.json().catch(() => ({ detail: 'File upload failed' }));
        throw new Error(err.detail || 'File upload failed');
      }

      const data = await response.json();

      // Speckle file ingestion is asynchronous — wait for the created model version so
      // the viewer can load it and simulations have a valid version_id.
      const speckle = (data as FileUploadResponse | undefined)?.speckle;
      if (speckle?.ingestion_id && !speckle.version_id) {
        const resolved = await waitForSpeckleIngestion(speckle.ingestion_id);
        speckle.version_id = resolved.versionId;
        speckle.object_id = resolved.objectId;
      }

      return data;
    } catch (error) {
      handleApiError(error, 'File upload');
    }
  },

  // Load Sample Audio
  async loadSampleAudio(): Promise<File> {
    const filename = 'Le Corbeau et le Renard (french).wav';
    const sampleAudioPath = `/samples/${filename}`;

    try {
      const response = await fetch(sampleAudioPath);

      if (!response.ok) {
        throw new Error(`Failed to load sample audio: ${response.status} ${response.statusText}`);
      }

      const blob = await response.blob();
      return new File([blob], filename, { type: blob.type || 'audio/wav' });
    } catch (error) {
      handleApiError(error, 'Load sample audio');
    }
  },

  // Generate Sounds (async — returns job_id for polling via /api/jobs/{id})
  async generateSounds(data: {
    sounds: SoundGenerationConfig[];
    bounding_box: { min: number[]; max: number[] } | null;
    apply_denoising?: boolean;
    trim_silence?: boolean;
    audio_model?: string;
    base_dbfs?: number;
  }): Promise<{ generation_id: string } & { job_id: string }> {
    try {
      const response = await fetchWithErrorHandling(
        `${API_BASE_URL}/api/generate-sounds`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        },
        'Generate sounds'
      );

      if (!response.ok) {
        const err = await response.json().catch(() => ({ detail: 'Failed to generate sounds' }));
        if (response.status === 429) {
          throw new Error(JOB_LIMIT_MESSAGE);
        }
        throw new Error(err.detail || 'Failed to generate sounds');
      }

      const json = await response.json();
      // Backend now returns {job_id, position, total} — expose the legacy
      // generation_id alias so existing call sites keep working.
      return { ...json, generation_id: json.job_id };
    } catch (error) {
      handleApiError(error, 'Generate sounds');
    }
  },

  // Poll sound generation status (via unified /api/jobs/{id})
  async getSoundGenerationStatus(generationId: string): Promise<{
    generation_id: string;
    progress: number;
    status: string;
    completed: boolean;
    cancelled: boolean;
    error: string | null;
    result?: any[] | null;
    partial_sounds?: any[] | null;
    queue_position?: number | null;
    queue_total?: number | null;
  }> {
    const job = await getUnifiedJobStatus(generationId);
    return { generation_id: generationId, ...toLegacyJobStatus(job) };
  },

  // Cancel sound generation (via unified /api/jobs/{id}/cancel)
  async cancelSoundGeneration(generationId: string): Promise<void> {
    await cancelUnifiedJob(generationId);
  },

  // Delete a single SED-extracted segment audio file (one variant of an
  // audio-analysis sound card). Returns true when the file was removed, false
  // when it was already gone (404).
  async deleteSedSegmentAudio(url: string): Promise<boolean> {
    try {
      const filename = (() => {
        try {
          return new URL(url, API_BASE_URL).pathname.split('/').pop() || '';
        } catch {
          return url.split('/').pop() || '';
        }
      })();
      if (!filename) return false;

      const response = await fetchWithErrorHandling(
        `${API_BASE_URL}/api/extract-sed-segments/${encodeURIComponent(filename)}`,
        { method: 'DELETE' },
        'Delete audio segment'
      );
      if (response.status === 404) return false;
      if (!response.ok) {
        const err = await response.json().catch(() => ({ detail: 'Failed to delete audio segment' }));
        throw new Error(err.detail || 'Failed to delete audio segment');
      }
      return true;
    } catch (error) {
      handleApiError(error, 'Delete audio segment');
    }
  },

  // Generate TTS (async — returns job_id for polling via /api/jobs/{id})
  async generateTTS(data: {
    texts: { text: string; voice_name?: string; display_name?: string; position?: number[]; dbfs?: number; prompt_index?: number; copy_index?: number; total_copies?: number }[];
    language?: string;
    tts_model?: string;
  }): Promise<{ generation_id: string } & { job_id: string }> {
    try {
      const response = await fetchWithErrorHandling(
        `${API_BASE_URL}/api/generate-tts`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        },
        'Generate TTS'
      );
      if (!response.ok) {
        const err = await response.json().catch(() => ({ detail: 'Failed to generate TTS' }));
        throw new Error(err.detail || 'Failed to generate TTS');
      }
      const json = await response.json();
      return { ...json, generation_id: json.job_id };
    } catch (error) {
      handleApiError(error, 'Generate TTS');
    }
  },

  // Poll TTS generation status (via unified /api/jobs/{id})
  async getTTSGenerationStatus(generationId: string): Promise<{
    generation_id: string;
    progress: number;
    status: string;
    completed: boolean;
    cancelled: boolean;
    error: string | null;
    result?: any[] | null;
    partial_sounds?: any[] | null;
    queue_position?: number | null;
    queue_total?: number | null;
  }> {
    const job = await getUnifiedJobStatus(generationId);
    return { generation_id: generationId, ...toLegacyJobStatus(job) };
  },

  // Cancel TTS generation (via unified /api/jobs/{id}/cancel)
  async cancelTTSGeneration(generationId: string): Promise<void> {
    await cancelUnifiedJob(generationId);
  },

  // Calibrate Audio (normalize RMS + dBFS calibration for non-ML audio modes)
  async calibrateAudio(
    audioBlob: Blob,
    dbfs: number,
    applyDenoising: boolean = false,
    trimSilence: boolean = false
  ): Promise<{ url: string; noise_trim?: [number, number] | null }> {
    try {
      const formData = new FormData();
      formData.append('audio', audioBlob, 'audio.wav');
      formData.append('dbfs', dbfs.toString());
      formData.append('apply_denoising', applyDenoising.toString());
      formData.append('trim_silence', trimSilence.toString());

      const response = await fetchWithErrorHandling(
        `${API_BASE_URL}/api/calibrate-audio`,
        { method: 'POST', body: formData },
        'Audio calibration'
      );

      if (!response.ok) {
        const err = await response.json().catch(() => ({ detail: 'Calibration failed' }));
        throw new Error(err.detail || 'Calibration failed');
      }

      return await response.json();
    } catch (error) {
      handleApiError(error, 'Audio calibration');
    }
  },

  // Loop Analysis — detect a seamless loop region (server-side, queued job)

  /**
   * Enqueue a seamless-loop-region analysis for an existing generated sound.
   * @param soundUrl - The generated sound's static URL (e.g. /static/sounds/generated/<sid>/<file>.wav)
   * @returns analysis_id to poll via /api/jobs/{id}
   */
  async analyzeLoop(soundUrl: string): Promise<{ analysis_id: string } & { job_id: string }> {
    try {
      const response = await fetchWithErrorHandling(
        `${API_BASE_URL}/api/analyze-loop`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sound_url: soundUrl }),
        },
        'Loop analysis'
      );

      if (!response.ok) {
        const err = await response.json().catch(() => ({ detail: 'Loop analysis failed' }));
        throw new Error(err.detail || 'Loop analysis failed');
      }

      const json = await response.json();
      return { ...json, analysis_id: json.job_id };
    } catch (error) {
      handleApiError(error, 'Loop analysis');
    }
  },

  /** Poll the loop-analysis job. Result carries {start, end} fractions (0-1). */
  async getLoopAnalysisStatus(
    analysisId: string
  ): Promise<{
    status: string;
    progress: number;
    completed: boolean;
    cancelled: boolean;
    error?: string | null;
    result?: { start: number; end: number; length_sec?: number; match_score?: number } | null;
  }> {
    const job = await getUnifiedJobStatus(analysisId);
    return toLegacyJobStatus(job);
  },

  // Cleanup Generated Sounds
  async cleanupGeneratedSounds(): Promise<void> {
    try {
      await fetchWithErrorHandling(
        `${API_BASE_URL}/api/cleanup-generated-sounds`,
        { method: 'POST' },
        'Cleanup generated sounds'
      );
    } catch (error) {
      // Silently fail - cleanup is not critical
      console.warn('Failed to cleanup generated sounds:', error);
    }
  },

  /**
   * Delete specific generated sound files by their static URLs. Used when a
   * scenario's child sound scene is replaced, so regeneration does not dedup
   * to the old files on disk.
   */
  async deleteGeneratedSounds(urls: string[]): Promise<void> {
    if (urls.length === 0) return;
    try {
      await fetchWithErrorHandling(
        `${API_BASE_URL}/api/delete-generated-sounds`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ urls }),
        },
        'Delete generated sounds'
      );
    } catch (error) {
      console.warn('Failed to delete generated sounds:', error);
    }
  },

  // Impulse Response Management

  /**
   * Upload an impulse response file
   */
  async uploadImpulseResponse(file: File, name: string): Promise<ImpulseResponseMetadata> {
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('name', name);

      const response = await fetchWithErrorHandling(
        `${API_BASE_URL}/api/impulse-responses/upload`,
        {
          method: 'POST',
          body: formData
        },
        'Upload impulse response'
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Failed to upload impulse response' }));
        throw new Error(error.detail || 'Failed to upload impulse response');
      }

      return response.json();
    } catch (error) {
      handleApiError(error, 'Upload impulse response');
    }
  },

  /**
   * List all impulse responses
   */
  async listImpulseResponses(): Promise<ImpulseResponseMetadata[]> {
    try {
      const response = await fetchWithErrorHandling(
        `${API_BASE_URL}/api/impulse-responses`,
        undefined,
        'List impulse responses'
      );

      if (!response.ok) {
        throw new Error('Failed to fetch impulse responses');
      }

      const data = await response.json();
      return data.impulse_responses;
    } catch (error) {
      handleApiError(error, 'List impulse responses');
    }
  },

  /**
   * Delete an impulse response
   */
  async deleteImpulseResponse(irId: string): Promise<void> {
    try {
      const response = await fetchWithErrorHandling(
        `${API_BASE_URL}/api/impulse-responses/${irId}`,
        { method: 'DELETE' },
        'Delete impulse response'
      );

      if (!response.ok) {
        throw new Error('Failed to delete impulse response');
      }
    } catch (error) {
      handleApiError(error, 'Delete impulse response');
    }
  },

  // Modal Analysis

  /**
   * Perform modal analysis on a mesh to find resonant frequencies
   */
  async analyzeModal(request: ModalAnalysisRequest): Promise<ModalAnalysisResult> {
    try {
      const response = await fetchWithErrorHandling(
        `${API_BASE_URL}/api/modal-analysis/analyze`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
        },
        'Modal analysis'
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Modal analysis failed' }));
        throw new Error(error.detail || 'Modal analysis failed');
      }

      return response.json();
    } catch (error) {
      handleApiError(error, 'Modal analysis');
    }
  },

  /**
   * Get available material presets for modal analysis
   */
  async getModalMaterials(): Promise<{
    materials: Record<string, { young_modulus: number; poisson_ratio: number; density: number }>;
    description: Record<string, string>;
  }> {
    try {
      const response = await fetchWithErrorHandling(
        `${API_BASE_URL}/api/modal-analysis/materials`,
        undefined,
        'Get modal materials'
      );

      if (!response.ok) {
        throw new Error('Failed to fetch modal materials');
      }

      return response.json();
    } catch (error) {
      handleApiError(error, 'Get modal materials');
    }
  },

  // Choras Acoustic Simulation

  // Pyroomacoustics Acoustic Simulation

  /**
   * Get available materials from Pyroomacoustics library
   */
  async getPyroomacousticsMaterials(): Promise<Array<{
    id: string;
    name: string;
    description?: string;
    category?: string;
    absorption: number;
    coeffs?: number[];
    center_freqs?: number[];
  }>> {
    try {
      const response = await fetchWithErrorHandling(
        `${API_BASE_URL}/api/pyroomacoustics/materials`,
        undefined,
        'Get Pyroomacoustics materials'
      );

      if (!response.ok) {
        throw new Error('Failed to fetch Pyroomacoustics materials');
      }

      return response.json();
    } catch (error) {
      handleApiError(error, 'Get Pyroomacoustics materials');
    }
  },

  /**
   * Run Pyroomacoustics simulation
   * 
   * @param file - 3D model file (3dm, obj, or ifc)
   * @param simulationName - Name for the simulation
   * @param settings - Simulation settings (max_order, ray_tracing, air_absorption)
   * @param sourceReceiverPairs - Array of source-receiver position pairs
   * @param faceMaterialAssignments - Map of face index to material ID
   */
  async runPyroomacousticsSimulation(
    file: File,
    simulationName: string,
    settings: {
      max_order: number;
      ray_tracing: boolean;
      air_absorption: boolean;
      n_rays: number;
      scattering: number;
      simulation_mode: string;
      enable_grid?: boolean;
    },
    sourceReceiverPairs: Array<{
      source_position: number[];
      receiver_position: number[];
      source_id: string;
      receiver_id: string;
    }>,
    faceMaterialAssignments: Record<number, string>,
    excludedLayers?: string[]
  ): Promise<{
    simulation_id: string;
    message: string;
    ir_files: string[];
    results_file: string;
    grid_plot_file?: string;
  }> {
    try {
      const formData = new FormData();
      formData.append('model_file', file);
      formData.append('simulation_name', simulationName);
      formData.append('max_order', settings.max_order.toString());
      formData.append('ray_tracing', settings.ray_tracing.toString());
      formData.append('air_absorption', settings.air_absorption.toString());
      formData.append('n_rays', settings.n_rays.toString());
      formData.append('scattering', settings.scattering.toString());

      formData.append('simulation_mode', settings.simulation_mode);
      formData.append('enable_grid', (settings.enable_grid ?? false).toString());

      formData.append('source_receiver_pairs', JSON.stringify(sourceReceiverPairs));
      formData.append('face_materials', JSON.stringify(faceMaterialAssignments));

      if (excludedLayers && excludedLayers.length > 0) {
        formData.append('excludedLayers', JSON.stringify(excludedLayers));
      }

      const response = await fetchWithErrorHandling(
        `${API_BASE_URL}/api/pyroomacoustics/run-simulation`,
        {
          method: 'POST',
          body: formData
        },
        'Run Pyroomacoustics simulation'
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Simulation failed' }));
        throw new Error(error.detail || 'Simulation failed');
      }

      return response.json();
    } catch (error) {
      handleApiError(error, 'Run Pyroomacoustics simulation');
    }
  },

  /**
   * Run Pyroomacoustics simulation with Speckle geometry
   *
   * @param speckleProjectId - Speckle project ID
   * @param speckleVersionId - Speckle version/commit ID
   * @param objectMaterials - Map of Speckle object ID to material ID
   * @param layerName - Name of the layer to extract geometry from (e.g., "Acoustics")
   * @param simulationName - Name for the simulation
   * @param settings - Simulation settings
   * @param sourceReceiverPairs - Array of source-receiver position pairs
   */
  async runPyroomacousticsSimulationSpeckle(
    speckleProjectId: string,
    speckleVersionId: string,
    objectMaterials: Record<string, string>,
    layerName: string,
    simulationName: string,
    settings: {
      max_order: number;
      ray_tracing: boolean;
      air_absorption: boolean;
      n_rays: number;
      simulation_mode: string;
      enable_grid?: boolean;
      sound_speed?: number;
    },
    sourceReceiverPairs: Array<{
      source_position: number[];
      receiver_position: number[];
      source_id: string;
      receiver_id: string;
    }>,
    geometryObjectIds?: string[],
    objectScattering?: Record<string, number>
  ): Promise<{ simulation_id: string } & { job_id: string }> {
    try {
      const formData = new FormData();
      formData.append('simulation_name', simulationName);
      formData.append('speckle_project_id', speckleProjectId);
      formData.append('speckle_version_id', speckleVersionId);
      formData.append('object_materials', JSON.stringify(objectMaterials));
      formData.append('layer_name', layerName);
      formData.append('max_order', settings.max_order.toString());
      formData.append('ray_tracing', settings.ray_tracing.toString());
      formData.append('air_absorption', settings.air_absorption.toString());
      formData.append('n_rays', settings.n_rays.toString());
      formData.append('object_scattering', JSON.stringify(objectScattering || {}));

      formData.append('simulation_mode', settings.simulation_mode);
      formData.append('enable_grid', (settings.enable_grid ?? false).toString());
      if (settings.sound_speed !== undefined) {
        formData.append('sound_speed', settings.sound_speed.toString());
      }

      // Send explicit geometry object IDs from the frontend to bypass layer-name filtering
      if (geometryObjectIds && geometryObjectIds.length > 0) {
        formData.append('geometry_object_ids', JSON.stringify(geometryObjectIds));
      }

      formData.append('source_receiver_pairs', JSON.stringify(sourceReceiverPairs));

      const response = await fetchWithErrorHandling(
        `${API_BASE_URL}/api/pyroomacoustics/run-simulation-speckle`,
        {
          method: 'POST',
          body: formData
        },
        'Run Pyroomacoustics Speckle simulation'
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Speckle simulation failed' }));
        throw new Error(error.detail || 'Speckle simulation failed');
      }

      const json = await response.json();
      return { ...json, simulation_id: json.job_id };
    } catch (error) {
      handleApiError(error, 'Run Pyroomacoustics Speckle simulation');
    }
  },

  /**
   * Poll the status of a queued or running Pyroomacoustics simulation (via
   * unified GET /api/jobs/{id}).
   * Call every ~1 second while isRunning=true.
   */
  async getPyroomacousticsSimulationStatus(simulationId: string): Promise<{
    simulation_id: string;
    progress: number;
    status: string;
    completed: boolean;
    cancelled: boolean;
    error: string | null;
    result?: {
      simulation_id: string;
      message: string;
      ir_files: string[];
      results_file: string;
    } | null;
    queue_position?: number | null;
    queue_total?: number | null;
  }> {
    const job = await getUnifiedJobStatus(simulationId);
    return { simulation_id: simulationId, ...toLegacyJobStatus(job) };
  },

  /**
   * Signal the backend to cancel a running or queued Pyroomacoustics simulation
   * (via unified POST /api/jobs/{id}/cancel).
   */
  async cancelPyroomacousticsSimulation(simulationId: string): Promise<void> {
    await cancelUnifiedJob(simulationId);
  },

  /**
   * Get a specific IR file from a Pyroomacoustics simulation
   *
   * @param simulationId - The simulation ID
   * @param irFilename - The specific IR filename to retrieve
   * @returns Blob containing the WAV file
   */
  async getPyroomacousticsIRFile(
    simulationId: string,
    irFilename: string
  ): Promise<Blob> {
    try {
      const url = `${API_BASE_URL}/api/pyroomacoustics/get-result-file/${simulationId}/wav?ir_filename=${encodeURIComponent(irFilename)}`;

      const response = await fetchWithErrorHandling(
        url,
        undefined,
        'Get Pyroomacoustics IR file'
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Failed to retrieve IR file' }));
        throw new Error(error.detail || 'Failed to retrieve IR file');
      }

      return response.blob();
    } catch (error) {
      handleApiError(error, 'Get Pyroomacoustics IR file');
    }
  },

  // ─── Choras (DE/DG) API Methods ─────────────────────────────────────────

  /**
   * Get available absorption materials for Choras (DE/DG) simulations.
   */
  async getChorasMaterials(): Promise<Array<{
    id: string;
    name: string;
    description?: string;
    coeffs: number[];
    center_freqs: number[];
    absorption: number;
  }>> {
    try {
      const response = await fetchWithErrorHandling(
        `${API_BASE_URL}/api/choras/materials`,
        undefined,
        'Get Choras materials'
      );
      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Failed to get Choras materials' }));
        throw new Error(error.detail || 'Failed to get Choras materials');
      }
      return response.json();
    } catch (error) {
      handleApiError(error, 'Get Choras materials');
    }
  },

  /**
   * Start a Choras (DE or DG) acoustic simulation from a Speckle model.
   * Returns immediately with a simulation_id — poll getChorasSimulationStatus()
   * for live progress updates.
   */
  async runChorasSimulationSpeckle(
    speckleProjectId: string,
    speckleVersionId: string,
    objectMaterials: Record<string, string>,
    layerName: string,
    simulationName: string,
    settings: {
      simulation_method: 'DE' | 'DG';
      de_c0?: number;
      de_lc?: number;
      dg_freq_upper_limit?: number;
      dg_c0?: number;
      dg_rho0?: number;
      dg_poly_order?: number;
      dg_ppw?: number;
      dg_cfl?: number;
    },
    sourceReceiverPairs: Array<{
      source_position: number[];
      receiver_position: number[];
      source_id: string;
      receiver_id: string;
    }>,
    geometryObjectIds?: string[],
  ): Promise<{ simulation_id: string } & { job_id: string }> {
    try {
      const formData = new FormData();
      formData.append('simulation_name', simulationName);
      formData.append('speckle_project_id', speckleProjectId);
      formData.append('speckle_version_id', speckleVersionId);
      formData.append('object_materials', JSON.stringify(objectMaterials));
      formData.append('layer_name', layerName);
      formData.append('simulation_method', settings.simulation_method);

      if (settings.de_c0 !== undefined) formData.append('de_c0', String(settings.de_c0));
      if (settings.de_lc !== undefined) formData.append('de_lc', String(settings.de_lc));
      if (settings.dg_freq_upper_limit !== undefined) formData.append('dg_freq_upper_limit', String(settings.dg_freq_upper_limit));
      if (settings.dg_c0 !== undefined) formData.append('dg_c0', String(settings.dg_c0));
      if (settings.dg_rho0 !== undefined) formData.append('dg_rho0', String(settings.dg_rho0));
      if (settings.dg_poly_order !== undefined) formData.append('dg_poly_order', String(settings.dg_poly_order));
      if (settings.dg_ppw !== undefined) formData.append('dg_ppw', String(settings.dg_ppw));
      if (settings.dg_cfl !== undefined) formData.append('dg_cfl', String(settings.dg_cfl));

      if (geometryObjectIds?.length) {
        formData.append('geometry_object_ids', JSON.stringify(geometryObjectIds));
      }
      formData.append('source_receiver_pairs', JSON.stringify(sourceReceiverPairs));

      const response = await fetchWithErrorHandling(
        `${API_BASE_URL}/api/choras/run-simulation-speckle`,
        { method: 'POST', body: formData },
        'Start Choras Speckle simulation'
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Choras simulation failed' }));
        throw new Error(error.detail || 'Choras simulation failed');
      }
      const json = await response.json();
      return { ...json, simulation_id: json.job_id };
    } catch (error) {
      handleApiError(error, 'Start Choras Speckle simulation');
    }
  },

  /**
   * Poll the status of a running (or recently completed) Choras simulation (via
   * unified GET /api/jobs/{id}).
   * Call every ~1 second while isRunning=true.
   */
  async getChorasSimulationStatus(simulationId: string): Promise<{
    simulation_id: string;
    progress: number;
    status: string;
    completed: boolean;
    cancelled: boolean;
    error: string | null;
    result?: {
      simulation_id: string;
      message: string;
      ir_files: string[];
      results_file: string;
      method: string;
    } | null;
    queue_position?: number | null;
    queue_total?: number | null;
  }> {
    const job = await getUnifiedJobStatus(simulationId);
    return { simulation_id: simulationId, ...toLegacyJobStatus(job) };
  },

  /**
   * Signal the backend to cancel a running Choras simulation (via unified
   * POST /api/jobs/{id}/cancel). The worker kills the child process.
   */
  async cancelChorasSimulation(simulationId: string): Promise<void> {
    await cancelUnifiedJob(simulationId);
  },

  /**
   * Retrieve a Choras simulation WAV file by filename.
   */
  async getChorasIRFile(simulationId: string, irFilename: string): Promise<Blob> {
    try {
      const url = `${API_BASE_URL}/api/choras/get-result-file/${simulationId}/wav?ir_filename=${encodeURIComponent(irFilename)}`;

      const response = await fetchWithErrorHandling(
        url,
        undefined,
        'Get Choras IR file'
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Failed to get Choras IR file' }));
        throw new Error(error.detail || 'Failed to get Choras IR file');
      }
      return response.blob();
    } catch (error) {
      handleApiError(error, 'Get Choras IR file');
    }
  },

  // Speckle API Methods

  /**
   * Get all Speckle models with detailed metadata.
   * Returns the full response envelope including project_id, models, and auth_token.
   */
  async getSpeckleModels(): Promise<SpeckleProjectModelsResponse> {
    try {
      const response = await fetchWithErrorHandling(
        `${API_BASE_URL}/api/speckle/models`,
        undefined,
        'Get Speckle models'
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Failed to get Speckle models' }));
        throw new Error(error.detail || 'Failed to get Speckle models');
      }

      return response.json();
    } catch (error) {
      handleApiError(error, 'Get Speckle models');
    }
  },

  /**
   * Read the latest version summary for a single Speckle model.
   *
   * Side-effect free (unlike ensure-ready) — safe to poll to detect that a
   * newer commit was published.
   */
  async getModelLatestVersion(modelId: string): Promise<SpeckleModelLatestVersion | null> {
    const response = await fetchWithErrorHandling(
      `${API_BASE_URL}/api/speckle/models/${encodeURIComponent(modelId)}/latest`,
      undefined,
      'Get latest model version'
    );

    if (response.status === 404) return null;
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Failed to get latest model version' }));
      throw new Error(error.detail || 'Failed to get latest model version');
    }

    return response.json();
  },

  /**
   * Ensure a model's latest version is loadable by the pinned viewer.
   *
   * Re-materializes bundle-only / pre-fix legacy versions into a viewer-safe
   * version on the backend, then resolves. Best-effort callers should swallow
   * failures — the viewer still attempts to load the current version.
   *
   * @param modelId - The Speckle model ID
   * @returns The current loadable `{version_id, object_id}`
   */
  async ensureSpeckleModelReady(modelId: string): Promise<{ version_id: string; object_id: string; created_at?: string | null }> {
    const response = await fetchWithErrorHandling(
      `${API_BASE_URL}/api/speckle/models/${encodeURIComponent(modelId)}/ensure-ready`,
      { method: 'POST' },
      'Prepare Speckle model'
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Failed to prepare Speckle model' }));
      throw new Error(error.detail || 'Failed to prepare Speckle model');
    }

    return response.json();
  },

  /**
   * Load a specific Speckle model by object ID
   * @param objectId - The Speckle object ID to load
   * @returns Speckle model data
   */
  async loadSpeckleModel(objectId: string): Promise<any> {
    try {
      const response = await fetchWithErrorHandling(
        `${API_BASE_URL}/api/speckle/models/${objectId}`,
        undefined,
        'Load Speckle model'
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Failed to load Speckle model' }));
        throw new Error(error.detail || 'Failed to load Speckle model');
      }

      return response.json();
    } catch (error) {
      handleApiError(error, 'Load Speckle model');
    }
  },

  // Soundscape Data Persistence

  /**
   * Save soundscape data (configs, events, audio files) to Speckle + local storage.
   * @param payload - Soundscape save payload with data and audio URLs
   */
  async saveSoundscapeToSpeckle(payload: SoundscapeSavePayload): Promise<SoundscapeSaveResponse> {
    try {
      const response = await fetchWithErrorHandling(
        `${API_BASE_URL}/api/speckle/soundscape/save`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
        'Save soundscape to Speckle'
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Failed to save soundscape' }));
        const detail = error.detail;
        // Optimistic-concurrency conflict (shared workspace): surface the
        // current revision so the caller can refetch instead of clobbering.
        if (response.status === 409 && detail && typeof detail === 'object') {
          const conflict = new Error(detail.message || 'This workspace changed since you last loaded it.');
          (conflict as Error & { conflictRevision?: number }).conflictRevision = detail.revision;
          throw conflict;
        }
        if (Array.isArray(detail)) {
          const msgs = detail.map((d: any) => `${d.loc?.join('.') ?? '?'}: ${d.msg}`).join('; ');
          throw new Error(msgs || 'Failed to save soundscape');
        }
        throw new Error(typeof detail === 'string' ? detail : 'Failed to save soundscape');
      }

      return response.json();
    } catch (error) {
      handleApiError(error, 'Save soundscape to Speckle');
    }
  },

  /**
   * Load soundscape data for a Speckle model (local-first, Speckle fallback).
   * @param modelId - Speckle model ID
   */
  async loadSoundscapeFromSpeckle(modelId: string, workspaceId?: string | null): Promise<SoundscapeLoadResponse> {
    try {
      const qs = workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : '';
      const response = await fetchWithErrorHandling(
        `${API_BASE_URL}/api/speckle/soundscape/${encodeURIComponent(modelId)}${qs}`,
        undefined,
        'Load soundscape from Speckle'
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Failed to load soundscape' }));
        throw new Error(error.detail || 'Failed to load soundscape');
      }

      return response.json();
    } catch (error) {
      handleApiError(error, 'Load soundscape from Speckle');
    }
  },

  /**
   * Upload a blob audio file to the soundscape folder on the server.
   * Used for library/uploaded sounds that only have browser blob URLs.
   *
   * @param modelId - Speckle model ID (used as folder name)
   * @param soundId - Sound event ID (used to derive filename)
   * @param audioBlob - The audio data as a Blob
   * @returns Object with the saved filename and sound_id
   */
  async uploadSoundscapeAudio(
    modelId: string,
    soundId: string,
    audioBlob: Blob,
  ): Promise<{ filename: string; sound_id: string }> {
    try {
      const formData = new FormData();
      formData.append('sound_id', soundId);
      formData.append('audio', audioBlob, `${soundId}.wav`);

      const response = await fetchWithErrorHandling(
        `${API_BASE_URL}/api/speckle/soundscape/${encodeURIComponent(modelId)}/upload-audio`,
        {
          method: 'POST',
          body: formData,
        },
        'Upload soundscape audio'
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Failed to upload audio' }));
        throw new Error(error.detail || 'Failed to upload audio');
      }

      return response.json();
    } catch (error) {
      handleApiError(error, 'Upload soundscape audio');
    }
  },

  /**
   * List locally saved Home (sandbox) projects for this workspace.
   */
  async listHomeProjects(): Promise<{
    projects: Array<{ model_id: string; name: string; saved_at: string }>;
  }> {
    const response = await fetchWithErrorHandling(
      `${API_BASE_URL}/api/speckle/soundscape/home-projects`,
      undefined,
      'List home projects'
    );
    return response.json();
  },

  /**
   * Delete a project's saved history (soundscape data, audio, IRs, analysis).
   * @param modelId - Speckle model ID
   */
  async deleteSoundscapeHistory(modelId: string): Promise<{ success: boolean }> {
    try {
      const response = await fetchWithErrorHandling(
        `${API_BASE_URL}/api/speckle/soundscape/${encodeURIComponent(modelId)}`,
        { method: 'DELETE' },
        'Delete soundscape history'
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Failed to delete history' }));
        throw new Error(error.detail || 'Failed to delete history');
      }

      return response.json();
    } catch (error) {
      handleApiError(error, 'Delete soundscape history');
    }
  },

  /**
   * Get file statistics for a saved soundscape (counts, sizes, dates).
   * @param modelId - Speckle model ID
   */
  async getSoundscapeStats(modelId: string): Promise<SoundscapeStats> {
    try {
      const response = await fetchWithErrorHandling(
        `${API_BASE_URL}/api/speckle/soundscape/${encodeURIComponent(modelId)}/stats`,
        undefined,
        'Get soundscape stats'
      );
      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Failed to get stats' }));
        throw new Error(error.detail || 'Failed to get stats');
      }
      return response.json();
    } catch (error) {
      handleApiError(error, 'Get soundscape stats');
    }
  },

  async getServiceVersions(llm_model?: string): Promise<ServiceVersions> {
    try {
      const url = llm_model ? `${API_BASE_URL}/api/versions?llm_model=${llm_model}` : `${API_BASE_URL}/api/versions`;
      const response = await fetchWithErrorHandling(
        url,
        {},
        'Service versions'
      );
      if (!response.ok) throw new Error('Failed to fetch service versions');
      return await response.json();
    } catch (error) {
      handleApiError(error, 'Service versions');
    }
  },

  // ── Token management ──────────────────────────────────────────────────────

  async getTokenStatus(): Promise<TokenStatus> {
    try {
      const response = await fetchWithErrorHandling(
        `${API_BASE_URL}/api/tokens`,
        undefined,
        'Get token status'
      );
      if (!response.ok) throw new Error('Failed to get token status');
      return response.json();
    } catch (error) {
      handleApiError(error, 'Get token status');
    }
  },

  async updateTokens(tokens: TokenUpdate): Promise<TokenStatus> {
    try {
      const response = await fetchWithErrorHandling(
        `${API_BASE_URL}/api/tokens`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(tokens),
        },
        'Update tokens'
      );
      if (!response.ok) {
        const err = await response.json().catch(() => ({ detail: 'Failed to update tokens' }));
        throw new Error(err.detail || 'Failed to update tokens');
      }
      return response.json();
    } catch (error) {
      handleApiError(error, 'Update tokens');
    }
  },

  // ── SED analysis (queued) ─────────────────────────────────────────────────

  async startSEDAnalysis(formData: FormData): Promise<{ task_id: string } & { job_id: string }> {
    const response = await fetchWithErrorHandling(
      `${API_BASE_URL}/api/analyze-sound-events`,
      {
        method: 'POST',
        body: formData,
      },
      'Start SED analysis',
    );
    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: 'Failed to start SED analysis' }));
      throw new Error(err.detail || 'Failed to start SED analysis');
    }
    const json = await response.json();
    return { ...json, task_id: json.job_id };
  },

  async getSEDAnalysisStatus(taskId: string): Promise<{
    task_id: string;
    progress: number;
    status: string;
    completed: boolean;
    cancelled: boolean;
    error?: string | null;
    result?: { audio_info: any; detected_sounds: any[]; total_classes_analyzed: number };
    queue_position?: number | null;
    queue_total?: number | null;
  }> {
    const job = await getUnifiedJobStatus(taskId);
    return { task_id: taskId, ...toLegacyJobStatus(job) };
  },

  async cancelSEDAnalysis(taskId: string): Promise<void> {
    await cancelUnifiedJob(taskId);
  },

  // ─── Job Recovery ───────────────────────────────────────────────────────

  /**
   * Generic job status polling — routes every job type to the unified
   * GET /api/jobs/{id} endpoint (the per-domain status routes were deleted).
   * Used by useJobRecovery to resume polling for in-flight jobs after a refresh.
   *
   * Returns a JobStatus envelope translated from the unified response. The
   * `result` field shape varies by job type; callers handle it based on jobType.
   */
  async cancelJob(jobId: string): Promise<void> {
    await cancelUnifiedJob(jobId);
  },

  /**
   * Enqueue an LLM agent IO job (analyze-3dmodel / scenarist / foley / speech / orchestrate).
   * Poll GET /api/jobs/{job_id} for thought-summary progress.
   */
  async enqueueLlmJob(path: string, body: object): Promise<{ job_id: string }> {
    const response = await fetchWithErrorHandling(
      `${API_BASE_URL}${path}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      'LLM job',
    );
    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: 'Failed to start LLM job' }));
      const msg = err.detail || 'Failed to start LLM job';
      throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    }
    return response.json();
  },

  async getJobStatus(jobType: JobType, jobId: string): Promise<{
    completed: boolean;
    cancelled: boolean;
    error: string | null;
    progress: number;
    status: string;
    result?: any;
    partial?: any;
    partial_sounds?: any[];
  }> {
    try {
      const job = await getUnifiedJobStatus(jobId);
      return toLegacyJobStatus(job);
    } catch {
      return { completed: false, cancelled: false, error: 'Job not found or expired', progress: 0, status: 'unknown' };
    }
  },
};
