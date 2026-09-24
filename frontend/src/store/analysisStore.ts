/**
 * Analysis Store
 *
 * Replaces useAnalysis. Manages analysis configurations and results for the
 * Analysis section (3D Model, Audio, Text context cards).
 *
 * zundo partializes on analysisConfigs and activeAnalysisTab.
 */

import { create } from 'zustand';
import { temporal } from 'zundo';
import { devtools } from 'zustand/middleware';
import type {
  AnalysisConfig,
  AnalysisResult,
  TextPromptResult,
  AudioAnalysisConfig,
  TextAnalysisConfig,
  AnalyzeModelConfig,
  AnalysisBaseConfig,
  ArchitecturalObject,
  ModelAnalysisResultData,
  ScenarioConfig,
  ScenarioResult,
  FoleyResult,
  SpeechResult,
  FreeformConfig,
} from '@/types/analysis';
import type { CardType } from '@/types/card';
import {
  API_BASE_URL,
  DEFAULT_DBFS,
  DBFS_MIN,
  LLM_JOB_STATUS_MISS_TOLERANCE,
  LLM_SUGGESTED_INTERVAL_SECONDS,
  SED_MIN_CONFIDENCE,
  SED_TOP_N_CLASSES,
  TTS_VOICES,
  resolveVoiceForCharacter,
} from '@/utils/constants';
import { loadAudioFileWithBuffer } from '@/lib/audio/utils/audio-info';
import { apiService } from '@/services/api';
import { startPolling, createPollRegistry } from '@/lib/poll-until-done';
import { recordInflightJob, removeInflightJob } from '@/lib/job-tracker';
import { generatePositionsInArea, generatePositionsInBounds } from '@/utils/positioning';
import { getAnalysisGroupColor } from '@/utils/utils';
import { notifySectionError } from './errorsStore';
import { useAreaDrawingStore } from './areaDrawingStore';
import { useSoundscapeStore } from './soundscapeStore';
import { useAudioControlsStore } from './audioControlsStore';
import { useSpeckleStore } from './speckleStore';
import { useUIStore } from './uiStore';
import { useFileUploadStore } from './fileUploadStore';

// ─── Module-level refs ────────────────────────────────────────────────────────

let _analysisAbortController: AbortController | null = null;
let _sedTaskId: string | null = null;
let _sedPollInterval: ReturnType<typeof setInterval> | null = null;
const llmPollRegistry = createPollRegistry();
const _llmJobIds = new Set<string>();

// Upload token used only as a URL path segment for the session-scoped
// soundscape audio endpoint — the backend writes to the session's audio dir
// regardless of the token value, so no real model needs to be loaded yet.
const AUDIO_CONTEXT_PERSIST_MODEL_TOKEN = '__audio-context__';

// ─── SSE helper ───────────────────────────────────────────────────────────────

/**
 * Async generator over a POST SSE endpoint.
 * Yields each parsed JSON event object. Stops on `[DONE]` or stream end.
 * Throws on HTTP error or `{type: "error"}` event.
 */
