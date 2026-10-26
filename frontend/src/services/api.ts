import { API_BASE_URL, SPECKLE_DIRECT_UPLOAD, SPECKLE_INGESTION } from '@/utils/constants';
import type { CompasGeometry, SoundEvent, SoundGenerationConfig, FileUploadResponse, JobType, JobRecord, UserPreferences, BugReportPayload, BugReportCreated } from '@/types';
import { recordFailedRequest } from '@/lib/diagnostics/diagnosticsBuffer';
import type { TtsCustomVoice, TtsCustomVoiceCreateRequest, TtsDialectsResponse, TtsLanguageMatch } from '@/types/ttsLanguage';
import type { ImpulseResponseMetadata } from '@/types/audio';
import type { ModalAnalysisRequest, ModalAnalysisResult } from '@/types/modal';
import type {
  SpeckleProjectModelsResponse,
  SpeckleModelLatestVersion,
  SpeckleModelVersionsResponse,
  SpeckleIngestionStatus,
  SpeckleUploadProgress,
} from '@/types/speckle-models';
import type { ModelVersionImpactReport, ModelVersionImpactRequest } from '@/types/modelVersionImpact';
import type { SoundscapeSavePayload, SoundscapeSaveResponse, SoundscapeLoadResponse, SoundscapeStats } from '@/types/soundscape';
import type { SendScenesRequest, SendScenesResponse } from '@/types/sceneTransfer';
import type { PreflightJobResult, PreflightPayload, SimulationEngine, SimulationMeshSettings } from '@/types/simulationPreflight';
import type {
  PffdtdAnimationJobResult,
  PffdtdFreeGridPoints,
  PffdtdFreeIRFailure,
  PffdtdFreeIRResponse,
  PffdtdJobPartial,
  PffdtdJobResult,
  PffdtdResultsJson,
  PffdtdSettings,
  PffdtdStatus,
  PffdtdVoxelPoints,
  PffdtdVoxelPreviewJobResult,
  PffdtdVoxelPreviewPayload,
} from '@/types/pffdtd';
import type { SimulationGeometryRequest } from '@/utils/simulationRequest';
import type { StudyConfig, StudyEventBatch, StudySnapshotUpload, StudyMomentCreate, StudyMomentNote } from '@/types/study';

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
    if (!response.ok) recordFailedRequest(options?.method ?? 'GET', url, response.status);
    return response;
  } catch (error) {
    handleApiError(error, context);
  }
}

// ─── Speckle file-ingestion polling ─────────────────────────────────────────
//
// `POST /api/upload/finalize` triggers Speckle's `startFileIngestion`, which creates the
// model version asynchronously. Every upload caller (viewer, file-upload store,
// model analysis) needs the real version_id/object_id, so `uploadFile` waits
// here until ingestion succeeds instead of each caller racing the pipeline.

/**
 * PUT a model file straight to Speckle's presigned blob URL (CORS-enabled for
 * the app origin). XHR rather than fetch: only XHR reports upload progress.
 * Resolves with the ETag `startFileIngestion` needs; rejects on HTTP error,
 * network error or a stall longer than SPECKLE_DIRECT_UPLOAD.STALL_TIMEOUT_MS.
 */
function putFileToSpeckleStorage(
  url: string,
  file: File,
  onProgress: (fraction: number) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let stallTimer: ReturnType<typeof setTimeout> | undefined;
    const armStallTimer = () => {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => xhr.abort(), SPECKLE_DIRECT_UPLOAD.STALL_TIMEOUT_MS);
    };

    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = (event) => {
      armStallTimer();
      if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      clearTimeout(stallTimer);
      const etag = xhr.getResponseHeader('ETag');
      if (xhr.status >= 200 && xhr.status < 300 && etag) resolve(etag);
      else reject(new Error(`Upload to Speckle storage failed (HTTP ${xhr.status})`));
    };
    xhr.onerror = () => {
      clearTimeout(stallTimer);
      reject(new Error('Upload to Speckle storage failed (network error)'));
    };
    xhr.onabort = () => reject(new Error('Upload to Speckle storage stalled — check your connection and try again'));

    armStallTimer();
    xhr.send(file);
  });
}

