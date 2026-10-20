/**
 * Research-study interaction logging types — mirror the `Study*` schemas in
 * backend/models/schemas.py (routers/study.py). Identity (user / workspace) is
 * never sent by the client: the backend stamps it from the session.
 */

/** JSON-safe value produced by the study sanitiser (no class instances / refs). */
export type StudyJson =
  | string
  | number
  | boolean
  | null
  | StudyJson[]
  | { [key: string]: StudyJson };

export type StudyPayload = { [key: string]: StudyJson };

/** Risk-gated features — each can be switched off server-side (kill switch). */
export interface StudyFeatures {
  snapshots: boolean;
  state_diff: boolean;
  pose_sampling: boolean;
  audio_archive: boolean;
  moment_screenshot: boolean;
}

/** `GET /api/study/config` (404 when study logging is disabled). */
export interface StudyConfig {
  enabled: boolean;
  /** Participant id shown to the student for the external SUS form (e.g. "P07"). */
  pseudonym: string | null;
  flush_interval_ms: number;
  max_batch_events: number;
  features: StudyFeatures;
}

/** One logged event, as sent in `POST /api/study/events`. */
export interface StudyEvent {
  id: string;
  type: string;
  ts_client: number;
  seq: number;
  tab_session_id: string;
  model_id: string | null;
  version_id: string | null;
  ui_mode: string | null;
  payload: StudyPayload;
}

export interface StudyEventBatch {
  events: StudyEvent[];
}

export interface StudySnapshotUpload {
  /** Client content hash (cyrb53 hex) — events reference snapshots by it. */
  hash: string;
  json: string;
}

export interface StudyMomentCreate {
  event_id: string;
  /** JPEG data URL captured when the student clicked, or null. */
  screenshot: string | null;
  snapshot_hash: string | null;
  ts_client: number;
}

export interface StudyMomentNote {
  note: string;
  tags: string[];
}

/** Where the listener is when a listening session starts. */
export type StudyListenerKind = 'free_camera' | 'receiver' | 'grid_point';

export interface StudyListenerState {
  kind: StudyListenerKind;
  id: string | null;
  position: [number, number, number] | null;
  orientation: { yaw: number; pitch: number; roll: number } | null;
}

/** Pending design-intent question (version upload or first import). */
export type StudyIntentKind = 'version' | 'initial';

export interface StudyIntentPrompt {
  kind: StudyIntentKind;
  fromVersionId: string | null;
  toVersionId: string | null;
  modelId: string | null;
  startedAt: number;
}

export type StudyPromptedByListening = 'yes' | 'partly' | 'no';