async function* streamPrompts(
  url: string,
  body: object,
  signal: AbortSignal,
): AsyncGenerator<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Failed to generate sound prompts' }));
    const msg = err.detail || 'Failed to generate sound prompts';
    if (res.status === 429) {
      throw new Error(msg.includes('quota') ? `⚠️ ${msg}` : '⚠️ API quota exhausted. Please try again later.');
    }
    throw new Error(msg);
  }

  if (!res.body) throw new Error('No response body from stream endpoint');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Split on SSE double-newline event boundaries
      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';

      for (const block of parts) {
        const dataLine = block.split('\n').find((l) => l.startsWith('data: '));
        if (!dataLine) continue;
        const data = dataLine.slice(6).trim();
        if (data === '[DONE]') return;
        const event = JSON.parse(data);
        if (event.type === 'error') throw new Error(event.message);
        yield event;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

interface LlmPartial {
  kind?: string;
  thinking?: string;
  phase?: string;
  items?: unknown[];
  analysis_id?: string;
  space_title?: string;
  space_description?: string;
}

async function pollLlmJob(
  path: string,
  body: object,
  configIndex: number,
  kind: string,
  onPartial?: (partial: LlmPartial) => void,
): Promise<any> {
  const { job_id } = await apiService.enqueueLlmJob(path, body);
  recordInflightJob(job_id, 'llm', { configIndex, kind });
  _llmJobIds.add(job_id);
  // A momentary status miss (getJobStatus resolves with the
  // "Job not found or expired" sentinel on ANY fetch error) must not abort the
  // poll — the in-process job is still running server-side. Tolerate a run of
  // consecutive misses before letting the poll fail; any real status resets it.
  let consecutiveMisses = 0;
  const controller = startPolling({
    fetchStatus: async () => {
      const s = await apiService.getJobStatus('llm', job_id);
      if (s.error === 'Job not found or expired') {
        consecutiveMisses += 1;
        if (consecutiveMisses < LLM_JOB_STATUS_MISS_TOLERANCE) {
          return { ...s, error: null, status: s.status || 'unknown' };
        }
      } else {
        consecutiveMisses = 0;
      }
      return s;
    },
    onStatus: (s) => {
      useAnalysisStore.setState({
        analysisStatus: s.status || '',
        analysisProgress: typeof s.progress === 'number' ? s.progress : 0,
      });
      if (s.partial && onPartial) onPartial(s.partial as LlmPartial);
    },
  });
  llmPollRegistry.track(controller);
  try {
    return await controller.done;
  } finally {
    llmPollRegistry.release(controller);
    _llmJobIds.delete(job_id);
    removeInflightJob(job_id);
  }
}

// ─── Partialize ───────────────────────────────────────────────────────────────

export const analysisPartialize = (state: AnalysisStoreState) => ({
  analysisConfigs: state.analysisConfigs.map((config) => {
    // Omit non-serializable objects (File, ArrayBuffer) from undo history
    if (config.type === 'audio') {
      // Store audioFile as null so code never tries to use it as a Blob after undo
      return { ...config, audioFile: null, audioBuffer: null };
    }
    if (config.type === 'model-analysis') {
      return { ...config, liveScreenshots: [], liveScreenshotFilenames: [] };
    }
    if (config.type === 'scenario') {
      // Don't persist streaming state in undo history
      return { ...config, scenarioRawText: '', speechResult: null, speechId: null, orchestrateResult: null, orchestrateId: null };
    }
    return config;
  }),
  activeAnalysisTab: state.activeAnalysisTab,
  // Include analysisResults so prompt checkbox selections are tracked in undo history
  analysisResults: state.analysisResults,
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractSpeckleEntities(worldTree: any): any[] {
  const entities: any[] = [];
  if (!worldTree) return entities;

  let nodeIndex = 0;
  let processedCount = 0;

  const processNode = (node: any, parentLayer: string = '', ancestorIds: string[] = []) => {
    if (!node) return;
    processedCount++;

    const hasRenderView = node.model?.renderView || node.renderView;
    const raw = node.raw || node.model?.raw || {};

    const id = raw.id || node.model?.id || node.id || `node-${nodeIndex}`;
    const speckleType = raw.speckle_type || raw.speckle?.type || 'Object';
    // Only treat an explicit name (not the speckle_type fallback) as a layer signal
    const explicitName = raw.name || node.model?.name || null;
    const name = explicitName || extractNameFromType(speckleType);

    const isGeometry = !!(hasRenderView || raw.speckle_type);

    // Collection/Layer nodes set the layer context for their descendants. They
    // carry raw.speckle_type (so isGeometry is true), so we must detect them by
    // type — not by "absence of geometry" — otherwise the layer never propagates.
    const isContainer = speckleType.includes('Collection') || speckleType.includes('Layer');
    const currentLayer = isContainer && explicitName ? explicitName : parentLayer;

    // ─── DIAGNOSTIC: trace the "Backwall" subtree during extraction ──────────
    const _inBackwall =
      String(parentLayer).toLowerCase().includes('backwall') ||
      String(explicitName ?? '').toLowerCase().includes('backwall') ||
      String(raw.layer ?? '').toLowerCase().includes('backwall');
    if (_inBackwall) {
      console.log('[extractEntities][TRACE backwall]', {
        name,
        explicitName,
        speckleType,
        isGeometry,
        parentLayer,
        currentLayer,
        rawLayer: raw.layer,
        ids: {
          'raw.id': raw.id,
          'model.id': node.model?.id,
          'node.id': node.id,
          applicationId: raw.applicationId,
        },
        childCount: (node.model?.children || node.children || []).length,
      });
    }

    if (isGeometry) {
      const nodeBounds =
        raw.bounds ||
        node.model?.bounds ||
        raw.bbox ||
        node.model?.renderView?.aabb ||
        (hasRenderView as any)?.aabb;

      let boundsData: { min: number[]; max: number[]; center: number[] } | undefined;
      if (nodeBounds) {
        const min = nodeBounds.min
          ? [
              nodeBounds.min.x ?? nodeBounds.min[0],
              nodeBounds.min.y ?? nodeBounds.min[1],
              nodeBounds.min.z ?? nodeBounds.min[2],
            ]
          : [0, 0, 0];
        const max = nodeBounds.max
          ? [
              nodeBounds.max.x ?? nodeBounds.max[0],
              nodeBounds.max.y ?? nodeBounds.max[1],
              nodeBounds.max.z ?? nodeBounds.max[2],
            ]
          : [0, 0, 0];
        const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
        boundsData = { min, max, center };
      }

      // Bounding box in the OBJECT form the backend expects (entity.get("bbox")
      // → {min:{x,y,z}, max:{x,y,z}}). raw.bbox is an unresolved Speckle reference
      // at this stage, so read it from the viewer's renderView.aabb.
      const aabb =
        node.model?.renderView?.aabb || (node.renderView as any)?.aabb || (hasRenderView as any)?.aabb;
      const bbox = aabb
        ? {
            min: { x: aabb.min.x, y: aabb.min.y, z: aabb.min.z },
            max: { x: aabb.max.x, y: aabb.max.y, z: aabb.max.z },
          }
        : undefined;

      // Best-effort per-entity material name (backend also falls back to this).
      const material =
        raw.renderMaterial?.name ||
        raw['@renderMaterial']?.name ||
        node.model?.renderView?.renderData?.renderMaterial?.name ||
        (typeof raw.properties?.material === 'string' ? raw.properties.material : undefined) ||
        undefined;

      entities.push({
        id,
        index: nodeIndex++,
        type: speckleType,
        name,
        // Prefer the raw layer property; fall back to the propagated parent layer.
        // Container nodes themselves carry no layer label.
        layer: raw.layer || (isContainer ? '' : currentLayer),
        material,
        speckle_type: speckleType,
        raw,
        nodeId: id,
        // The viewer's FilteringExtension reports WorldTree model.id values, which
        // differ from raw.id (content hash) for duplicated geometry. Keep both
        // (plus applicationId) so visibility/isolation matching can succeed.
        modelId: node.model?.id ?? null,
        applicationId: raw.applicationId ?? null,
        // IDs of every ancestor container/layer node (raw.id / model.id namespaces).
        // The viewer's hidden/isolated set reliably contains the layer node that was
        // hidden/isolated, so matching an entity via its ancestor chain captures the
        // whole layer subtree even when leaf-id enumeration is incomplete.
        ancestorIds,
        bbox,
        bounds: boundsData,
      });
    }

    const nodeCandidateIds = [raw.id, node.model?.id, node.id, raw.applicationId].filter(Boolean) as string[];
    const childAncestorIds = [...ancestorIds, ...nodeCandidateIds];
    const children = node.model?.children || node.children;
    if (children && Array.isArray(children)) children.forEach((child: any) => processNode(child, currentLayer, childAncestorIds));
  };

  try {
    if (worldTree.tree?._root?.children) {
      worldTree.tree._root.children.forEach((child: any) => processNode(child));
    } else if (worldTree._root?.children) {
      worldTree._root.children.forEach((child: any) => processNode(child));
    } else if (worldTree.root?.children) {
      worldTree.root.children.forEach((child: any) => processNode(child));
    } else if (worldTree.children) {
      worldTree.children.forEach((child: any) => processNode(child));
    }
  } catch (error) {
    console.error('[analysisStore] extractSpeckleEntities error:', error);
  }

  return entities;
}

function extractNameFromType(speckleType: string): string {
  if (!speckleType) return 'Object';
  const parts = speckleType.split('.');
  const typeName = parts[parts.length - 1] || speckleType;
  return typeName.replace(/([A-Z])/g, ' $1').trim();
}

/**
 * Resolve the model-analysis `analysis_id` from a card's PARENT context card only.
 * Multiple model-analysis cards may exist; we never fall back to another card —
 * a usage card either uses its own parent's analysis result or none at all.
 */
function resolveParentAnalysisId(
  config: AnalysisBaseConfig,
  configs: AnalysisConfig[],
): string | undefined {
  const parentIndex = config.parentContextOriginalIndex;
  if (parentIndex === undefined) return undefined;
  const parent = configs[parentIndex];
  if (parent?.type !== 'model-analysis') return undefined;
  return (parent as AnalyzeModelConfig).analysisResult?.analysisId ?? undefined;
}

/** Model bounding box used to distribute non-linked sounds when no area is drawn. */
function getModelBounds(): { min: [number, number, number]; max: [number, number, number] } | null {
  const speckleBounds = useUIStore.getState().speckleBounds;
  if (speckleBounds) return speckleBounds;
  const geometryBounds = useFileUploadStore.getState().geometryBounds;
  return geometryBounds ?? null;
}

// ─── State ────────────────────────────────────────────────────────────────────

export interface AnalysisStoreState {
  analysisConfigs: AnalysisConfig[];
  activeAnalysisTab: number;
  isAnalyzing: boolean;
  analysisError: string | null;
  analysisResults: AnalysisResult[];
  /** Indices of configs currently being uploaded. Not in zundo history. */
  uploadingConfigs: Set<number>;
  /** Indices of restored `audio` context configs whose saved source file is being
   *  re-fetched + decoded after a soundscape restore. Not in zundo history. */
  rehydratingAudioConfigs: Set<number>;
  /** Indices of restored `audio` context configs whose saved source file could NOT be
   *  reloaded (missing on the server, or decode failure). Not in zundo history. */
  audioRehydrateFailedConfigs: Set<number>;
  analysisStatus: string;
  analysisProgress: number;
  analyzingConfigIndex: number | null;

  handleAddConfig: (type: CardType, initialSpeckleData?: any) => void;
  handleRemoveConfig: (index: number) => void;
  handleUpdateConfig: (index: number, updates: Partial<AnalysisConfig>) => void;
  setActiveAnalysisTab: (index: number) => void;
  /** Find an existing freeform usage card linked to a context, or create one (idempotent). Returns its index.
   *  `displayName`, when provided, seeds the new card's title (ignored if a card already exists). */
  ensureUsageCardForContext: (contextIndex: number, displayName?: string) => number;

  handleAudioFileUpload: (index: number, file: File) => Promise<void>;
  /** Re-fetch + rebuild the File/buffer of audio context cards that were persisted with a
   *  `persistedAudioFilename`, so the SED waveform + detected-sounds results survive refresh. */
  rehydrateAudioContextSources: (audioBaseUrl: string) => Promise<void>;

  handleAnalyze: (index: number) => Promise<void>;
  handleStopAnalysis: () => void;

  handleReorderConfigs: (from: number, to: number) => void;
  /** Ctrl+drag duplicate — deep-clones the config at `from` (and its result) and inserts at `toInsertion`. */
  duplicateConfigAt: (from: number, toInsertion: number) => void;

  handleTogglePromptSelection: (configIndex: number, promptId: string) => void;
  handleSetAllPromptsSelected: (configIndex: number, selected: boolean) => void;
  handleSendToSoundGeneration: (onSuccess?: (prompts: TextPromptResult[]) => void, onlyConfigIndex?: number) => TextPromptResult[];
  /** Re-run the LLM inference for a text-based card with the same data, replacing its prompts. */
  handleRegenerateText: (index: number) => Promise<void>;
  handleReset: (index: number) => void;

  handleAnalyzeModel: (index: number) => Promise<void>;
  handleUpdateAnalysisObject: (
    configIndex: number,
    objectIndex: number,
    updates: Partial<Pick<ArchitecturalObject, 'name' | 'description' | 'material'>>,
  ) => Promise<void>;

  handleScenarioAnalyze: (index: number) => Promise<void>;
  handleFoleyArtist: (index: number) => Promise<void>;
  /**
   * Re-run the foley + speech agents for an already-sent scenario and replace its
   * child sound scene: deletes the linked sound configs (frontend) and their
   * generated audio files (backend), clears the previous foley/speech results,
   * then relaunches the agents. The caller is responsible for auto-sending the
   * new results to the Sounds step.
   */
  handleRefreshScenario: (index: number) => Promise<void>;
  handleToggleFoleySound: (index: number, key: string) => void;

  restoreAnalysisState: (state: {
    analysisConfigs: AnalysisConfig[];
    analysisResults: AnalysisResult[];
    activeTab: number;
  }) => void;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useAnalysisStore = create<AnalysisStoreState>()(
  temporal(
    devtools(
      (set, get) => ({
        analysisConfigs: [],
        activeAnalysisTab: 0,
        isAnalyzing: false,
        analysisError: null,
        analysisResults: [],
        uploadingConfigs: new Set<number>(),
        rehydratingAudioConfigs: new Set<number>(),
        audioRehydrateFailedConfigs: new Set<number>(),
        analysisStatus: '',
        analysisProgress: 0,
        analyzingConfigIndex: null,

        handleAddConfig: (type, initialSpeckleData) => {
          const { analysisConfigs } = get();
          const newConfig: AnalysisConfig =
            type === 'model-analysis'
              ? {
                  type: 'model-analysis',
                  numSounds: 5,
                  liveScreenshots: [],
                  liveScreenshotFilenames: [],
                  userContext: '',
                  modelEntities: [],
                  speckleData: initialSpeckleData,
                } as AnalyzeModelConfig
              : type === 'audio'
                ? {
                    type: 'audio',
                    numSounds: 5,
                    audioFile: null,
                    audioInfo: null,
                    audioBuffer: null,
                    analysisOptions: {
                      analyze_amplitudes: true,
                      analyze_durations: true,
                      analyze_frequencies: false,
                    },
                  }
                : type === 'scenario'
              ? ({
                  type: 'scenario',
                  numSounds: 5,
                  userContext: '',
                  peopleCount: 5,
                  likeliness: 9,
                  timelineDurationMs: useAudioControlsStore.getState().timelineDurationMs,
                  useAnalysisResult: true,
                  scenarioRawText: '',
                  scenarioResult: null,
                  scenarioId: null,
                  foleyResult: null,
                  selectedFoleyKeys: [],
                  speechResult: null,
                  speechId: null,
                  orchestrateResult: null,
                  orchestrateId: null,
                } as ScenarioConfig)
              : type === 'freeform'
              ? ({
                  type: 'freeform',
                  display_name: `Untitled ${analysisConfigs.filter(c => c.type === 'freeform').length + 1}`,
                } as FreeformConfig)
              : {
                    type: 'text',
                    numSounds: 5,
                    textInput: '',
                    useAnalysisResult: false,
                    drawnArea: null,
                  };

          set(
            { analysisConfigs: [...analysisConfigs, newConfig], activeAnalysisTab: analysisConfigs.length },
            false,
            'analysis/addConfig',
          );
        },

        ensureUsageCardForContext: (contextIndex, displayName) => {
          const { analysisConfigs } = get();
          const existing = analysisConfigs.findIndex(
            (c) => c.type === 'freeform' && (c as FreeformConfig).parentContextOriginalIndex === contextIndex,
          );
          if (existing >= 0) return existing;

          const newIndex = analysisConfigs.length;
          const newCard: AnalysisConfig = {
            type: 'freeform',
            display_name: displayName || 'Untitled usage',
            parentContextOriginalIndex: contextIndex,
          } as FreeformConfig;
          set(
            { analysisConfigs: [...analysisConfigs, newCard], activeAnalysisTab: newIndex },
            false,
            'analysis/ensureUsageCardForContext',
          );
          return newIndex;
        },

        handleRemoveConfig: (index) => {
          const { analysisConfigs, activeAnalysisTab, analysisResults } = get();
          const removed = analysisConfigs[index];
          if (!removed) return;

          // Card indices shift on removal — any stale preview reference must be cleared.
          useAudioControlsStore.getState().stopSoundcardPreview();

          const removedType = removed.type as CardType;
          const removedParent = (removed as AnalysisBaseConfig).parentContextOriginalIndex;
          const isContextCard =
            removedType === 'model-analysis' ||
            removedType === 'audio' ||
            (removedType === 'freeform' && removedParent === undefined);

          // Collect all analysis config indices to remove: the target card plus
          // any usage cards parented to it (parentContextOriginalIndex linkage).
          const removeSet = new Set<number>([index]);
          if (isContextCard) {
            analysisConfigs.forEach((c, i) => {
              if (i === index) return;
              if ((c as AnalysisBaseConfig).parentContextOriginalIndex === index) {
                removeSet.add(i);
              }
            });
          }

          // Cascade-delete child sound configs: sounds linked to any removed
          // usage card (parentUsageOriginalIndex), plus the negative namespace
          // `-(index + 1)` used by audio context cards that bypassed Usage.
          const soundscape = useSoundscapeStore.getState();
          const soundIndicesToRemove: number[] = [];
          soundscape.soundConfigs.forEach((sc, i) => {
            const pui = (sc as any).parentUsageOriginalIndex;
            if (pui === undefined || pui === null) return;
            if (removeSet.has(pui)) {
              soundIndicesToRemove.push(i);
            } else if (isContextCard && pui === -(index + 1)) {
              soundIndicesToRemove.push(i);
            }
          });
          if (soundIndicesToRemove.length > 0) {
            soundscape.handleRemoveConfigs(soundIndicesToRemove);
          }

          const newConfigs = analysisConfigs.filter((_, i) => !removeSet.has(i));
          const newResults = analysisResults.filter((r) => !removeSet.has(r.configIndex));
          const remainingIndices = analysisConfigs.map((_, i) => i).filter((i) => !removeSet.has(i));
          let newTab = activeAnalysisTab;
          if (removeSet.has(newTab)) {
            newTab = remainingIndices.length > 0 ? remainingIndices[remainingIndices.length - 1] : 0;
          } else {
            const below = [...removeSet].filter((i) => i < newTab).length;
            newTab = newTab - below;
          }
          set(
            { analysisConfigs: newConfigs, analysisResults: newResults, activeAnalysisTab: newTab },
            false,
            'analysis/removeConfig',
          );
        },

        handleUpdateConfig: (index, updates) =>
          set(
            (s) => ({
              analysisConfigs: s.analysisConfigs.map((config, i) =>
                i === index ? ({ ...config, ...updates } as AnalysisConfig) : config,
              ),
            }),
            false,
            'analysis/updateConfig',
          ),

        handleReorderConfigs: (from, to) => {
          const { analysisConfigs, analysisResults, activeAnalysisTab } = get();
          const newConfigs = [...analysisConfigs];
          const [removed] = newConfigs.splice(from, 1);
          newConfigs.splice(to, 0, removed);
          const newResults = analysisResults.map((r) => {
            let idx = r.configIndex;
            if (idx === from) idx = to;
            else if (from < to && idx > from && idx <= to) idx--;
            else if (from > to && idx >= to && idx < from) idx++;
            return { ...r, configIndex: idx };
          });
          let newTab = activeAnalysisTab;
          if (newTab === from) newTab = to;
          else if (from < to && newTab > from && newTab <= to) newTab--;
          else if (from > to && newTab >= to && newTab < from) newTab++;
          set(
            { analysisConfigs: newConfigs, analysisResults: newResults, activeAnalysisTab: newTab },
            false,
            'analysis/reorderConfigs',
          );
        },

        duplicateConfigAt: (from, toInsertion) => {
          const { analysisConfigs, analysisResults, activeAnalysisTab } = get();
          const config = analysisConfigs[from];
          if (!config) return;

          const cloned: AnalysisConfig = structuredClone(config);
          cloned.display_name = cloned.display_name
            ? `${cloned.display_name} (copy)`
            : undefined;

          // A duplicated scenario card must NOT share its pipeline results/IDs with the
          // source — regenerating it must produce a fresh scenario, foley, speech and
          // orchestrate run (and a new sound section), not re-link to the source card's.
          if (cloned.type === 'scenario') {
            cloned.scenarioRawText = '';
            cloned.scenarioResult = null;
            cloned.scenarioId = null;
            cloned.foleyResult = null;
            cloned.selectedFoleyKeys = [];
            cloned.speechResult = null;
            cloned.speechId = null;
            cloned.orchestrateResult = null;
            cloned.orchestrateId = null;
          }

          // Insert the clone — toInsertion is the gap index (0 = before first, n = after last).
          // If the clone lands at or after the source, shift by -1 since the clone is inserted
          // before the source shifts.
          const newConfigs = [...analysisConfigs];
          const insertAt = toInsertion > from ? toInsertion - 1 : toInsertion;
          newConfigs.splice(insertAt, 0, cloned);

          // Remap sound-children linkage so each sound card keeps following its parent
          // usage/context card across the insertion (the fresh clone has no children of its
          // own). Without this, a clone inserted at or before the source shifts the source's
          // index and silently orphans its children onto the clone.
          const soundStore = useSoundscapeStore.getState();
          const remapParentUsageIndex = (pui: number | undefined): number | undefined => {
            if (pui === undefined) return pui;
            if (pui >= 0) return pui >= insertAt ? pui + 1 : pui;
            // Negative namespace: -(contextIndex + 1) for audio-context bypass cards.
            const ctxIndex = -pui - 1;
            const newCtxIndex = ctxIndex >= insertAt ? ctxIndex + 1 : ctxIndex;
            return -(newCtxIndex + 1);
          };
          let soundLinkageChanged = false;
          const remappedSoundConfigs = soundStore.soundConfigs.map((sc) => {
            const pui = (sc as any).parentUsageOriginalIndex as number | undefined;
            const next = remapParentUsageIndex(pui);
            if (next !== pui) {
              soundLinkageChanged = true;
              return { ...sc, parentUsageOriginalIndex: next };
            }
            return sc;
          });
          if (soundLinkageChanged) {
            useSoundscapeStore.setState({ soundConfigs: remappedSoundConfigs });
          }

          // Duplicate the linked analysis result if one exists for this config
          const newResults = [...analysisResults];
          const existingResult = analysisResults.find((r) => r.configIndex === from);
          if (existingResult) {
            // Shift result config indices: all results with index >= insertAt get +1
            const shifted = newResults.map((r) => ({
              ...r,
              configIndex: r.configIndex >= insertAt ? r.configIndex + 1 : r.configIndex,
            }));
            shifted.push({
              configIndex: insertAt,
              prompts: structuredClone(existingResult.prompts),
              generatedAt: existingResult.generatedAt,
            });
            newResults.length = 0;
            newResults.push(...shifted);
          }

          // Adjust active tab
          let newTab = activeAnalysisTab;
          if (newTab >= insertAt && from !== newTab) newTab++;
          else if (insertAt <= newTab && from > newTab) { /* no shift needed */ }
          set(
            { analysisConfigs: newConfigs, analysisResults: newResults, activeAnalysisTab: newTab },
            false,
            'analysis/duplicateConfigAt',
          );
        },

        setActiveAnalysisTab: (index) =>
          set({ activeAnalysisTab: index }, false, 'analysis/setActiveTab'),

        handleAudioFileUpload: async (index, file) => {
          const { analysisConfigs, handleUpdateConfig } = get();
          const config = analysisConfigs[index] as AudioAnalysisConfig;
          if (config?.type !== 'audio') return;

          // A newly chosen File is always a distinct object — if a different file was
          // already loaded & persisted, drop the old reference so the fresh copy below
          // replaces it (keeps the persisted source in sync with the loaded audio).
          const replacingDifferentFile =
            !!config.audioFile && config.audioFile !== file && !!config.persistedAudioFilename;

          try {
            const result = await loadAudioFileWithBuffer(file);
            if (result) {
              const updates: Partial<AudioAnalysisConfig> = {
                audioFile: file,
                audioInfo: result.audioInfo,
                audioBuffer: result.audioBuffer,
              };
              // Pin the original filename as the card title so a refresh (which rebuilds
              // the File from the server-side persisted copy under a generated name) does
              // not rename the card to the persisted file's id.
              if (!config.display_name) {
                updates.display_name = file.name;
              }
              if (replacingDifferentFile) {
                updates.persistedAudioFilename = undefined;
              }
              handleUpdateConfig(index, updates as Partial<AnalysisConfig>);

              // Persist a copy of the source audio to the session's data dir so the
              // SED waveform + detected-sounds results can be rebuilt after a refresh.
              // Session-scoped (same cookie namespace as the soundscape save), so no real
              // model is required — the token only appears in the upload URL path.
              if (replacingDifferentFile || !config.persistedAudioFilename) {
                try {
                  const { filename } = await apiService.uploadSoundscapeAudio(
                    AUDIO_CONTEXT_PERSIST_MODEL_TOKEN,
                    `ctx-audio-${index}-${Date.now()}`,
                    file,
                  );
                  get().handleUpdateConfig(index, {
                    persistedAudioFilename: filename,
                  } as Partial<AnalysisConfig>);
                } catch (persistErr) {
                  console.warn(
                    `[analysisStore] Failed to persist audio context source for config ${index}:`,
                    persistErr,
                  );
                }
              }
            } else {
              throw new Error('Failed to load audio file');
            }
          } catch (error) {
            set(
              { analysisError: error instanceof Error ? error.message : 'Failed to load audio' },
              false,
              'analysis/audioLoadError',
            );
          }
        },

        rehydrateAudioContextSources: async (audioBaseUrl) => {
          const { analysisConfigs } = get();
          const audioConfigs = analysisConfigs
            .map((c, idx) => ({ config: c as AudioAnalysisConfig, idx }))
            .filter(
              ({ config }) =>
                config?.type === 'audio' &&
                !!config.persistedAudioFilename &&
                !config.audioFile,
            );
          if (audioConfigs.length === 0) return;

          // Mark every targeted config as "restoring its saved audio" so the cards
          // render a loading state instead of a misleading empty upload dropzone.
          const targetIdx = audioConfigs.map(({ idx }) => idx);
          const markDone = (idx: number, ok: boolean) => {
            set(
              (s) => {
                const loading = new Set(s.rehydratingAudioConfigs);
                loading.delete(idx);
                const failed = new Set(s.audioRehydrateFailedConfigs);
                if (ok) failed.delete(idx);
                else failed.add(idx);
                return { rehydratingAudioConfigs: loading, audioRehydrateFailedConfigs: failed };
              },
              false,
              'analysis/rehydrateItem',
            );
          };
          set(
            (s) => ({
              rehydratingAudioConfigs: new Set([
                ...s.rehydratingAudioConfigs,
                ...targetIdx.filter((i) => !s.rehydratingAudioConfigs.has(i)),
              ]),
              audioRehydrateFailedConfigs: new Set(
                [...s.audioRehydrateFailedConfigs].filter((i) => !targetIdx.includes(i)),
              ),
            }),
            false,
            'analysis/rehydrateStart',
          );

          const base = audioBaseUrl.replace(/\/$/, '');
          for (const { config, idx } of audioConfigs) {
            const filename = config.persistedAudioFilename!;
            try {
              const res = await fetch(`${base}/${encodeURIComponent(filename)}`, {
                credentials: 'include',
              });
              if (!res.ok) {
                console.warn(
                  `[analysisStore] Audio context source missing on server: ${filename} (${res.status})`,
                );
                markDone(idx, false);
                continue;
              }
              const blob = await res.blob();
              const file = new File([blob], filename, {
                type: blob.type || 'audio/wav',
              });
              const loaded = await loadAudioFileWithBuffer(file);
              if (!loaded) {
                console.warn(
                  `[analysisStore] Failed to decode restored audio context source: ${filename}`,
                );
                markDone(idx, false);
                continue;
              }
              const { handleUpdateConfig } = get();
              const current = get().analysisConfigs[idx] as AudioAnalysisConfig;
              if (current?.type === 'audio' && !current.audioFile) {
                handleUpdateConfig(idx, {
                  audioFile: file,
                  audioInfo: loaded.audioInfo,
                  audioBuffer: loaded.audioBuffer,
                } as Partial<AudioAnalysisConfig>);
              }
              markDone(idx, true);
            } catch (err) {
              console.warn(
                `[analysisStore] Failed to rehydrate audio context source for config ${idx}:`,
                err,
              );
              markDone(idx, false);
            }
          }
        },

        handleAnalyze: async (index) => {
          const { analysisConfigs, analysisResults, handleUpdateConfig } = get();
          const config = analysisConfigs[index];
          if (!config) return;

          _analysisAbortController = new AbortController();
          const signal = _analysisAbortController.signal;

          set(
            { isAnalyzing: true, analysisError: null, analyzingConfigIndex: index, analysisStatus: '' },
            false,
            'analysis/analyzeStart',
          );

          try {
            let prompts: TextPromptResult[] = [];

            if (config.type === 'model-analysis') {
              await get().handleAnalyzeModel(index);
              return;
            } else if (config.type === 'scenario') {
              const sc = config as ScenarioConfig;
              if (sc.foleyResult && (sc.speechResult?.speeches?.length ?? 0) > 0) {
                // Foley + speech done → (re-)send the incomplete cards to generation
                get().handleSendToSoundGeneration(undefined, index);
                return;
              } else if (sc.scenarioResult) {
                // Scenario generated → run foley + speech (parallel)
                await get().handleFoleyArtist(index);
              } else {
                await get().handleScenarioAnalyze(index);
              }
              return;
            } else if (config.type === 'audio') {
              const audioConfig = config as AudioAnalysisConfig;
              if (!audioConfig.audioFile) throw new Error('No audio file uploaded');

              set({ analysisStatus: 'Uploading audio file...' }, false, 'analysis/analyzingAudio');

              const formData = new FormData();
              formData.append('file', audioConfig.audioFile);
              formData.append('num_sounds', SED_TOP_N_CLASSES);
              formData.append(
                'analyze_amplitudes',
                audioConfig.analysisOptions.analyze_amplitudes.toString(),
              );
              formData.append(
                'analyze_durations',
                audioConfig.analysisOptions.analyze_durations.toString(),
              );
              formData.append('top_n_classes', SED_TOP_N_CLASSES);

              const { task_id } = await apiService.startSEDAnalysis(formData);
              _sedTaskId = task_id;
              set({ analysisStatus: 'Queued...' }, false, 'analysis/sedQueued');

              const sedResult = await new Promise<any>((resolve, reject) => {
                _sedPollInterval = setInterval(async () => {
                  if (signal.aborted) {
                    clearInterval(_sedPollInterval!);
                    _sedPollInterval = null;
                    if (_sedTaskId) {
                      apiService.cancelSEDAnalysis(_sedTaskId).catch(() => {});
                      _sedTaskId = null;
                    }
                    reject(new Error('AbortError'));
                    return;
                  }
                  try {
                    const s = await apiService.getSEDAnalysisStatus(_sedTaskId!);
                    if (s.status) set({ analysisStatus: s.status }, false, 'analysis/sedPoll');
                    if (s.cancelled) {
                      clearInterval(_sedPollInterval!);
                      _sedPollInterval = null;
                      _sedTaskId = null;
                      reject(new Error('AbortError'));
                    } else if (s.error) {
                      clearInterval(_sedPollInterval!);
                      _sedPollInterval = null;
                      _sedTaskId = null;
                      reject(new Error(s.error));
                    } else if (s.completed && s.result) {
                      clearInterval(_sedPollInterval!);
                      _sedPollInterval = null;
                      _sedTaskId = null;
                      resolve(s.result);
                    }
                  } catch (pollErr: any) {
                    clearInterval(_sedPollInterval!);
                    _sedPollInterval = null;
                    _sedTaskId = null;
                    reject(pollErr);
                  }
                }, 1500);
              });

              prompts = sedResult.detected_sounds
                .filter(
                  (s: any) =>
                    s.confidence > SED_MIN_CONFIDENCE &&
                    s.name.trim().toLowerCase() !== 'silence',
                )
                .map((sound: any, i: number) => {
                  let volumeDbfs = DEFAULT_DBFS;
                  if (
                    audioConfig.analysisOptions.analyze_amplitudes &&
                    sound.max_amplitude_db !== null &&
                    isFinite(sound.max_amplitude_db)
                  ) {
                    // max_amplitude_db is already measured in dBFS by SED analysis — use it directly.
                    volumeDbfs = Math.max(DBFS_MIN, Math.min(-3, sound.max_amplitude_db));
                  }
                  let playbackInterval = LLM_SUGGESTED_INTERVAL_SECONDS;
                  if (
                    audioConfig.analysisOptions.analyze_durations &&
                    sound.max_silence_duration_sec != null
                  ) {
                    playbackInterval =
                      Math.round(
                        Math.max(5, Math.min(120, sound.max_silence_duration_sec)) * 10,
                      ) / 10;
                  }
                  let estimatedDuration = 10;
                  if (sound.avg_event_duration_sec > 0) {
                    estimatedDuration =
                      Math.round(Math.max(3, Math.min(30, sound.avg_event_duration_sec)) * 10) /
                      10;
                  }
                  return {
                    id: `${index}-${i}`,
                    text: sound.name,
                    selected: true,
                    metadata: {
                      confidence: sound.confidence,
                      dbfs: volumeDbfs,
                      interval_seconds: playbackInterval,
                      duration_seconds: estimatedDuration,
                      detection_segments: sound.detection_segments ?? [],
                    },
                  };
                });
            } else if (config.type === 'text') {
              const textConfig = config as TextAnalysisConfig;

              // Parent-only analysis resolution — never fall back to another card.
              const analysisId = resolveParentAnalysisId(textConfig, get().analysisConfigs);
              const useAnalysis = textConfig.useAnalysisResult && !!analysisId;

              if (!textConfig.textInput.trim() && !useAnalysis) {
                throw new Error('Please enter a text description');
              }

              set(
                {
                  analysisStatus: useAnalysis
                    ? 'Reading 3D model analysis and generating sound prompts...'
                    : 'Generating sound prompts...',
                },
                false,
                'analysis/generatingText',
              );

              const requestBody: any = {
                context: textConfig.textInput,
                num_sounds: config.numSounds,
                llm_model: useSoundscapeStore.getState().llmModel,
              };
              if (useAnalysis) requestBody.analysis_id = analysisId;

              let soundIdx = 0;
              let appliedTitle = '';
              for await (const event of streamPrompts(
                `${API_BASE_URL}/api/generate-prompts-stream`,
                requestBody,
                signal,
              )) {
                if (event.type !== 'sound') continue;
                const { type: _t, ...p } = event;
                // The LLM guesses a 2-3 word soundscape title — use it as the card title.
                if (p.soundscape_title && p.soundscape_title !== appliedTitle) {
                  appliedTitle = p.soundscape_title;
                  handleUpdateConfig(index, { display_name: p.soundscape_title });
                }
                const prompt: TextPromptResult = {
                  id: `${index}-${soundIdx++}`,
                  text: p.prompt,
                  selected: true,
                  entities: p.entities || (p.entity ? [p.entity] : undefined),
                  entity: p.entities?.[0] || p.entity || null, // backward compat
                  metadata: {
                    dbfs: p.dbfs ?? DEFAULT_DBFS,
                    interval_seconds: p.interval_seconds || LLM_SUGGESTED_INTERVAL_SECONDS,
                    duration_seconds: p.duration_seconds || 10,
                  },
                };
                prompts.push(prompt);
                set(
                  (s) => {
                    const ex = s.analysisResults.findIndex((r) => r.configIndex === index);
                    const partial = { configIndex: index, prompts: [...prompts], generatedAt: new Date() };
                    return {
                      analysisResults:
                        ex >= 0
                          ? s.analysisResults.map((r, i) => (i === ex ? partial : r))
                          : [...s.analysisResults, partial],
                    };
                  },
                  false,
                  'analysis/soundStreamed',
                );
              }

              // Placement precedence for prompts that are NOT linked to an analysis
              // group: drawn area → model bounding box → (left unset, camera-front fallback).
              const linked = (p: TextPromptResult) => (p.entities?.length ?? 0) > 0 || !!p.position;
              const drawnArea = useAreaDrawingStore.getState().getArea(index);
              if (drawnArea) {
                const needingPositions = prompts.filter((p) => !linked(p));
                if (needingPositions.length > 0) {
                  const positions = generatePositionsInArea(drawnArea, needingPositions.length);
                  let posIdx = 0;
                  for (const prompt of needingPositions) {
                    if (posIdx < positions.length) prompt.position = positions[posIdx++];
                  }
                }
                useAreaDrawingStore.getState().setAreaVisualState(index, 'generated');
              } else {
                const bounds = getModelBounds();
                if (bounds) {
                  const needingPositions = prompts.filter((p) => !linked(p));
                  if (needingPositions.length > 0) {
                    const positions = generatePositionsInBounds(bounds, needingPositions.length);
                    let posIdx = 0;
                    for (const prompt of needingPositions) {
                      if (posIdx < positions.length) prompt.position = positions[posIdx++];
                    }
                  }
                }
              }
            }

            const newResult: AnalysisResult = {
              configIndex: index,
              prompts,
              generatedAt: new Date(),
            };

            set(
              (s) => {
                const existing = s.analysisResults.findIndex((r) => r.configIndex === index);
                return {
                  analysisResults:
                    existing >= 0
                      ? s.analysisResults.map((r, i) => (i === existing ? newResult : r))
                      : [...s.analysisResults, newResult],
                };
              },
              false,
              'analysis/analyzeDone',
            );
          } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
              // Cancelled by user — silent
            } else {
              const errorMsg = error instanceof Error ? error.message : 'Analysis failed';
              const isQuotaError = errorMsg.includes('quota') || errorMsg.includes('429');
              notifySectionError(errorMsg, isQuotaError ? 'warning' : 'error');
              set({ analysisError: errorMsg }, false, 'analysis/analyzeError');
            }
          } finally {
            _analysisAbortController = null;
            set({ isAnalyzing: false, analysisStatus: '', analysisProgress: 0, analyzingConfigIndex: null }, false, 'analysis/analyzeEnd');
          }
        },

        handleStopAnalysis: () => {
          _analysisAbortController?.abort();
          _analysisAbortController = null;
          if (_sedPollInterval) {
            clearInterval(_sedPollInterval);
            _sedPollInterval = null;
          }
          if (_sedTaskId) {
            apiService.cancelSEDAnalysis(_sedTaskId).catch(() => {});
            _sedTaskId = null;
          }
          llmPollRegistry.stopAll();
          for (const jobId of [..._llmJobIds]) {
            apiService.cancelJob(jobId).catch(() => {});
          }
          _llmJobIds.clear();
          set({ isAnalyzing: false, analysisStatus: '', analysisProgress: 0, analyzingConfigIndex: null }, false, 'analysis/stop');
        },

        handleTogglePromptSelection: (configIndex, promptId) =>
          set(
            (s) => ({
              analysisResults: s.analysisResults.map((result) => {
                if (result.configIndex !== configIndex) return result;
                return {
                  ...result,
                  prompts: result.prompts.map((p) =>
                    p.id === promptId ? { ...p, selected: !p.selected } : p,
                  ),
                };
              }),
            }),
            false,
            'analysis/togglePrompt',
          ),

        handleSetAllPromptsSelected: (configIndex, selected) =>
          set(
            (s) => ({
              analysisResults: s.analysisResults.map((result) =>
                result.configIndex !== configIndex
                  ? result
                  : {
                      ...result,
                      prompts: result.prompts.map((p) => ({ ...p, selected })),
                    },
              ),
            }),
            false,
            'analysis/setAllPrompts',
          ),

        handleSendToSoundGeneration: (onSuccess, onlyConfigIndex) => {
          const { analysisResults, analysisConfigs } = get();

          // When onlyConfigIndex is set, only collect prompts from that specific card
          const allSelected = analysisResults
            .filter((r) => onlyConfigIndex === undefined || r.configIndex === onlyConfigIndex)
            .flatMap((result) => result.prompts.filter((p) => p.selected));

          // Also collect selected foley sounds from scenario configs
          const foleyPrompts: TextPromptResult[] = [];
          const configsToScan = onlyConfigIndex !== undefined
            ? (analysisConfigs[onlyConfigIndex] ? [analysisConfigs[onlyConfigIndex]] : [])
            : analysisConfigs;
          configsToScan.forEach((config) => {
            if (config.type !== 'scenario') return;
            const sc = config as ScenarioConfig;

            // Orchestrate pipeline path (preferred when available)
            if (sc.orchestrateResult?.playlist?.length) {
              const voiceMap = new Map<string, string>();
              let voiceIdx = 0;

              sc.orchestrateResult.playlist.forEach((entry) => {
                const normalizedCategory = (entry.category || '').toLowerCase().replace(/[\s-]+/g, '_');
                const isSpeech = normalizedCategory === 'speech';

                const splMatch = entry.spl?.match(/(-?\d+(?:\.\d+)?)/);
                const dbfsVal = splMatch ? parseFloat(splMatch[1]) : DEFAULT_DBFS;

                const durationSec = (() => {
                  const d = entry.duration ?? '';
                  const colonIdx = d.indexOf(':');
                  if (colonIdx !== -1) {
                    const mm = parseFloat(d.slice(0, colonIdx)) || 0;
                    const ss = parseFloat(d.slice(colonIdx + 1)) || 0;
                    return mm * 60 + ss;
                  }
                  const n = parseFloat(d);
                  return isNaN(n) ? (isSpeech ? 5 : 10) : n;
                })();

                const pos = entry.position;
                const involvedIds = entry.objectsInvolved?.filter(Boolean) ?? [];
                const variantCount = Math.max(...entry.variants, 1);

                const speechLines = isSpeech
                  ? entry.description.split(';').map((s) => s.trim()).filter(Boolean)
                  : [];

                const promptText = isSpeech && speechLines.length > 0
                  ? speechLines[0]
                  : entry.description || entry.soundName;

                let voiceName: string | undefined;
                if (isSpeech) {
                  // Prefer the character chosen by the speech agent: it is a bare
                  // character name (e.g. "Clara") — map it to its Gemini voice value
                  // via the authoritative character map (NOT the display labels,
                  // which are "Clara (Smooth)" and never match a bare name).
                  const character = (entry.character || '').trim();
                  const resolved = resolveVoiceForCharacter(character);
                  if (resolved) {
                    voiceName = resolved;
                  } else {
                    // Fallback: round-robin a stable voice per character/sound.
                    const key = character || entry.soundName || entry.id;
                    if (!voiceMap.has(key)) {
                      voiceMap.set(key, TTS_VOICES[voiceIdx % TTS_VOICES.length].value);
                      voiceIdx++;
                    }
                    voiceName = voiceMap.get(key);
                  }
                }

                foleyPrompts.push({
                  id: `orch-${sc.orchestrateResult!.orchestrateId}-${entry.id}`,
                  text: promptText,
                  displayName: entry.soundName,
                  selected: true,
                  position: involvedIds.length === 0 && Array.isArray(pos) && pos.length >= 3
                    ? [pos[0], pos[1], pos[2]]
                    : undefined,
                  entities: involvedIds.length > 0
                    ? involvedIds.map((objId) => ({
                        applicationId: objId,
                        id: objId,
                        foleyPosition: Array.isArray(pos) && pos.length >= 3
                          ? ([pos[0], pos[1], pos[2]] as [number, number, number])
                          : undefined,
                      }))
                    : undefined,
                  entity: involvedIds.length > 0
                    ? {
                        applicationId: involvedIds[0],
                        id: involvedIds[0],
                        foleyPosition: Array.isArray(pos) && pos.length >= 3
                          ? ([pos[0], pos[1], pos[2]] as [number, number, number])
                          : undefined,
                      }
                    : undefined,
                  metadata: {
                    dbfs: dbfsVal,
                    duration_seconds: durationSec,
                    interval_seconds: LLM_SUGGESTED_INTERVAL_SECONDS,
                    timestamps: entry.trigger?.type === 'absolute'
                      ? entry.trigger.expression.filter((e) => /^\d/.test(e))
                      : undefined,
                    category: entry.category,
                    orchestrateMeta: {
                      orchestrateId: sc.orchestrateResult!.orchestrateId,
                      entryId: entry.id,
                      trigger: entry.trigger,
                      variants: entry.variants,
                      allObjectIds: involvedIds,
                      isSpeech,
                      voiceName,
                      speechLines: isSpeech ? speechLines : undefined,
                      timestamps: entry.timestamps,
                    },
                  },
                });
              });
            } else if (sc.foleyResult || sc.speechResult) {
            // Incomplete path: foley + speech only (no orchestrate yet). Orchestration
            // runs in parallel at generation time, so these cards carry a `scenarioSource`
            // reference (raw entry fields + user-editable copy counts) that lets the sound
            // section rebuild the orchestrate input from the user's edits.
            const selectedKeys = new Set(sc.selectedFoleyKeys ?? []);
            const scenarioId = sc.scenarioId ?? '';
            const foleyId = sc.foleyResult?.foleyId ?? null;
            const speechId = sc.speechResult?.speechId ?? null;

            // ── Foley sounds ──
            (sc.foleyResult?.scenarios ?? []).forEach((scenario, si) => {
              scenario.sound_events.forEach((sound, ei) => {
                const key = `${scenario.scenario_title}__${sound.soundName}`;
                if (!selectedKeys.has(key)) return;
                const durationSec = (() => {
                  const d = sound.duration ?? '';
                  const colonIdx = d.indexOf(':');
                  if (colonIdx !== -1) {
                    const mm = parseFloat(d.slice(0, colonIdx)) || 0;
                    const ss = parseFloat(d.slice(colonIdx + 1)) || 0;
                    return mm * 60 + ss;
                  }
                  const n = parseFloat(d);
                  return isNaN(n) ? 10 : n;
                })();
                const pos = sound.position;
                const involvedIds = sound.objectsInvolved?.filter(Boolean) ?? [];
                const linkedObjectId = involvedIds.length > 0 ? involvedIds[0] : null;
                const normalizedCategory = (sound.category || '').toLowerCase().replace(/[\s-]+/g, '_');
                const isBgFoley = normalizedCategory === 'background' || normalizedCategory === 'background_sound';

                foleyPrompts.push({
                  id: `foley-${foleyId}-${si}-${ei}`,
                  text: sound.description || sound.soundName,
                  displayName: sound.soundName,
                  selected: true,
                  position:
                    !linkedObjectId && Array.isArray(pos) && pos.length >= 3
                      ? [pos[0], pos[1], pos[2]]
                      : undefined,
                  entities: linkedObjectId
                    ? [
                        {
                          applicationId: linkedObjectId,
                          id: linkedObjectId,
                          foleyPosition: Array.isArray(pos) && pos.length >= 3
                            ? ([pos[0], pos[1], pos[2]] as [number, number, number])
                            : undefined,
                        },
                      ]
                    : undefined,
                  entity: linkedObjectId
                    ? {
                        applicationId: linkedObjectId,
                        id: linkedObjectId,
                        foleyPosition: Array.isArray(pos) && pos.length >= 3
                          ? ([pos[0], pos[1], pos[2]] as [number, number, number])
                          : undefined,
                      }
                    : undefined,
                  metadata: {
                    dbfs: DEFAULT_DBFS,
                    duration_seconds: isBgFoley ? 10 : durationSec,
                    interval_seconds: LLM_SUGGESTED_INTERVAL_SECONDS,
                    timestamps: isBgFoley ? undefined : (sound.timestamps?.length ? sound.timestamps : undefined),
                    category: sound.category,
                    scenarioSource: {
                      scenarioId,
                      foleyId,
                      speechId,
                      entryId: sound.id,
                      isSpeech: false,
                      copyCount: 1,
                      soundName: sound.soundName,
                      description: sound.description,
                      category: sound.category,
                      duration: sound.duration ?? '',
                      timestamps: sound.timestamps ?? [],
                      objectsInvolved: involvedIds,
                      position: Array.isArray(pos) ? pos : [],
                      character: '',
                      script: '',
                      speechLines: [],
                    },
                  },
                });
              });
            });

            // ── Speech entries ──
            (sc.speechResult?.speeches ?? []).forEach((speech, si) => {
              const speechLines = (speech.script ?? '')
                .split(';')
                .map((s) => s.trim())
                .filter(Boolean);
              const character = (speech.character || '').trim();
              const voiceName = resolveVoiceForCharacter(character) ?? TTS_VOICES[0].value;
              const pos = speech.position;

              foleyPrompts.push({
                id: `speech-${speechId}-${si}`,
                text: speech.script,
                displayName: character || speech.id,
                selected: true,
                position: Array.isArray(pos) && pos.length >= 3
                  ? [pos[0], pos[1], pos[2]]
                  : undefined,
                metadata: {
                  dbfs: DEFAULT_DBFS,
                  duration_seconds: 5,
                  interval_seconds: 5,
                  timestamps: speech.timestamps?.length ? speech.timestamps : undefined,
                  category: 'speech',
                  scenarioSource: {
                    scenarioId,
                    foleyId,
                    speechId,
                    entryId: speech.id,
                    isSpeech: true,
                    copyCount: speechLines.length || 1,
                    soundName: character || 'Speech',
                    description: speech.script,
                    category: 'speech',
                    duration: '',
                    timestamps: speech.timestamps ?? [],
                    objectsInvolved: [],
                    position: Array.isArray(pos) ? pos : [],
                    character,
                    script: speech.script,
                    speechLines,
                    voiceName,
                  },
                },
              });
            });
            }
          });

          const combined = [...allSelected, ...foleyPrompts];
          console.log('[handleSendToSoundGeneration] pushing', combined.length, 'prompts',
            onlyConfigIndex !== undefined ? `from config ${onlyConfigIndex}` : 'from all configs');
          if (onSuccess) onSuccess(combined);
          return combined;
        },

        handleReset: (index) => {
          const config = get().analysisConfigs[index];

          // Scenario: three-step reset
          if (config?.type === 'scenario') {
            const sc = config as ScenarioConfig;
            if (sc.orchestrateResult) {
              // Step 1: clear orchestrate only, keep foley + speech
              get().handleUpdateConfig(index, {
                orchestrateResult: null,
                orchestrateId: null,
              } as Partial<ScenarioConfig>);
            } else if (sc.foleyResult && sc.speechResult) {
              // Step 2: clear foley + speech only, keep scenario
              get().handleUpdateConfig(index, {
                foleyResult: null,
                speechResult: null,
                speechId: null,
                selectedFoleyKeys: [],
              } as Partial<ScenarioConfig>);
            } else if (sc.foleyResult) {
              // Step 3: clear foley only
              get().handleUpdateConfig(index, {
                foleyResult: null,
                selectedFoleyKeys: [],
              } as Partial<ScenarioConfig>);
            } else {
              // Step 4: clear entire scenario
              get().handleUpdateConfig(index, {
                scenarioRawText: '',
                scenarioResult: null,
                scenarioId: null,
                foleyResult: null,
                speechResult: null,
                speechId: null,
                orchestrateResult: null,
                orchestrateId: null,
                selectedFoleyKeys: [],
              } as Partial<ScenarioConfig>);
            }
            return;
          }

          if (config?.type === 'model-analysis') {
            useSpeckleStore.getState().clearAnalysisObjectGroups();
          }
          set(
            (s) => ({
              analysisConfigs: s.analysisConfigs.map((c, i) =>
                i === index && c.type === 'model-analysis'
                  ? ({ ...c, analysisResult: undefined } as AnalyzeModelConfig)
                  : c,
              ),
              analysisResults: s.analysisResults.filter((r) => r.configIndex !== index),
            }),
            false,
            'analysis/reset',
          );
        },

        handleAnalyzeModel: async (index) => {
          const { analysisConfigs, handleUpdateConfig } = get();
          const config = analysisConfigs[index] as AnalyzeModelConfig;
          if (config?.type !== 'model-analysis') return;

          _analysisAbortController = new AbortController();

          set(
            { isAnalyzing: true, analysisError: null, analyzingConfigIndex: index, analysisStatus: 'Analyzing 3D model...' },
            false,
            'analysis/analyzeModelStart',
          );

          const objects: ArchitecturalObject[] = [];
          const colorGroups: { objectIds: string[]; color: string }[] = [];
          let analysisId = '';
          let spaceTitle = '';
          let spaceDescription = '';

          try {
            // Prefer a FRESH extraction from the live worldTree. config.modelEntities
            // can be stale/partial because Speckle loads layers lazily — entities
            // captured at initial load may miss geometry (e.g. the Acoustics layer)
            // that streamed in afterwards. Re-extracting guarantees the current,
            // complete tree (with correct ancestor chains for layer matching).
            let baseEntities: any[] = config.modelEntities;
            try {
              const viewerForExtract: any = useSpeckleStore.getState().getViewerRef?.();
              const liveWorldTree: any = viewerForExtract?.getWorldTree?.();
              if (liveWorldTree) {
                const freshEntities = extractSpeckleEntities(liveWorldTree);
                if (freshEntities.length >= baseEntities.length) {
                  baseEntities = freshEntities;
                  console.log('[analyzeModel] re-extracted entities from live worldTree:', freshEntities.length, '(was', config.modelEntities.length, ')');
                }
              }
            } catch (extractErr) {
              console.warn('[analyzeModel] live worldTree re-extraction failed, using config.modelEntities:', extractErr);
            }

            // Use speckleStore's live hidden IDs — read directly from the
            // FilteringExtension (the single source of truth, kept coherent by
            // applyVisibility). This is what the ObjectExplorer drives.
            const hiddenIdsForAnalysis = useSpeckleStore.getState().getExplorerHiddenIds();
            // When a layer is isolated in the Object Explorer, only that layer and
            // its descendants are "shown" — everything else is implicitly hidden.
            // getExplorerIsolatedIds returns the resolved descendant object IDs, or
            // null when no isolation is active.
            const isolatedIdsForAnalysis = useSpeckleStore.getState().getExplorerIsolatedIds();
            const isolatedSetForAnalysis = isolatedIdsForAnalysis
              ? new Set(isolatedIdsForAnalysis)
              : null;
            // The viewer's filtering IDs and the extracted entity IDs don't always
            // come from the same field (raw.id vs model.id vs applicationId), so
            // match against every candidate ID an entity carries.
            const entityIdCandidates = (e: any): string[] =>
              [e?.id, e?.nodeId, e?.modelId, e?.applicationId, e?.raw?.id, e?.raw?.applicationId].filter(Boolean) as string[];
            // Include the ancestor container/layer IDs so hiding/isolating a layer
            // captures its whole subtree, even if the viewer's leaf-id enumeration
            // is incomplete (the layer node itself is always in the set).
            const entityMatchIds = (e: any): string[] =>
              [...entityIdCandidates(e), ...((e?.ancestorIds ?? []) as string[])];
            const isEntityHidden = (e: any) =>
              entityMatchIds(e).some((id) => hiddenIdsForAnalysis.has(id));
            const isEntityShownByIsolation = (e: any) =>
              isolatedSetForAnalysis === null ||
              entityMatchIds(e).some((id) => isolatedSetForAnalysis.has(id));
            const visibleEntitiesForAnalysis = baseEntities.filter(
              (e: any) => !isEntityHidden(e) && isEntityShownByIsolation(e),
            );

            // ─── DIAGNOSTIC: trace "Backwall" layer + its children ───────────
            {
              const TRACE = 'backwall';
              const layerCounts: Record<string, number> = {};
              for (const e of baseEntities as any[]) {
                const k = String(e?.layer ?? '(no layer)');
                layerCounts[k] = (layerCounts[k] ?? 0) + 1;
              }
              const backwallEntities = (baseEntities as any[]).filter(
                (e) =>
                  String(e?.layer ?? '').toLowerCase().includes(TRACE) ||
                  String(e?.name ?? '').toLowerCase().includes(TRACE),
              );
              const isolatedArr = isolatedSetForAnalysis
                ? Array.from(isolatedSetForAnalysis)
                : [];
              // Does any candidate id of ANY entity appear in the isolated set?
              const allEntityIds = new Set<string>();
              for (const e of baseEntities as any[])
                entityIdCandidates(e).forEach((id) => allEntityIds.add(id));
              const isolatedIdsMatchingSomeEntity = isolatedArr.filter((id) =>
                allEntityIds.has(id),
              );
              // Per-field breakdown: how many isolated ids are covered by each
              // individual entity id field. Reveals which namespace the viewer uses.
              const fieldSets: Record<string, Set<string>> = {
                id: new Set(),
                nodeId: new Set(),
                modelId: new Set(),
                applicationId: new Set(),
                'raw.id': new Set(),
                'raw.applicationId': new Set(),
              };
              for (const e of baseEntities as any[]) {
                if (e?.id) fieldSets.id.add(e.id);
                if (e?.nodeId) fieldSets.nodeId.add(e.nodeId);
                if (e?.modelId) fieldSets.modelId.add(e.modelId);
                if (e?.applicationId) fieldSets.applicationId.add(e.applicationId);
                if (e?.raw?.id) fieldSets['raw.id'].add(e.raw.id);
                if (e?.raw?.applicationId) fieldSets['raw.applicationId'].add(e.raw.applicationId);
              }
              const perFieldMatches = Object.fromEntries(
                Object.entries(fieldSets).map(([field, set]) => [
                  field,
                  isolatedArr.filter((id) => set.has(id)).length,
                ]),
              );
              console.log('[analyzeModel][TRACE] ===== entity filtering =====');
              console.log('[analyzeModel][TRACE] total entities:', baseEntities.length);
              console.log('[analyzeModel][TRACE] layers present (name -> count):', layerCounts);
              console.log('[analyzeModel][TRACE] hidden set size:', hiddenIdsForAnalysis.size);
              console.log(
                '[analyzeModel][TRACE] isolated set:',
                isolatedSetForAnalysis ? `${isolatedArr.length} ids` : 'none (null)',
                '| sample:', isolatedArr.slice(0, 5),
              );
              console.log(
                '[analyzeModel][TRACE] isolated ids that match SOME entity candidate id:',
                isolatedIdsMatchingSomeEntity.length,
                '/', isolatedArr.length,
              );
              console.log(
                '[analyzeModel][TRACE] isolated-id matches per entity field:',
                perFieldMatches,
              );
              console.log(
                `[analyzeModel][TRACE] "${TRACE}" entities found:`, backwallEntities.length,
              );
              for (const e of backwallEntities.slice(0, 8)) {
                const cands = entityIdCandidates(e);
                console.log(`[analyzeModel][TRACE]   • name="${e?.name}" layer="${e?.layer}" type="${e?.speckle_type}"`, {
                  candidateIds: cands,
                  inIsolated: cands.map((id) => isolatedSetForAnalysis?.has(id) ?? null),
                  inHidden: cands.map((id) => hiddenIdsForAnalysis.has(id)),
                  shown: !isEntityHidden(e) && isEntityShownByIsolation(e),
                });
              }
              // Ancestor-match confirmation: entities included only because an
              // ancestor (layer) id — not their own id — is in the isolated set.
              if (isolatedSetForAnalysis) {
                let viaAncestorOnly = 0;
                let viaLeaf = 0;
                for (const e of baseEntities as any[]) {
                  const leafHit = entityIdCandidates(e).some((id) => isolatedSetForAnalysis.has(id));
                  const ancestorHit = ((e?.ancestorIds ?? []) as string[]).some((id) => isolatedSetForAnalysis.has(id));
                  if (leafHit) viaLeaf++;
                  else if (ancestorHit) viaAncestorOnly++;
                }
                console.log(
                  '[analyzeModel][TRACE] isolation matches — via leaf id:', viaLeaf,
                  '| via ancestor only:', viaAncestorOnly,
                );
              }
              console.log('[analyzeModel][TRACE] visible after filter:', visibleEntitiesForAnalysis.length);

              // ─── Live worldTree probe: inspect the isolated seed node subtree ──
              try {
                const viewer: any = useSpeckleStore.getState().getViewerRef?.();
                const wt: any = viewer?.getWorldTree?.();
                const roots: any[] =
                  wt?.tree?._root?.children || wt?._root?.children || wt?.root?.children || wt?.children || [];
                const seed = isolatedArr[0];
                const entityIdSet = new Set<string>();
                for (const e of baseEntities as any[]) {
                  if (e?.id) entityIdSet.add(e.id);
                  if (e?.raw?.id) entityIdSet.add(e.raw.id);
                  if (e?.modelId) entityIdSet.add(e.modelId);
                }
                const nodeIdsOf = (n: any) => {
                  const r = n?.raw || n?.model?.raw || {};
                  return { rawId: r.id, modelId: n?.model?.id, nodeId: n?.id, type: r.speckle_type, name: r.name || n?.model?.name };
                };
                const findNode = (nodes: any[]): any => {
                  for (const n of nodes) {
                    const ids = nodeIdsOf(n);
                    if (ids.rawId === seed || ids.modelId === seed || ids.nodeId === seed) return n;
                    const kids = n?.model?.children || n?.children || [];
                    const found = findNode(kids);
                    if (found) return found;
                  }
                  return null;
                };
                const seedNode = findNode(roots);
                console.log('[analyzeModel][PROBE] seed:', seed, '| seedNode found in worldTree:', !!seedNode);
                if (seedNode) {
                  const stats = { total: 0, geometry: 0, instance: 0, collection: 0, inModelEntities: 0, sampleGeom: [] as any[] };
                  const walk = (n: any) => {
                    stats.total++;
                    const ids = nodeIdsOf(n);
                    const t = String(ids.type || '');
                    const isGeom = !!(n?.model?.renderView || n?.renderView);
                    if (t.includes('Instance')) stats.instance++;
                    else if (t.includes('Collection')) stats.collection++;
                    if (isGeom) {
                      stats.geometry++;
                      if (ids.rawId && entityIdSet.has(ids.rawId) || ids.modelId && entityIdSet.has(ids.modelId)) stats.inModelEntities++;
                      if (stats.sampleGeom.length < 5) stats.sampleGeom.push(ids);
                    }
                    const kids = n?.model?.children || n?.children || [];
                    kids.forEach(walk);
                  };
                  walk(seedNode);
                  console.log('[analyzeModel][PROBE] seed node:', nodeIdsOf(seedNode));
                  console.log('[analyzeModel][PROBE] subtree stats:', stats);
                }
              } catch (err) {
                console.log('[analyzeModel][PROBE] worldTree probe failed:', err);
              }

              console.log('[analyzeModel][TRACE] ============================');
            }

            const ingestObjects = (items: ArchitecturalObject[]) => {
              if (items.length <= objects.length) return;
              const newcomers = items.slice(objects.length);
              for (const archObj of newcomers) {
                objects.push(archObj);
                const idx = objects.length - 1;
                const color = getAnalysisGroupColor(idx);
                const ids = Object.keys(archObj.object_ids ?? {});
                if (ids.length > 0) {
                  colorGroups.push({ objectIds: ids, color });
                }
              }
              useSpeckleStore.getState().setAnalysisObjectGroups([...colorGroups], [...objects]);
              handleUpdateConfig(index, {
                analysisResult: { analysisId, architecturalObjects: [...objects], spaceTitle, spaceDescription },
              } as Partial<AnalyzeModelConfig>);
            };

            const result = await pollLlmJob(
              '/api/analyze-3dmodel',
              {
                entities: visibleEntitiesForAnalysis,
                screenshots: config.liveScreenshots,
                user_context: config.userContext,
                llm_model: useSoundscapeStore.getState().llmModel,
              },
              index,
              'analyze_3dmodel',
              (partial) => {
                if (partial.analysis_id) analysisId = partial.analysis_id;
                if (partial.space_title) spaceTitle = partial.space_title;
                if (partial.space_description) spaceDescription = partial.space_description;
                if (Array.isArray(partial.items)) {
                  ingestObjects(partial.items as ArchitecturalObject[]);
                }
                handleUpdateConfig(index, {
                  analysisResult: { analysisId, architecturalObjects: [...objects], spaceTitle, spaceDescription },
                } as Partial<AnalyzeModelConfig>);
              },
            );

            if (result?.analysis_id) analysisId = result.analysis_id;
            if (Array.isArray(result?.objects)) ingestObjects(result.objects as ArchitecturalObject[]);
            spaceTitle = result?.space_title || spaceTitle;
            spaceDescription = result?.space_description || spaceDescription;

            const resultData: ModelAnalysisResultData = {
              analysisId,
              architecturalObjects: objects,
              spaceTitle: spaceTitle || undefined,
              spaceDescription: spaceDescription || undefined,
            };
            handleUpdateConfig(index, { analysisResult: resultData } as Partial<AnalyzeModelConfig>);
            useSpeckleStore.getState().setAnalysisObjectGroups(colorGroups, objects);

          } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
              // Cancelled
            } else {
              const errorMsg = error instanceof Error ? error.message : 'Model analysis failed';
              const isQuota = errorMsg.includes('quota') || errorMsg.includes('429');
              notifySectionError(errorMsg, isQuota ? 'warning' : 'error');
              set({ analysisError: errorMsg }, false, 'analysis/analyzeModelError');
            }
          } finally {
            _analysisAbortController = null;
            set({ isAnalyzing: false, analysisStatus: '', analysisProgress: 0, analyzingConfigIndex: null }, false, 'analysis/analyzeModelEnd');
          }
        },

        handleUpdateAnalysisObject: async (configIndex, objectIndex, updates) => {
          const { analysisConfigs, handleUpdateConfig } = get();
          const config = analysisConfigs[configIndex] as AnalyzeModelConfig;
          if (config?.type !== 'model-analysis' || !config.analysisResult) return;

          // Optimistic update
          const updatedObjects = config.analysisResult.architecturalObjects.map((obj, i) =>
            i === objectIndex ? { ...obj, ...updates } : obj,
          );
          handleUpdateConfig(configIndex, {
            analysisResult: { ...config.analysisResult, architecturalObjects: updatedObjects },
          } as Partial<AnalyzeModelConfig>);

          // Refresh viewer colors with updated names (object_ids unchanged)
          const colorGroups = updatedObjects.map((obj, i) => ({
            objectIds: Object.keys(obj.object_ids ?? {}),
            color: getAnalysisGroupColor(i),
          })).filter((g) => g.objectIds.length > 0);
          useSpeckleStore.getState().setAnalysisObjectGroups(colorGroups, updatedObjects);

          // Background persist
          if (config.analysisResult.analysisId) {
            try {
              await fetch(
                `${API_BASE_URL}/api/analyze-3dmodel-result/${config.analysisResult.analysisId}/objects/${objectIndex}`,
                {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(updates),
                },
              );
            } catch {
              // Non-critical
            }
          }
        },

        handleRegenerateText: async (index) => {
          const { analysisConfigs } = get();
          const config = analysisConfigs[index] as TextAnalysisConfig;
          if (config?.type !== 'text') return;

          // Replace the child sound scene: drop every sound card linked to this
          // usage card and delete its generated audio files from the backend.
          // Without the file deletion, regenerating identical prompts would dedup
          // to the existing files (deterministic filename hash).
          const soundStore = useSoundscapeStore.getState();
          const linkedSoundIndices = soundStore.soundConfigs
            .map((sc, i) => ({ sc, i }))
            .filter(({ sc }) => (sc as any).parentUsageOriginalIndex === index)
            .map(({ i }) => i);
          const linkedSet = new Set(linkedSoundIndices);
          const audioUrls = [
            ...new Set(
              [...(soundStore.soundscapeData ?? []), ...soundStore.generatedSounds]
                .filter((s: any) => linkedSet.has(s.prompt_index))
                .map((s: any) => s.url)
                .filter(
                  (u: any): u is string =>
                    typeof u === 'string' && u.length > 0 && !u.startsWith('blob:'),
                ),
            ),
          ];
          if (linkedSoundIndices.length > 0) {
            soundStore.handleRemoveConfigs(linkedSoundIndices);
          }
          if (audioUrls.length > 0) {
            try {
              await apiService.deleteGeneratedSounds(audioUrls);
            } catch (err) {
              console.warn('[analysisStore] Failed to delete text sound files:', err);
            }
          }

          // Clear the previous prompts for this card, then re-run the LLM inference.
          set(
            (s) => ({ analysisResults: s.analysisResults.filter((r) => r.configIndex !== index) }),
            false,
            'analysis/regenerateTextClear',
          );

          await get().handleAnalyze(index);
        },

        handleRefreshScenario: async (index) => {
          const { analysisConfigs, handleUpdateConfig } = get();
          const config = analysisConfigs[index] as ScenarioConfig;
          if (config?.type !== 'scenario' || !config.scenarioResult) return;

          // 1. Replace the child sound scene: drop every sound card linked to this
          // usage card and delete its generated audio files from the backend.
          // Without the file deletion, regenerating identical foley/speech prompts
          // would dedup to the existing files (deterministic filename hash).
          const soundStore = useSoundscapeStore.getState();
          const linkedSoundIndices = soundStore.soundConfigs
            .map((sc, i) => ({ sc, i }))
            .filter(({ sc }) => (sc as any).parentUsageOriginalIndex === index)
            .map(({ i }) => i);
          const linkedSet = new Set(linkedSoundIndices);
          const audioUrls = [
            ...new Set(
              [...(soundStore.soundscapeData ?? []), ...soundStore.generatedSounds]
                .filter((s: any) => linkedSet.has(s.prompt_index))
                .map((s: any) => s.url)
                .filter(
                  (u: any): u is string =>
                    typeof u === 'string' && u.length > 0 && !u.startsWith('blob:'),
                ),
            ),
          ];
          if (linkedSoundIndices.length > 0) {
            soundStore.handleRemoveConfigs(linkedSoundIndices);
          }
          if (audioUrls.length > 0) {
            try {
              await apiService.deleteGeneratedSounds(audioUrls);
            } catch (err) {
              console.warn('[analysisStore] Failed to delete scenario sound files:', err);
            }
          }

          // 2. Clear the previous foley + speech results so the agents re-run.
          handleUpdateConfig(index, {
            foleyResult: null,
            speechResult: null,
            speechId: null,
            orchestrateResult: null,
            orchestrateId: null,
            selectedFoleyKeys: [],
          } as Partial<ScenarioConfig>);

          // 3. Relaunch foley + speech — handleAnalyze dispatches to handleFoleyArtist
          // when scenarioResult exists but foley/speech are missing.
          await get().handleAnalyze(index);
        },

        handleToggleFoleySound: (index, key) => {
          const config = get().analysisConfigs[index] as ScenarioConfig;
          if (config?.type !== 'scenario') return;
          const current = config.selectedFoleyKeys ?? [];
          const next = current.includes(key)
            ? current.filter((k) => k !== key)
            : [...current, key];
          get().handleUpdateConfig(index, { selectedFoleyKeys: next } as Partial<ScenarioConfig>);
        },

        restoreAnalysisState: ({ analysisConfigs, analysisResults, activeTab }) => {
          set({
            analysisConfigs,
            analysisResults,
            activeAnalysisTab: activeTab,
            isAnalyzing: false,
            analysisError: null,
            analysisStatus: '',
            analysisProgress: 0,
            analyzingConfigIndex: null,
            rehydratingAudioConfigs: new Set<number>(),
            audioRehydrateFailedConfigs: new Set<number>(),
          });
        },

        handleScenarioAnalyze: async (index) => {
          const { analysisConfigs, handleUpdateConfig } = get();
          const config = analysisConfigs[index] as ScenarioConfig;
          if (config?.type !== 'scenario') return;

          const ownedRun = !get().isAnalyzing;
          if (ownedRun) {
            set(
              {
                isAnalyzing: true,
                analysisError: null,
                analyzingConfigIndex: index,
                analysisStatus: 'Imagining usage scenarios…',
                analysisProgress: 0,
              },
              false,
              'analysis/scenarioStart',
            );
          }

          // Reset previous results
          handleUpdateConfig(index, {
            scenarioRawText: '',
            scenarioResult: null,
            scenarioId: null,
            foleyResult: null,
            speechResult: null,
            speechId: null,
            orchestrateResult: null,
            orchestrateId: null,
            selectedFoleyKeys: [],
          } as Partial<ScenarioConfig>);

          // Regenerating a scenario on an already-generated sound scene must reset its
          // sound section: drop every sound card (and its generated events) linked to
          // this usage card, so the new foley + speech repopulate it fresh.
          const soundStore = useSoundscapeStore.getState();
          const linkedSoundIndices = soundStore.soundConfigs
            .map((sc, i) => ({ sc, i }))
            .filter(({ sc }) => (sc as any).parentUsageOriginalIndex === index)
            .map(({ i }) => i);
          if (linkedSoundIndices.length > 0) {
            soundStore.handleRemoveConfigs(linkedSoundIndices);
          }

          // Parent-only analysis resolution (never fall back to another card).
          const analysisId = config.useAnalysisResult
            ? resolveParentAnalysisId(config, analysisConfigs)
            : undefined;

          const { timelineDurationMs } = await import('@/store/audioControlsStore').then(
            (m) => m.useAudioControlsStore.getState(),
          );
          const scenarioDurationMs = config.timelineDurationMs ?? timelineDurationMs;

          const body = {
            user_context: config.userContext || undefined,
            llm_model: 'gemini-2.5-flash',
            analysis_id: analysisId,
            people_count: config.peopleCount,
            likeliness: config.likeliness,
            duration: Math.round(scenarioDurationMs / 1000),
          };

          let workingScenarios: ScenarioResult['scenarios'] = [];

          try {
            const result = await pollLlmJob(
              '/api/scenarist',
              body,
              index,
              'scenarist',
              (partial) => {
                const items = Array.isArray(partial.items) ? partial.items : [];
                for (const event of items as any[]) {
                  if (event?.type === 'scenario') {
                    const { scenario_index, title, duration, peopleCount, likeliness } = event;
                    const next = [...workingScenarios];
                    next[scenario_index] = {
                      title,
                      duration,
                      peopleCount,
                      likeliness,
                      events: next[scenario_index]?.events ?? [],
                    };
                    workingScenarios = next;
                    handleUpdateConfig(index, {
                      display_name: title,
                      scenarioResult: { scenarios: workingScenarios, scenarioId: '' },
                    } as Partial<ScenarioConfig>);
                  } else if (event?.type === 'event' && workingScenarios[event.scenario_index]) {
                    const ev = event.event as { timestamp: string; description: string };
                    const next = [...workingScenarios];
                    const already = next[event.scenario_index].events.some(
                      (e) => e.timestamp === ev.timestamp && e.description === ev.description,
                    );
                    if (!already) {
                      next[event.scenario_index] = {
                        ...next[event.scenario_index],
                        events: [...next[event.scenario_index].events, ev],
                      };
                      workingScenarios = next;
                      handleUpdateConfig(index, {
                        scenarioResult: { scenarios: workingScenarios, scenarioId: '' },
                      } as Partial<ScenarioConfig>);
                    }
                  }
                }
              },
            );
            const scenarios = (result?.scenarios ?? workingScenarios) as ScenarioResult['scenarios'];
            const scenarioId = (result?.scenario_id as string) ?? '';
            handleUpdateConfig(index, {
              display_name: scenarios?.[0]?.title,
              scenarioResult: { scenarios, scenarioId },
              scenarioId,
            } as Partial<ScenarioConfig>);
          } catch (e) {
            if (e instanceof Error && e.name === 'AbortError') return;
            console.error('[handleScenarioAnalyze] job error:', e);
            notifySectionError(e instanceof Error ? e.message : 'Scenario analysis failed');
          } finally {
            if (ownedRun) {
              set(
                { isAnalyzing: false, analysisStatus: '', analysisProgress: 0, analyzingConfigIndex: null },
                false,
                'analysis/scenarioEnd',
              );
            }
          }
        },

        handleFoleyArtist: async (index) => {
          const { analysisConfigs, handleUpdateConfig } = get();
          const config = analysisConfigs[index] as ScenarioConfig;
          if (config?.type !== 'scenario' || !config.scenarioId) return;

          const { maximumFoleySounds } = await import('@/store/audioControlsStore').then(
            (m) => m.useAudioControlsStore.getState(),
          );

          // Parent-only analysis resolution (never fall back to another card).
          const analysisId = config.useAnalysisResult
            ? resolveParentAnalysisId(config, analysisConfigs)
            : undefined;

          // ── Step 1: Foley + Speech in parallel, then check state after each ──

          // If foley already done and speech is missing, only run speech.
          // If speech already done and foley is missing, only run foley.
          // If both done, skip to step 2 (orchestrate).
          const hasFoley = !!config.foleyResult;
          const hasSpeech = (config.speechResult?.speeches?.length ?? 0) > 0;

          if (!hasFoley || !hasSpeech) {
            const foleyBody = {
              scenario_id: config.scenarioId,
              analysis_id: analysisId,
              llm_model: 'gemini-2.5-flash',
              maximum_sounds: maximumFoleySounds,
            };
            const speechBody = {
              scenario_id: config.scenarioId,
              analysis_id: analysisId,
              llm_model: 'gemini-2.5-flash',
              language: (await import('@/store/audioControlsStore')).useAudioControlsStore.getState().ttsLanguage,
            };

            const foleyPromise = hasFoley ? null : (async () => {
              try {
                const result = await pollLlmJob(
                  '/api/foley-artist',
                  foleyBody,
                  index,
                  'foley',
                  (partial) => {
                    const items = Array.isArray(partial.items) ? partial.items : [];
                    if (items.length === 0) return;
                    const title =
                      (get().analysisConfigs[index] as ScenarioConfig).scenarioResult?.scenarios?.[0]?.title
                      || 'Scenario';
                    const workingResult: FoleyResult = {
                      scenarios: [{ scenario_title: title, sound_events: items as FoleyResult['scenarios'][number]['sound_events'] }],
                      foleyId: '',
                    };
                    const selectedFoleyKeys = workingResult.scenarios.flatMap((s) =>
                      s.sound_events.map((e) => `${s.scenario_title}__${e.soundName}`),
                    );
                    handleUpdateConfig(index, { foleyResult: workingResult, selectedFoleyKeys } as Partial<ScenarioConfig>);
                  },
                );
                const title =
                  (get().analysisConfigs[index] as ScenarioConfig).scenarioResult?.scenarios?.[0]?.title
                  || 'Scenario';
                const scenarios = result?.scenarios ?? [{
                  scenario_title: title,
                  sound_events: result?.sounds ?? [],
                }];
                const finalResult: FoleyResult = {
                  scenarios,
                  foleyId: result?.foley_id ?? '',
                };
                const selectedFoleyKeys = finalResult.scenarios.flatMap((s) =>
                  s.sound_events.map((e) => `${s.scenario_title}__${e.soundName}`),
                );
                handleUpdateConfig(index, { foleyResult: finalResult, selectedFoleyKeys } as Partial<ScenarioConfig>);
              } catch (e) {
                if (e instanceof Error && e.name === 'AbortError') return;
                console.error('[handleFoleyArtist] Foley job error:', e);
                notifySectionError(e instanceof Error ? e.message : 'Foley generation failed');
              }
            })();

            const speechPromise = hasSpeech ? null : (async () => {
              try {
                const result = await pollLlmJob(
                  '/api/speech-agent',
                  speechBody,
                  index,
                  'speech',
                  (partial) => {
                    const items = Array.isArray(partial.items) ? partial.items : [];
                    if (items.length === 0) return;
                    handleUpdateConfig(index, {
                      speechResult: { speeches: items as SpeechResult['speeches'], speechId: '' },
                    } as Partial<ScenarioConfig>);
                  },
                );
                const finalResult: SpeechResult = {
                  speeches: result?.speeches ?? [],
                  speechId: result?.speech_id ?? '',
                };
                handleUpdateConfig(index, { speechResult: finalResult, speechId: finalResult.speechId } as Partial<ScenarioConfig>);
              } catch (e) {
                if (e instanceof Error && e.name === 'AbortError') return;
                console.error('[handleFoleyArtist] Speech job error:', e);
                notifySectionError(e instanceof Error ? e.message : 'Speech generation failed');
              }
            })();

            await Promise.all([foleyPromise, speechPromise]);
          }
        },
      }),
      { name: 'analysisStore' },
    ),
    { partialize: analysisPartialize },
  ),
);