/** Map one ingestion status probe onto the client-side upload progress shape. */
function toUploadProgress(status: SpeckleIngestionStatus): SpeckleUploadProgress {
  const stage = status.stage === 'success' || status.stage === 'failed' ? 'materializing' : status.stage;
  return {
    stage,
    message: status.progress_message,
    progress: stage === 'processing' ? status.progress : null,
    phase: status.phase,
    attempt: status.attempt,
  };
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
  ingestionId: string,
  onProgress?: (progress: SpeckleUploadProgress) => void
): Promise<{ versionId: string; objectId: string }> {
  for (let attempt = 0; attempt < SPECKLE_INGESTION.MAX_ATTEMPTS; attempt++) {
    let terminalError: Error | null = null;
    try {
      const status = await fetchSpeckleIngestionStatus(ingestionId);
      if (status.status === 'success' && status.version_id) {
        return { versionId: status.version_id, objectId: status.object_id ?? '' };
      }
      if (status.stage === 'failed') {
        terminalError = new Error(status.error || `Speckle ingestion ${status.status}`);
      } else {
        onProgress?.(toUploadProgress(status));
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
  /** Card mapping published by the submitting client (`POST /api/jobs/{id}/meta`). */
  client_meta?: JobRecord['meta'] | null;
  /** Creation time (epoch seconds). */
  created?: number | null;
}

/** A workspace job as listed by `GET /api/jobs`, mapped to the frontend JobType. */
export interface ActiveJob {
  jobId: string;
  jobType: JobType;
  status: string;
  result: any;
  meta?: JobRecord['meta'];
  /** Creation time in ms, or null when the backend did not report it. */
  createdMs: number | null;
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

/** Geometry form fields shared by the PFFDTD run and voxel preview (pyroomacoustics fields, no scattering). */
function pffdtdGeometryForm(request: SimulationGeometryRequest, meshSettings?: SimulationMeshSettings): FormData {
  const formData = new FormData();
  formData.append('speckle_project_id', request.projectId);
  formData.append('speckle_version_id', request.versionId);
  formData.append('object_materials', JSON.stringify(request.objectMaterials));
  formData.append('layer_name', request.layerName);
  if (request.geometryObjectIds?.length) {
    formData.append('geometry_object_ids', JSON.stringify(request.geometryObjectIds));
  }
  formData.append('source_receiver_pairs', JSON.stringify(request.sourceReceiverPairs));
  if (meshSettings) formData.append('mesh_settings', JSON.stringify(meshSettings));
  return formData;
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
  stable_audio_3: ServiceVersionInfo;
  bbc: ServiceVersionInfo;
  llm_providers: LLMProviders;
  yamnet: ServiceVersionInfo;
  'gemini-tts': ServiceVersionInfo;
  /** PFFDTD wave solver (absent on older backends). */
  pffdtd?: ServiceVersionInfo & { available?: boolean };
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

/** Only the owner's changes are saved; every other member is view-only. */
export type WorkspaceRole = 'owner' | 'viewer';

export interface WorkspaceSummary {
  id: string;
  owner_hash: string;
  name: string;
  sharing_mode: 'private' | 'link';
  revision: number;
  role: WorkspaceRole;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceMember {
  user_hash: string;
  email: string | null;
  display_name: string | null;
  role: WorkspaceRole;
  joined_at: string;
}

export interface WorkspaceDetail extends WorkspaceSummary {
  members?: WorkspaceMember[];
  presence?: number;
  /** Present on the join response: the model the invite was scoped to. */
  model_id?: string | null;
}

/** Invite metadata for the management list. `id` is a hash, not the secret token. */
export interface WorkspaceInvite {
  id: string;
  role: 'viewer';
  created_by: string;
  created_at: string;
  expires_at: string | null;
  revoked: boolean;
  max_uses: number;
  used_count: number;
  /** The model this invite is scoped to (opened after joining), if any. */
  model_id: string | null;
}

// ─── Preferences wire mapping (camelCase domain ↔ snake_case API) ──────────
// Single source of truth for the key mapping; keep in sync with
// `UserPreferences` in backend/models/schemas.py.
const PREF_WIRE_KEYS: Record<keyof UserPreferences, string> = {
  colorTheme: 'color_theme',
  showAxesHelper: 'show_axes_helper',
  showLabelSprites: 'show_label_sprites',
  showHoveringHighlight: 'show_hovering_highlight',
  showSoundSpheres: 'show_sound_spheres',
  showPlayingHighlight: 'show_playing_highlight',
  showSceneListeners: 'show_scene_listeners',
  showGroundGrid: 'show_ground_grid',
  showGroundGridLabels: 'show_ground_grid_labels',
  groundGridSpacing: 'ground_grid_spacing',
  groundGridColor: 'ground_grid_color',
  globalSoundSpeed: 'global_sound_speed',
  llmModel: 'llm_model',
  ttsModel: 'tts_model',
  ttsLanguage: 'tts_language',
  audioModel: 'audio_model',
  diffusionSteps: 'diffusion_steps',
  negativePrompt: 'negative_prompt',
  applyDenoising: 'apply_denoising',
  trimSilence: 'trim_silence',
  applyNoiseReduction: 'apply_noise_reduction',
  normalizeImpulseResponses: 'normalize_impulse_responses',
  listenerOrientation: 'listener_orientation',
  outputDeviceId: 'output_device_id',
  globalBaseDbfs: 'global_base_dbfs',
  showSpectrograms: 'show_spectrograms',
  enableAutoSave: 'enable_auto_save',
  seenHints: 'seen_hints',
};

function prefsToWire(prefs: Partial<UserPreferences>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  (Object.keys(prefs) as (keyof UserPreferences)[]).forEach((key) => {
    const value = prefs[key];
    if (value === undefined) return;
    out[PREF_WIRE_KEYS[key]] = value;
  });
  return out;
}

function prefsFromWire(raw: Record<string, unknown>): UserPreferences {
  const reverse: Partial<Record<string, keyof UserPreferences>> = {};
  (Object.keys(PREF_WIRE_KEYS) as (keyof UserPreferences)[]).forEach((camel) => {
    reverse[PREF_WIRE_KEYS[camel]] = camel;
  });
  const out: Record<string, unknown> = {};
  for (const [snake, value] of Object.entries(raw)) {
    const camel = reverse[snake];
    if (!camel || value === null || value === undefined) continue;
    out[camel] = value;
  }
  return out as UserPreferences;
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

  // ─── Per-user preferences (Advanced Settings) ───────────────────────────
  /** Fetch the current user's stored Advanced Settings (empty object when unset). */
  async getUserPreferences(): Promise<UserPreferences> {
    const response = await fetchWithErrorHandling(
      `${API_BASE_URL}/api/me/preferences`,
      undefined,
      'Get preferences'
    );
    if (!response.ok) return {};
    const data = await response.json().catch(() => ({}));
    return prefsFromWire(data ?? {});
  },

  /** Shallow-merge a partial preferences patch for the current user. */
  async updateUserPreferences(prefs: Partial<UserPreferences>): Promise<UserPreferences> {
    const response = await fetchWithErrorHandling(
      `${API_BASE_URL}/api/me/preferences`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(prefsToWire(prefs)),
      },
      'Save preferences'
    );
    if (!response.ok) throw new Error('Failed to save preferences');
    const data = await response.json().catch(() => ({}));
    return prefsFromWire(data ?? {});
  },

  // ─── Bug reports ────────────────────────────────────────────────────────
  /** Submit an in-app bug report; returns its reference id. */
  async submitBugReport(payload: BugReportPayload): Promise<BugReportCreated> {
    const response = await fetchWithErrorHandling(
      `${API_BASE_URL}/api/bug-reports`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
      'Send bug report'
    );
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const detail = typeof data?.detail === 'string' ? data.detail : `Server error ${response.status}`;
      throw new Error(`Could not send the report: ${detail}`);
    }
    return response.json();
  },

  // ─── Research-study logging (routers/study.py; 404 when disabled) ───────
  /** Study config for this participant, or null when study logging is off. */
  async getStudyConfig(): Promise<StudyConfig | null> {
    const response = await fetchWithErrorHandling(`${API_BASE_URL}/api/study/config`, undefined, 'Study config');
    if (!response.ok) return null;
    return response.json();
  },

  /** Post a batch of study events. Throws on failure so the logger can retry. */
  async postStudyEvents(batch: StudyEventBatch): Promise<void> {
    const response = await fetchWithErrorHandling(
      `${API_BASE_URL}/api/study/events`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(batch) },
      'Study events'
    );
    if (!response.ok) throw new Error(`Study events rejected (${response.status})`);
  },

  /** Fire-and-forget delivery on page unload (sendBeacon, text/plain body). */
  beaconStudyEvents(body: string): boolean {
    if (typeof navigator === 'undefined' || !navigator.sendBeacon) return false;
    return navigator.sendBeacon(`${API_BASE_URL}/api/study/events`, body);
  },

  async postStudySnapshot(snapshot: StudySnapshotUpload): Promise<void> {
    const response = await fetchWithErrorHandling(
      `${API_BASE_URL}/api/study/snapshots`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(snapshot) },
      'Study snapshot'
    );
    if (!response.ok) throw new Error(`Study snapshot rejected (${response.status})`);
  },

  /** Create a moment (screenshot captured at click time); returns its id. */
  async createStudyMoment(moment: StudyMomentCreate): Promise<string> {
    const response = await fetchWithErrorHandling(
      `${API_BASE_URL}/api/study/moments`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(moment) },
      'Study moment'
    );
    if (!response.ok) throw new Error(`Could not save the moment (${response.status})`);
    const data = await response.json();
    return String(data.id);
  },

  async noteStudyMoment(momentId: string, note: StudyMomentNote): Promise<void> {
    const response = await fetchWithErrorHandling(
      `${API_BASE_URL}/api/study/moments/${encodeURIComponent(momentId)}/note`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(note) },
      'Study moment note'
    );
    if (!response.ok) throw new Error(`Could not save the note (${response.status})`);
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
    options?: { expiresInS?: number; maxUses?: number; modelId?: string | null },
  ): Promise<{ token: string; role: string; url: string; model_id: string | null; expires_at: string | null; max_uses: number }> {
    const response = await fetchWithErrorHandling(
      `${API_BASE_URL}/api/workspaces/${encodeURIComponent(workspaceId)}/invites`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expires_in_s: options?.expiresInS,
          max_uses: options?.maxUses,
          model_id: options?.modelId ?? null,
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

  async workspaceHeartbeat(workspaceId: string): Promise<{ presence: number; revision: number; role?: WorkspaceRole }> {
    const response = await fetchWithErrorHandling(
      `${API_BASE_URL}/api/workspaces/${encodeURIComponent(workspaceId)}/presence`,
      { method: 'POST' },
      'Workspace presence'
    );
    if (!response.ok) return { presence: 1, revision: 0 };
    return response.json();
  },

  // File Upload
  async uploadFile(
    file: File,
    onProgress?: (progress: SpeckleUploadProgress) => void,
    /** Existing model to add the file to as a new version (else matched by file name). */
    targetModelId?: string,
  ): Promise<FileUploadResponse | CompasGeometry> {
    try {
      onProgress?.({ stage: 'uploading', message: null, progress: null, phase: null, attempt: null });

      // 1. Presigned Speckle blob URL — the file itself never goes through our server.
      const prepareResponse = await fetchWithErrorHandling(
        `${API_BASE_URL}/api/upload/prepare`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file_name: file.name }),
        },
        'File upload'
      );
      if (!prepareResponse.ok) {
        const err = await prepareResponse.json().catch(() => ({ detail: 'File upload failed' }));
        throw new Error(err.detail || 'File upload failed');
      }
      const { upload_url, file_id } = (await prepareResponse.json()) as { upload_url: string; file_id: string };

      // 2. Browser → blob storage, with live byte progress.
      const etag = await putFileToSpeckleStorage(upload_url, file, (fraction) =>
        onProgress?.({ stage: 'uploading', message: null, progress: fraction, phase: null, attempt: null })
      );

      // 3. Start Speckle ingestion of the uploaded blob.
      const response = await fetchWithErrorHandling(
        `${API_BASE_URL}/api/upload/finalize`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file_id, etag, file_name: file.name, model_id: targetModelId ?? null }),
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
        const resolved = await waitForSpeckleIngestion(speckle.ingestion_id, onProgress);
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

  // ─── TTS language / dialects (backend routers/tts_voices.py) ──────────────

  /** Voice-library accents + the caller's custom dialect voices. */
  async listTtsDialects(): Promise<TtsDialectsResponse> {
    const response = await fetchWithErrorHandling(`${API_BASE_URL}/api/tts/dialects`, undefined, 'TTS dialects');
    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: 'Failed to load TTS dialects' }));
      throw new Error(err.detail || 'Failed to load TTS dialects');
    }
    return response.json();
  },

  /** Resolve free-text TTS language ("Swiss German") against the backend lists. */
  async resolveTtsLanguage(text: string): Promise<TtsLanguageMatch> {
    const response = await fetchWithErrorHandling(
      `${API_BASE_URL}/api/tts/resolve-language`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      },
      'Resolve TTS language'
    );
    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: 'Failed to resolve TTS language' }));
      throw new Error(err.detail || 'Failed to resolve TTS language');
    }
    return response.json();
  },

  /** Start creating a female + male custom voice for a dialect (job — poll via getTtsCustomVoiceJob). */
  async createTtsCustomVoice(data: TtsCustomVoiceCreateRequest): Promise<{ job_id: string }> {
    const response = await fetchWithErrorHandling(
      `${API_BASE_URL}/api/tts/custom-voices`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      },
      'Create custom voice'
    );
    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: 'Failed to create custom voice' }));
      throw new Error(err.detail || 'Failed to create custom voice');
    }
    return response.json();
  },

  /** Poll a custom-voice creation job (unified /api/jobs/{id}). */
  async getTtsCustomVoiceJob(jobId: string): Promise<{
    completed: boolean;
    cancelled: boolean;
    error: string | null;
    progress: number;
    status: string;
    result: TtsCustomVoice[] | null;
  }> {
    const job = await getUnifiedJobStatus(jobId);
    const legacy = toLegacyJobStatus(job);
    return { ...legacy, result: Array.isArray(job.result) ? (job.result as TtsCustomVoice[]) : null };
  },

  async listTtsCustomVoices(): Promise<TtsCustomVoice[]> {
    const response = await fetchWithErrorHandling(`${API_BASE_URL}/api/tts/custom-voices`, undefined, 'Custom voices');
    if (!response.ok) return [];
    return response.json();
  },

  async deleteTtsCustomVoice(voiceId: string): Promise<void> {
    const response = await fetchWithErrorHandling(
      `${API_BASE_URL}/api/tts/custom-voices/${encodeURIComponent(voiceId)}`,
      { method: 'DELETE' },
      'Delete custom voice'
    );
    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: 'Failed to delete custom voice' }));
      throw new Error(err.detail || 'Failed to delete custom voice');
    }
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

  // FX post-processing (noise reduction / trim silence) — DSP only, no calibration.
  // Used by the FX panel's server-rendered post-effect stages.
  async postProcessAudio(
    audioBlob: Blob,
    options: { noiseReduction?: boolean; reduction?: number; trimSilence?: boolean } = {}
  ): Promise<{ url: string }> {
    try {
      const formData = new FormData();
      formData.append('audio', audioBlob, 'audio.wav');
      formData.append('apply_noise_reduction', (options.noiseReduction ?? false).toString());
      if (options.reduction !== undefined) {
        formData.append('noise_reduction_strength', options.reduction.toString());
      }
      formData.append('trim_silence', (options.trimSilence ?? false).toString());

      const response = await fetchWithErrorHandling(
        `${API_BASE_URL}/api/audio/post-process`,
        { method: 'POST', body: formData },
        'Audio post-processing'
      );

      if (!response.ok) {
        const err = await response.json().catch(() => ({ detail: 'Post-processing failed' }));
        throw new Error(err.detail || 'Post-processing failed');
      }

      return await response.json();
    } catch (error) {
      handleApiError(error, 'Audio post-processing');
    }
  },

  // Stable Audio 3 transform (FX restyle / inpaint / extend) — queued GPU job.
  async stableAudioTransform(
    audioBlob: Blob,
    params: {
      mode: string;
      prompt: string;
      negativePrompt: string;
      strength: number;
      steps: number;
      cfgScale: number;
      seed: number;
      duration: number;
      regions: [number, number][];
      durationPaddingSec: number;
      samplerType: string;
    }
  ): Promise<{ job_id: string; position: number; total: number }> {
    try {
      const formData = new FormData();
      formData.append('audio', audioBlob, 'source.wav');
      formData.append('mode', params.mode);
      formData.append('prompt', params.prompt);
      formData.append('negative_prompt', params.negativePrompt);
      formData.append('strength', params.strength.toString());
      formData.append('steps', params.steps.toString());
      formData.append('cfg_scale', params.cfgScale.toString());
      formData.append('seed', params.seed.toString());
      formData.append('duration', params.duration.toString());
      formData.append('regions', JSON.stringify(params.regions));
      formData.append('duration_padding_sec', params.durationPaddingSec.toString());
      formData.append('sampler_type', params.samplerType);

      const response = await fetchWithErrorHandling(
        `${API_BASE_URL}/api/stable-audio/transform`,
        { method: 'POST', body: formData },
        'Stable Audio transform'
      );
      if (!response.ok) {
        const err = await response.json().catch(() => ({ detail: 'Stable Audio transform failed' }));
        if (response.status === 429) throw new Error(JOB_LIMIT_MESSAGE);
        throw new Error(err.detail || 'Stable Audio transform failed');
      }
      return await response.json();
    } catch (error) {
      handleApiError(error, 'Stable Audio transform');
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

  /**
   * Clone a scenario file under a new id, for a duplicated sound scene — so
   * re-running foley / orchestration on the copy never touches the original.
   */
  async duplicateScenario(scenarioId: string): Promise<{ scenario_id: string }> {
    const response = await fetchWithErrorHandling(
      `${API_BASE_URL}/api/scenarios/${encodeURIComponent(scenarioId)}/duplicate`,
      { method: 'POST' },
      'Duplicate scenario'
    );
    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: 'Failed to duplicate scenario' }));
      throw new Error(err.detail || 'Failed to duplicate scenario');
    }
    return response.json();
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
    objectScattering?: Record<string, number>,
    meshSettings?: SimulationMeshSettings,
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
      if (meshSettings) formData.append('mesh_settings', JSON.stringify(meshSettings));

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

  // ─── Simulation geometry preflight ─────────────────────────────────────────

  /**
   * Enqueue a geometry preflight: the backend prepares the exact simulation
   * mesh (weld, air-side orientation, two-sided detection, merge) and analyses
   * it. Returns the job id; poll with getSimulationPreflightStatus().
   */
  async runSimulationPreflight(params: {
    engine: SimulationEngine;
    projectId: string;
    /** Loaded Speckle version id (a bare model id resolves to the latest version). */
    versionId: string;
    objectMaterials: Record<string, string>;
    layerName: string;
    geometryObjectIds?: string[];
    objectScattering?: Record<string, number>;
    sourceReceiverPairs: Array<{
      source_position: number[];
      receiver_position: number[];
      source_id: string;
      receiver_id: string;
    }>;
    maxOrder?: number;
    rayTracing?: boolean;
    meshSettings: SimulationMeshSettings;
  }): Promise<{ job_id: string }> {
    const formData = new FormData();
    formData.append('engine', params.engine);
    formData.append('speckle_project_id', params.projectId);
    formData.append('speckle_version_id', params.versionId);
    formData.append('object_materials', JSON.stringify(params.objectMaterials));
    formData.append('layer_name', params.layerName);
    if (params.geometryObjectIds?.length) {
      formData.append('geometry_object_ids', JSON.stringify(params.geometryObjectIds));
    }
    formData.append('object_scattering', JSON.stringify(params.objectScattering ?? {}));
    formData.append('source_receiver_pairs', JSON.stringify(params.sourceReceiverPairs));
    if (params.maxOrder !== undefined) formData.append('max_order', String(params.maxOrder));
    if (params.rayTracing !== undefined) formData.append('ray_tracing', String(params.rayTracing));
    formData.append('mesh_settings', JSON.stringify(params.meshSettings));

    const response = await fetchWithErrorHandling(
      `${API_BASE_URL}/api/simulation/preflight-speckle`,
      { method: 'POST', body: formData },
      'Run geometry preflight'
    );
    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: 'Geometry check failed' }));
      throw new Error(err.detail || 'Geometry check failed');
    }
    return response.json();
  },

  /** Poll a geometry preflight job (unified GET /api/jobs/{id}). */
  async getSimulationPreflightStatus(jobId: string): Promise<{
    progress: number;
    status: string;
    completed: boolean;
    cancelled: boolean;
    error: string | null;
    result: PreflightJobResult | null;
  }> {
    const job = await getUnifiedJobStatus(jobId);
    return toLegacyJobStatus(job);
  },

  /** Fetch the preview payload of a finished preflight. */
  async getSimulationPreflightPayload(preflightId: string): Promise<PreflightPayload> {
    const response = await fetchWithErrorHandling(
      `${API_BASE_URL}/api/simulation/preflight/${preflightId}`,
      undefined,
      'Load geometry preview'
    );
    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: 'Geometry preview not found' }));
      throw new Error(err.detail || 'Geometry preview not found');
    }
    return response.json();
  },

  async cancelSimulationPreflight(jobId: string): Promise<void> {
    await cancelUnifiedJob(jobId);
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

  // ─── PFFDTD (wave-based GPU FDTD) API Methods ───────────────────────────

  /** Whether this deployment can run PFFDTD (env + built engine). */
  async getPffdtdStatus(): Promise<PffdtdStatus> {
    const response = await fetchWithErrorHandling(
      `${API_BASE_URL}/api/pffdtd/status`,
      undefined,
      'PFFDTD status'
    );
    if (!response.ok) throw new Error('Failed to get PFFDTD status');
    return response.json();
  },

  /**
   * Enqueue a wave-based simulation on the PFFDTD worker. Returns the unified
   * job id; poll with getPffdtdSimulationStatus().
   */
  async runPffdtdSimulationSpeckle(
    request: SimulationGeometryRequest,
    simulationName: string,
    settings: PffdtdSettings,
    meshSettings?: SimulationMeshSettings,
  ): Promise<{ job_id: string; position: number; total: number }> {
    const formData = pffdtdGeometryForm(request, meshSettings);
    formData.append('simulation_name', simulationName);
    formData.append('simulation_mode', settings.simulation_mode);
    formData.append('fmax', String(settings.fmax));
    formData.append('ppw', String(settings.ppw));
    formData.append('duration', String(settings.duration));
    formData.append('air_absorption', String(settings.air_absorption));
    formData.append('free_mode', settings.free_mode);
    formData.append('free_grid_spacing', String(settings.free_grid_spacing));

    const response = await fetchWithErrorHandling(
      `${API_BASE_URL}/api/pffdtd/run-simulation-speckle`,
      { method: 'POST', body: formData },
      'Run wave-based simulation'
    );
    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: 'Wave-based simulation failed' }));
      throw new Error(err.detail || 'Wave-based simulation failed');
    }
    return response.json();
  },

  /** Poll a wave-based simulation (unified GET /api/jobs/{id}). */
  async getPffdtdSimulationStatus(jobId: string): Promise<{
    progress: number;
    status: string;
    completed: boolean;
    cancelled: boolean;
    error: string | null;
    result: PffdtdJobResult | null;
    partial: PffdtdJobPartial | null;
    queue_position: number | null;
    queue_total: number | null;
  }> {
    const job = await getUnifiedJobStatus(jobId);
    return toLegacyJobStatus(job);
  },

  async cancelPffdtdSimulation(jobId: string): Promise<void> {
    await cancelUnifiedJob(jobId);
  },

  /**
   * Generate the wave animation of a finished wave-based run on the horizontal
   * plane at `planeZ` (GPU job on the run's kept voxel grid). Poll with
   * getPffdtdAnimationStatus(); the results JSON `field` block then holds the frames.
   */
  async runPffdtdAnimation(
    simulationId: string,
    planeZ: number,
    animationMs: number,
  ): Promise<{ job_id: string; position: number; total: number }> {
    const formData = new FormData();
    formData.append('simulation_id', simulationId);
    formData.append('plane_z', String(planeZ));
    formData.append('animation_ms', String(animationMs));
    const response = await fetchWithErrorHandling(
      `${API_BASE_URL}/api/pffdtd/animation`,
      { method: 'POST', body: formData },
      'Generate wave animation'
    );
    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: 'Failed to start the wave animation' }));
      throw new Error(err.detail || 'Failed to start the wave animation');
    }
    return response.json();
  },

  /** Poll a wave-animation job (unified GET /api/jobs/{id}). */
  async getPffdtdAnimationStatus(jobId: string): Promise<{
    progress: number;
    status: string;
    completed: boolean;
    cancelled: boolean;
    error: string | null;
    result: PffdtdAnimationJobResult | null;
    queue_position: number | null;
    queue_total: number | null;
  }> {
    const job = await getUnifiedJobStatus(jobId);
    return toLegacyJobStatus(job);
  },

  async cancelPffdtdAnimation(jobId: string): Promise<void> {
    await cancelUnifiedJob(jobId);
  },

  /** One IR WAV of a wave-based simulation. */
  async getPffdtdIRFile(simulationId: string, irFilename: string): Promise<Blob> {
    const response = await fetchWithErrorHandling(
      `${API_BASE_URL}/api/pffdtd/get-result-file/${simulationId}/wav?ir_filename=${encodeURIComponent(irFilename)}`,
      undefined,
      'Get wave-based IR file'
    );
    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: 'Failed to retrieve IR file' }));
      throw new Error(err.detail || 'Failed to retrieve IR file');
    }
    return response.blob();
  },

  /**
   * IRs of a moved free listener / source of a free-positioning run (the nearest
   * grid point's, one per fixed source or listener). Latest request per
   * `objectId` wins; pass an AbortSignal to cancel a superseded one.
   */
  async getPffdtdFreeIR(
    simulationId: string,
    objectId: string,
    position: [number, number, number],
    signal?: AbortSignal,
  ): Promise<{ ok: true; data: PffdtdFreeIRResponse } | { ok: false; failure: PffdtdFreeIRFailure; message: string }> {
    const response = await fetchWithErrorHandling(
      `${API_BASE_URL}/api/pffdtd/free-ir`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ simulation_id: simulationId, object_id: objectId, position }),
        signal,
      },
      'Get free-positioning IR'
    );
    if (response.ok) return { ok: true, data: await response.json() };
    const err = await response.json().catch(() => ({ detail: null }));
    const detail = err.detail as { code?: string; message?: string } | string | null;
    const message = typeof detail === 'string' ? detail : detail?.message ?? 'Failed to derive the IR';
    if (response.status === 404) return { ok: false, failure: 'expired', message };
    if (response.status === 409 && typeof detail === 'object' && detail?.code === 'outside_grid') {
      return { ok: false, failure: 'outside_grid', message };
    }
    if (response.status === 409) return { ok: false, failure: 'superseded', message };
    return { ok: false, failure: 'error', message };
  },

  /** Candidate grid of a free-positioning run; null when expired (404). */
  async getPffdtdFreeGridPoints(simulationId: string): Promise<PffdtdFreeGridPoints | null> {
    const response = await fetchWithErrorHandling(
      `${API_BASE_URL}/api/pffdtd/free-grid/${simulationId}/points`,
      undefined,
      'Get free-positioning grid'
    );
    if (response.status === 404) return null;
    if (!response.ok) throw new Error('Failed to load the free-positioning grid');
    const buf = await response.arrayBuffer();
    const n = Math.floor(buf.byteLength / 13); // float32 xyz + uint8 valid per point
    return { positions: new Float32Array(buf, 0, 3 * n), valid: new Uint8Array(buf, 12 * n, n) };
  },

  /** Results JSON of a wave-based simulation (metrics + field block); null when expired. */
  async getPffdtdResults(simulationId: string): Promise<PffdtdResultsJson | null> {
    const response = await fetchWithErrorHandling(
      `${API_BASE_URL}/api/pffdtd/get-result-file/${simulationId}/json`,
      undefined,
      'Get wave-based results'
    );
    if (response.status === 404) return null;
    if (!response.ok) throw new Error('Failed to load wave-based results');
    return response.json();
  },

  /**
   * One binary field file (SPL map, animation frames, plane mask) of a
   * wave-based simulation. Returns null when the file has expired (404).
   */
  async getPffdtdFieldFile(simulationId: string, name: string): Promise<ArrayBuffer | null> {
    const response = await fetchWithErrorHandling(
      `${API_BASE_URL}/api/pffdtd/get-result-file/${simulationId}/field?name=${encodeURIComponent(name)}`,
      undefined,
      'Get wave-based field file'
    );
    if (response.status === 404) return null;
    if (!response.ok) throw new Error('Failed to load wave-based field data');
    return response.arrayBuffer();
  },

  /**
   * Enqueue a voxel preview (voxelisation only, no solve) of the card's
   * geometry at the given grid settings. Poll with getPffdtdVoxelPreviewStatus().
   */
  async runPffdtdVoxelPreview(
    request: SimulationGeometryRequest,
    grid: { fmax: number; ppw: number },
    meshSettings?: SimulationMeshSettings,
  ): Promise<{ job_id: string; position: number; total: number }> {
    const formData = pffdtdGeometryForm(request, meshSettings);
    formData.append('fmax', String(grid.fmax));
    formData.append('ppw', String(grid.ppw));
    const response = await fetchWithErrorHandling(
      `${API_BASE_URL}/api/pffdtd/voxel-preview`,
      { method: 'POST', body: formData },
      'Run voxel preview'
    );
    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: 'Voxel preview failed' }));
      throw new Error(err.detail || 'Voxel preview failed');
    }
    return response.json();
  },

  /** Poll a voxel-preview job (unified GET /api/jobs/{id}). */
  async getPffdtdVoxelPreviewStatus(jobId: string): Promise<{
    progress: number;
    status: string;
    completed: boolean;
    cancelled: boolean;
    error: string | null;
    result: PffdtdVoxelPreviewJobResult | null;
  }> {
    const job = await getUnifiedJobStatus(jobId);
    return toLegacyJobStatus(job);
  },

  async cancelPffdtdVoxelPreview(jobId: string): Promise<void> {
    await cancelUnifiedJob(jobId);
  },

  async getPffdtdVoxelPreview(previewId: string): Promise<PffdtdVoxelPreviewPayload> {
    const response = await fetchWithErrorHandling(
      `${API_BASE_URL}/api/pffdtd/voxel-preview/${previewId}`,
      undefined,
      'Load voxel preview'
    );
    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: 'Voxel preview not found' }));
      throw new Error(err.detail || 'Voxel preview not found');
    }
    return response.json();
  },

  /** Boundary-node points: float32 xyz [3·n] followed by uint8 material index [n]. */
  async getPffdtdVoxelPoints(previewId: string, nPoints: number): Promise<PffdtdVoxelPoints> {
    const response = await fetchWithErrorHandling(
      `${API_BASE_URL}/api/pffdtd/voxel-preview/${previewId}/points`,
      undefined,
      'Load voxel points'
    );
    if (!response.ok) throw new Error('Voxel points not found');
    const buffer = await response.arrayBuffer();
    const xyzBytes = nPoints * 3 * Float32Array.BYTES_PER_ELEMENT;
    if (buffer.byteLength < xyzBytes + nPoints) throw new Error('Voxel points file is truncated');
    return {
      positions: new Float32Array(buffer, 0, nPoints * 3),
      materials: new Uint8Array(buffer, xyzBytes, nPoints),
    };
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
   * Version history of a model, newest first (one entry per user-visible
   * version; ids are always viewer-loadable). Read-only.
   */
  async getModelVersions(modelId: string): Promise<SpeckleModelVersionsResponse> {
    const response = await fetchWithErrorHandling(
      `${API_BASE_URL}/api/speckle/models/${encodeURIComponent(modelId)}/versions`,
      undefined,
      'Get model versions'
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Failed to get model versions' }));
      throw new Error(error.detail || 'Failed to get model versions');
    }

    return response.json();
  },

  /**
   * What changed between two versions of the open model above tolerance, scoped
   * to the acoustic region, plus listeners / free sounds now misplaced.
   */
  async getModelVersionImpact(request: ModelVersionImpactRequest): Promise<ModelVersionImpactReport> {
    const response = await fetchWithErrorHandling(
      `${API_BASE_URL}/api/speckle/version-impact`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      },
      'Compare model versions'
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Failed to compare model versions' }));
      throw new Error(error.detail || 'Failed to compare model versions');
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
   * Copy sound scenes from a saved model into another model of the active
   * workspace (owner-only). The source must be saved first — the backend reads
   * its soundscape.json. Throws an Error with `.conflictRevision` on 409.
   */
  async sendScenesToModel(sourceModelId: string, request: SendScenesRequest): Promise<SendScenesResponse> {
    const response = await fetchWithErrorHandling(
      `${API_BASE_URL}/api/speckle/soundscape/${encodeURIComponent(sourceModelId)}/send-scenes`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      },
      'Send scenes to model'
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Failed to send scenes' }));
      const detail = error.detail;
      if (response.status === 409 && detail && typeof detail === 'object') {
        const conflict = new Error(detail.message || 'This workspace changed since you last loaded it.');
        (conflict as Error & { conflictRevision?: number }).conflictRevision = detail.revision;
        throw conflict;
      }
      throw new Error(typeof detail === 'string' ? detail : 'Failed to send scenes');
    }

    return response.json();
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
   * Probe whether a saved soundscape exists for a model in a workspace.
   * Lightweight — does not load/restore files or auto-join. Used by the
   * invite flow to detect a collision with the recipient's own soundscape.
   */
  async soundscapeExists(modelId: string, workspaceId?: string | null): Promise<{ found: boolean; workspace_id: string | null }> {
    try {
      const qs = workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : '';
      const response = await fetchWithErrorHandling(
        `${API_BASE_URL}/api/speckle/soundscape/${encodeURIComponent(modelId)}/exists${qs}`,
        undefined,
        'Check soundscape exists'
      );
      if (!response.ok) return { found: false, workspace_id: workspaceId ?? null };
      return response.json();
    } catch {
      return { found: false, workspace_id: workspaceId ?? null };
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

  /**
   * Publish a job's card mapping (model id, config ids, …) so other members of
   * the shared workspace can reattach it to the right cards. Best-effort.
   */
  async setJobClientMeta(jobId: string, meta: NonNullable<JobRecord['meta']>): Promise<void> {
    try {
      await fetchWithErrorHandling(
        `${API_BASE_URL}/api/jobs/${jobId}/meta`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ meta }),
        },
        'Job meta',
      );
    } catch {
      // Non-critical — only other members' recovery depends on it.
    }
  },

  /**
   * List every job for the caller's workspace (scoped by session cookie).
   * Used on page load to reattach to work started before the window closed,
   * even when local storage has been cleared or the app is opened elsewhere.
   */
  async getActiveJobs(): Promise<ActiveJob[]> {
    // Backend job type names differ from the frontend JobType union for pyroom
    // and the Stable Audio 3 lane (its own queue, but polled as a sound job).
    const mapBackendType = (type: string): JobType | null => {
      switch (type) {
        case 'sa3':
          return 'sound';
        case 'sound':
        case 'tts':
        case 'sed':
        case 'llm':
        case 'loop':
          return type;
        case 'pyroomacoustics':
          return 'pyroom';
        case 'pffdtd':
          return 'pffdtd';
        default:
          return null;
      }
    };
    try {
      const response = await fetchWithErrorHandling(
        `${API_BASE_URL}/api/jobs`,
        undefined,
        'Active jobs'
      );
      if (!response.ok) return [];
      const jobs = await response.json();
      if (!Array.isArray(jobs)) return [];
      const out: ActiveJob[] = [];
      for (const j of jobs as UnifiedJobStatus[]) {
        const jobType = mapBackendType(j.type);
        if (!jobType) continue;
        out.push({
          jobId: j.job_id,
          jobType,
          status: j.status,
          result: j.result ?? null,
          meta: j.client_meta ?? undefined,
          createdMs: j.created ? j.created * 1000 : null,
        });
      }
      return out;
    } catch {
      return [];
    }
  },
};
