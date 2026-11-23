/**
 * Scene Edit Chat Types
 *
 * A per-scene chat that edits a generated sound scene: the user asks for a change,
 * the edit agent (POST /api/scene-edit) answers with typed ops, the app applies them.
 * Mirrors backend/models/schemas.py (SceneEditOp, SceneEditSnapshot, SceneEditResult).
 */

export type SceneEditOpName =
  // mix
  | 'set_level' | 'mute' | 'unmute' | 'solo' | 'unsolo' | 'set_loopable' | 'trim'
  // timing
  | 'set_times' | 'shift' | 'set_density' | 'remove_occurrences' | 'set_scene_duration'
  // space
  | 'move' | 'set_directivity'
  // content
  | 'add_sound' | 'remove' | 'change_sound' | 'regenerate' | 'set_variants'
  // speech
  | 'add_speaker' | 'edit_lines' | 'change_voice'
  // scene
  | 'rename_scene';

/** One edit operation (flat: `op` + the fields it uses; see backend SceneEditOp). */
export interface SceneEditOp {
  op: SceneEditOpName;
  targets: string[];
  new_ref: string;
  db: number | null;
  delta_db: number | null;
  on: boolean | null;
  start: number | null;
  end: number | null;
  times_s: number[];
  delta_s: number | null;
  count: number | null;
  interval_s: number | null;
  seconds: number | null;
  anchor_objects: string[];
  near: string;
  position: number[];
  preset: string;
  yaw_deg: number | null;
  name: string;
  prompt: string;
  category: string;
  duration_s: number | null;
  character: string;
  lines: string[];
  title: string;
}

/** Job result of POST /api/scene-edit. */
export interface SceneEditResult {
  kind: 'scene_edit';
  reply: string;
  ops: SceneEditOp[];
  warnings: string[];
}

/** A sound card as the edit agent sees it. */
export interface SceneEditSnapshotCard {
  ref: string;
  kind: 'foley' | 'speech';
  name: string;
  category: string;
  prompt: string;
  lines: string[];
  character: string;
  times_s: number[];
  level_db: number | null;
  muted: boolean;
  soloed: boolean;
  loopable: boolean;
  variants: number;
  duration_s: number | null;
  position: number[];
  anchors: string[];
  directivity: string;
  generated: boolean;
}

/** A model-analysis object group the agent may anchor sounds to. */
export interface SceneEditSnapshotObject {
  ref: string;
  name: string;
  description: string;
  center: number[];
  extent: number[];
}

export interface SceneEditBounds {
  min: [number, number, number];
  max: [number, number, number];
}

/** Compact scene state sent to the edit agent. */
export interface SceneEditSnapshot {
  title: string;
  prompt: string;
  scenario: string;
  duration_s: number;
  people: string;
  language: string;
  room: SceneEditBounds | null;
  space_title: string;
  cards: SceneEditSnapshotCard[];
  objects: SceneEditSnapshotObject[];
  directivity_presets: string[];
}

/** Snapshot refs → live identities (card config_id, object group center/bounds). */
export interface SceneEditRefMap {
  /** "S1" → sound card config_id. */
  cards: Record<string, string>;
  /** "O1" → object group center [x, y, z]. */
  objects: Record<string, [number, number, number]>;
}

/** Body of POST /api/scene-edit. */
export interface SceneEditRequestBody {
  instruction: string;
  snapshot: SceneEditSnapshot;
  history: { role: 'user' | 'assistant'; text: string }[];
  llm_model: string;
}

/** Status of one assistant message (the turn it answers). */
export type SceneChatMessageStatus = 'pending' | 'applied' | 'partial' | 'failed' | 'cancelled';

export interface SceneChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: number;
  /** Assistant: short labels of the applied ops ("Background −6 dB"). */
  changes?: string[];
  /** Assistant: ops dropped or adjusted (backend normalisation + apply). */
  warnings?: string[];
  status?: SceneChatMessageStatus;
}

/** Phase of a running chat turn (runtime only). */
export type SceneEditPhase = 'planning' | 'applying' | 'generating' | 'orchestrating';

/** Runtime state of a scene's chat turn (sceneEditStore). */
export interface SceneEditTurn {
  turnId: string;
  phase: SceneEditPhase;
  jobId: string | null;
  /** Live LLM thought summary while planning. */
  thinking: string;
  /** One-line status for the phase ("Generating 3 sounds…"). */
  status: string;
}