export function applyRecoveredLlmResult(kind: string, configIndex: number, result: any): void {
  const { handleUpdateConfig, analysisConfigs } = useAnalysisStore.getState();
  const config = analysisConfigs[configIndex];
  if (!config) return;

  if (kind === 'analyze_3dmodel' && config.type === 'model-analysis') {
    const objects = (result?.objects ?? []) as ArchitecturalObject[];
    const colorGroups = objects.map((obj, i) => ({
      objectIds: Object.keys(obj.object_ids ?? {}),
      color: getAnalysisGroupColor(i),
    })).filter((g) => g.objectIds.length > 0);
    handleUpdateConfig(configIndex, {
      analysisResult: {
        analysisId: result?.analysis_id ?? '',
        architecturalObjects: objects,
        spaceTitle: result?.space_title,
        spaceDescription: result?.space_description,
      },
    } as Partial<AnalyzeModelConfig>);
    useSpeckleStore.getState().setAnalysisObjectGroups(colorGroups, objects);
    return;
  }

  if (kind === 'scenarist' && config.type === 'scenario') {
    const scenarios = result?.scenarios ?? [];
    const scenarioId = result?.scenario_id ?? '';
    handleUpdateConfig(configIndex, {
      display_name: scenarios?.[0]?.title,
      scenarioResult: { scenarios, scenarioId },
      scenarioId,
    } as Partial<ScenarioConfig>);
    return;
  }

  if (kind === 'foley' && config.type === 'scenario') {
    const title = (config as ScenarioConfig).scenarioResult?.scenarios?.[0]?.title || 'Scenario';
    const scenarios = result?.scenarios ?? [{
      scenario_title: title,
      sound_events: result?.sounds ?? [],
    }];
    const finalResult: FoleyResult = { scenarios, foleyId: result?.foley_id ?? '' };
    const selectedFoleyKeys = finalResult.scenarios.flatMap((s) =>
      s.sound_events.map((e) => `${s.scenario_title}__${e.soundName}`),
    );
    handleUpdateConfig(configIndex, { foleyResult: finalResult, selectedFoleyKeys } as Partial<ScenarioConfig>);
    return;
  }

  if (kind === 'speech' && config.type === 'scenario') {
    handleUpdateConfig(configIndex, {
      speechResult: { speeches: result?.speeches ?? [], speechId: result?.speech_id ?? '' },
      speechId: result?.speech_id ?? '',
    } as Partial<ScenarioConfig>);
  }
}

export function resumeLlmJob(jobId: string, configIndex: number | undefined, kind: string | undefined): void {
  useAnalysisStore.setState({
    isAnalyzing: true,
    analyzingConfigIndex: configIndex ?? null,
    analysisStatus: 'Resuming…',
  });
  _llmJobIds.add(jobId);
  const controller = startPolling({
    fetchStatus: () => apiService.getJobStatus('llm', jobId),
    onStatus: (s) => {
      useAnalysisStore.setState({
        analysisStatus: s.status || '',
        analysisProgress: typeof s.progress === 'number' ? s.progress : 0,
      });
      if (configIndex != null && kind === 'analyze_3dmodel' && s.partial) {
        applyRecoveredLlmResult(kind, configIndex, {
          analysis_id: s.partial.analysis_id,
          objects: s.partial.items,
          space_title: s.partial.space_title,
          space_description: s.partial.space_description,
        });
      }
    },
  });
  llmPollRegistry.track(controller);
  void controller.done
    .then((result) => {
      if (configIndex != null && kind) applyRecoveredLlmResult(kind, configIndex, result);
    })
    .catch(() => {
      /* cancelled / error — flags cleared in finally */
    })
    .finally(() => {
      llmPollRegistry.release(controller);
      _llmJobIds.delete(jobId);
      removeInflightJob(jobId);
      useAnalysisStore.setState({
        isAnalyzing: false,
        analysisStatus: '',
        analysisProgress: 0,
        analyzingConfigIndex: null,
      });
    });
}
