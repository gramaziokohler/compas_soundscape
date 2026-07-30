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
  ModelAnalysisConfig,
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
  OrchestrateResult,
  FreeformConfig,
} from '@/types/analysis';
import type { CardType } from '@/types/card';
import {
  API_BASE_URL,
  DEFAULT_SPL_DB,
  LLM_SUGGESTED_INTERVAL_SECONDS,
  TTS_VOICES,
} from '@/utils/constants';
import { loadAudioFileWithBuffer } from '@/lib/audio/utils/audio-info';
import { apiService } from '@/services/api';
import { generatePositionsInArea } from '@/utils/positioning';
import { getAnalysisGroupColor } from '@/utils/utils';
import { notifyError } from './errorsStore';
import { useAreaDrawingStore } from './areaDrawingStore';
import { useSoundscapeStore } from './soundscapeStore';
import { useSpeckleStore } from './speckleStore';
import { useObjectExplorerStore } from './objectExplorerStore';

// ─── Module-level refs ────────────────────────────────────────────────────────

let _analysisAbortController: AbortController | null = null;
let _sedTaskId: string | null = null;
let _sedPollInterval: ReturnType<typeof setInterval> | null = null;

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

// ─── Partialize ───────────────────────────────────────────────────────────────

export const analysisPartialize = (state: AnalysisStoreState) => ({
  analysisConfigs: state.analysisConfigs.map((config) => {
    // Omit non-serializable objects (File, ArrayBuffer) from undo history
    if (config.type === 'audio') {
      // Store audioFile as null so code never tries to use it as a Blob after undo
      return { ...config, audioFile: null, audioBuffer: null };
    }
    if (config.type === '3d-model') {
      return { ...config, modelFile: null, geometryData: undefined };
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

// ─── State ────────────────────────────────────────────────────────────────────

export interface AnalysisStoreState {
  analysisConfigs: AnalysisConfig[];
  activeAnalysisTab: number;
  isAnalyzing: boolean;
  analysisError: string | null;
  analysisResults: AnalysisResult[];
  /** Indices of configs currently being uploaded. Not in zundo history. */
  uploadingConfigs: Set<number>;
  analysisStatus: string;
  analyzingConfigIndex: number | null;

  handleAddConfig: (type: CardType, initialSpeckleData?: any) => void;
  handleRemoveConfig: (index: number) => void;
  handleUpdateConfig: (index: number, updates: Partial<AnalysisConfig>) => void;
  setActiveAnalysisTab: (index: number) => void;

  handleModelFileUpload: (index: number, file: File, worldTree?: any) => Promise<void>;
  handleAudioFileUpload: (index: number, file: File) => Promise<void>;

  handleAnalyze: (
    index: number,
    contextData?: { diverseObjectIds?: Set<string>; viewerRef?: any },
  ) => Promise<void>;
  handleStopAnalysis: () => void;

  handleReorderConfigs: (from: number, to: number) => void;
  /** Ctrl+drag duplicate — deep-clones the config at `from` (and its result) and inserts at `toInsertion`. */
  duplicateConfigAt: (from: number, toInsertion: number) => void;

  handleTogglePromptSelection: (configIndex: number, promptId: string) => void;
  handleSendToSoundGeneration: (onSuccess?: (prompts: TextPromptResult[]) => void, onlyConfigIndex?: number) => TextPromptResult[];
  handleReset: (index: number) => void;

  handleUpdateEntitiesFromWorldTree: (index: number, worldTree: any) => void;

  handleAnalyzeModel: (index: number) => Promise<void>;
  handleUpdateAnalysisObject: (
    configIndex: number,
    objectIndex: number,
    updates: Partial<Pick<ArchitecturalObject, 'name' | 'description' | 'material'>>,
  ) => Promise<void>;

  handleScenarioAnalyze: (index: number) => Promise<void>;
  handleFoleyArtist: (index: number) => Promise<void>;
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
        analysisStatus: '',
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
              : type === '3d-model'
              ? {
                  type: '3d-model',
                  numSounds: 5,
                  modelFile: null,
                  modelEntities: [],
                  selectedDiverseEntities: [],
                  useModelAsContext: true,
                  speckleData: initialSpeckleData,
                  geometryData: undefined,
                }
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
                    useModelAsContext: false,
                  };

          set(
            { analysisConfigs: [...analysisConfigs, newConfig], activeAnalysisTab: analysisConfigs.length },
            false,
            'analysis/addConfig',
          );
        },

        handleRemoveConfig: (index) => {
          const { analysisConfigs, activeAnalysisTab, analysisResults } = get();
          const newConfigs = analysisConfigs.filter((_, i) => i !== index);
          const newResults = analysisResults.filter((r) => r.configIndex !== index);
          const newTab =
            activeAnalysisTab >= analysisConfigs.length - 1
              ? Math.max(0, analysisConfigs.length - 2)
              : activeAnalysisTab;
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

          // Insert the clone — toInsertion is the gap index (0 = before first, n = after last).
          // If the clone lands at or after the source, shift by -1 since the clone is inserted
          // before the source shifts.
          const newConfigs = [...analysisConfigs];
          const insertAt = toInsertion > from ? toInsertion - 1 : toInsertion;
          newConfigs.splice(insertAt, 0, cloned);

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

        handleModelFileUpload: async (index, file, worldTree) => {
          const { analysisConfigs, uploadingConfigs, handleUpdateConfig } = get();
          const config = analysisConfigs[index] as ModelAnalysisConfig;
          if (config?.type !== '3d-model') return;
          if (uploadingConfigs.has(index)) return;

          set(
            (s) => ({ uploadingConfigs: new Set([...s.uploadingConfigs, index]) }),
            false,
            'analysis/uploadStart',
          );
          try {
            const uploadResponse = await apiService.uploadFile(file);
            const geometryData =
              'geometry' in uploadResponse ? uploadResponse.geometry : uploadResponse;
            const speckleData = 'speckle' in uploadResponse ? uploadResponse.speckle : undefined;

            let entities: any[] = [];
            if (speckleData && worldTree) {
              entities = extractSpeckleEntities(worldTree);
            }

            handleUpdateConfig(index, {
              modelFile: file,
              modelEntities: entities,
              geometryData,
              speckleData,
            } as Partial<ModelAnalysisConfig>);
          } catch (error) {
            set(
              {
                analysisError:
                  error instanceof Error ? error.message : 'Failed to upload model',
              },
              false,
              'analysis/uploadError',
            );
          } finally {
            set(
              (s) => {
                const next = new Set(s.uploadingConfigs);
                next.delete(index);
                return { uploadingConfigs: next };
              },
              false,
              'analysis/uploadEnd',
            );
          }
        },

        handleAudioFileUpload: async (index, file) => {
          const { analysisConfigs, handleUpdateConfig } = get();
          const config = analysisConfigs[index] as AudioAnalysisConfig;
          if (config?.type !== 'audio') return;

          try {
            const result = await loadAudioFileWithBuffer(file);
            if (result) {
              handleUpdateConfig(index, {
                audioFile: file,
                audioInfo: result.audioInfo,
                audioBuffer: result.audioBuffer,
              } as Partial<AudioAnalysisConfig>);
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

        handleAnalyze: async (index, contextData) => {
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
              if (sc.orchestrateResult) {
                // Full pipeline already completed — re-send to generation
                get().handleSendToSoundGeneration(undefined, index);
                return;
              } else if (sc.foleyResult && sc.speechResult) {
                // Foley + speech done → run orchestrate
                await get().handleFoleyArtist(index);
              } else if (sc.scenarioResult) {
                // Scenario generated → call foley artist
                await get().handleFoleyArtist(index);
              } else {
                await get().handleScenarioAnalyze(index);
              }
              return;
            } else if (config.type === '3d-model') {
              const modelConfig = config as ModelAnalysisConfig;
              if (modelConfig.modelEntities.length === 0) throw new Error('No 3D model loaded');

              if (modelConfig.selectedDiverseEntities.length === 0) {
                // Step 1: select diverse entities
                set({ analysisStatus: 'Selecting diverse entities...' }, false, 'analysis/selectEntities');
                const hiddenIds = useObjectExplorerStore.getState().hiddenObjectIds;
                const visibleEntities = modelConfig.modelEntities.filter(
                  (e: any) => !hiddenIds.has(e.id),
                );
                const res = await fetch(`${API_BASE_URL}/api/select-entities`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    entities: visibleEntities,
                    max_sounds: config.numSounds,
                    llm_model: useSoundscapeStore.getState().llmModel,
                  }),
                  signal,
                });
                if (!res.ok) throw new Error('Failed to select diverse entities');
                const selectionResult = await res.json();
                handleUpdateConfig(index, {
                  selectedDiverseEntities: selectionResult.selected_entities,
                } as Partial<ModelAnalysisConfig>);
                set({ isAnalyzing: false, analysisError: null, analysisStatus: '', analyzingConfigIndex: null }, false, 'analysis/selectionDone');
                return;
              } else {
                // Step 2: stream sound prompts one by one
                set({ analysisStatus: 'Generating sound prompts...' }, false, 'analysis/generatePrompts');
                const hiddenIdsForPrompts = useObjectExplorerStore.getState().hiddenObjectIds;
                const visibleDiverseEntities = modelConfig.selectedDiverseEntities.filter(
                  (e: any) => !hiddenIdsForPrompts.has(e.id),
                );
                let soundIdx = 0;
                for await (const event of streamPrompts(
                  `${API_BASE_URL}/api/generate-prompts-stream`,
                  {
                    context: '',
                    num_sounds: config.numSounds,
                    entities: visibleDiverseEntities,
                    llm_model: useSoundscapeStore.getState().llmModel,
                  },
                  signal,
                )) {
                  if (event.type !== 'sound') continue;
                  const { type: _t, ...p } = event;
                  const prompt: TextPromptResult = {
                    id: `${index}-${soundIdx++}`,
                    text: p.prompt,
                    selected: true,
                    entities: p.entities || (p.entity ? [p.entity] : undefined),
                    entity: p.entities?.[0] || p.entity || null, // backward compat
                    metadata: {
                      spl_db: p.spl_db || DEFAULT_SPL_DB,
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
              }
            } else if (config.type === 'audio') {
              const audioConfig = config as AudioAnalysisConfig;
              if (!audioConfig.audioFile) throw new Error('No audio file uploaded');

              set({ analysisStatus: 'Uploading audio file...' }, false, 'analysis/analyzingAudio');

              const formData = new FormData();
              formData.append('file', audioConfig.audioFile);
              formData.append('num_sounds', (config.numSounds ?? 5).toString());
              formData.append(
                'analyze_amplitudes',
                audioConfig.analysisOptions.analyze_amplitudes.toString(),
              );
              formData.append(
                'analyze_durations',
                audioConfig.analysisOptions.analyze_durations.toString(),
              );
              formData.append('top_n_classes', '100');

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
                .filter((s: any) => s.confidence > 0)
                .slice(0, config.numSounds)
                .map((sound: any, i: number) => {
                  let volumeSPL = DEFAULT_SPL_DB;
                  if (
                    audioConfig.analysisOptions.analyze_amplitudes &&
                    sound.max_amplitude_db !== null &&
                    isFinite(sound.max_amplitude_db)
                  ) {
                    const dbFS = Math.max(-60, Math.min(-3, sound.max_amplitude_db));
                    volumeSPL = Math.round((30 + ((dbFS + 60) / 57) * 55) * 10) / 10;
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
                      spl_db: volumeSPL,
                      interval_seconds: playbackInterval,
                      duration_seconds: estimatedDuration,
                      detection_segments: sound.detection_segments ?? [],
                    },
                  };
                });
            } else if (config.type === 'text') {
              const textConfig = config as TextAnalysisConfig;
              if (!textConfig.textInput.trim()) throw new Error('Please enter a text description');

              set({ analysisStatus: 'Generating sound prompts...' }, false, 'analysis/generatingText');

              let entitiesToUse: any[] = [];
              if (textConfig.useModelAsContext) {
                const diverseIds = contextData?.diverseObjectIds;
                if (diverseIds && diverseIds.size > 0) {
                  const allEntities = (get().analysisConfigs as ModelAnalysisConfig[])
                    .filter((c) => c.type === '3d-model')
                    .flatMap((c) => c.modelEntities);
                  entitiesToUse = allEntities.filter((entity) =>
                    diverseIds.has(entity.nodeId || entity.id),
                  );

                  if (entitiesToUse.length === 0 && contextData?.viewerRef?.current) {
                    const worldTree = contextData.viewerRef.current.getWorldTree();
                    if (worldTree) {
                      const allWtEntities = extractSpeckleEntities(worldTree);
                      entitiesToUse = allWtEntities.filter((entity) =>
                        diverseIds.has(entity.nodeId || entity.id),
                      );
                    }
                  }
                } else {
                  const modelConfigs = get().analysisConfigs.filter(
                    (c) => c.type === '3d-model',
                  ) as ModelAnalysisConfig[];
                  if (modelConfigs.length > 0) {
                    const latest = modelConfigs[modelConfigs.length - 1];
                    entitiesToUse =
                      latest.selectedDiverseEntities.length > 0
                        ? latest.selectedDiverseEntities
                        : latest.modelEntities;
                  }
                }
              }

              const requestBody: any = { context: textConfig.textInput, num_sounds: config.numSounds, llm_model: useSoundscapeStore.getState().llmModel };
              if (entitiesToUse.length > 0) requestBody.entities = entitiesToUse;

              let soundIdx = 0;
              for await (const event of streamPrompts(
                `${API_BASE_URL}/api/generate-prompts-stream`,
                requestBody,
                signal,
              )) {
                if (event.type !== 'sound') continue;
                const { type: _t, ...p } = event;
                const prompt: TextPromptResult = {
                  id: `${index}-${soundIdx++}`,
                  text: p.prompt,
                  selected: true,
                  entities: p.entities || (p.entity ? [p.entity] : undefined),
                  entity: p.entities?.[0] || p.entity || null, // backward compat
                  metadata: {
                    spl_db: p.spl_db || DEFAULT_SPL_DB,
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

              const drawnArea = useAreaDrawingStore.getState().getArea(index);
              if (drawnArea) {
                const needingPositions = prompts.filter((p) => !(p.entities?.[0]?.position || p.entity?.position));
                if (needingPositions.length > 0) {
                  const positions = generatePositionsInArea(drawnArea, needingPositions.length);
                  let posIdx = 0;
                  for (const prompt of prompts) {
                    if (!(prompt.entities?.[0]?.position || prompt.entity?.position) && posIdx < positions.length) {
                      (prompt as any).position = positions[posIdx++];
                    }
                  }
                }
                useAreaDrawingStore.getState().setAreaVisualState(index, 'generated');
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
              notifyError(errorMsg, isQuotaError ? 'warning' : 'error');
              set({ analysisError: errorMsg }, false, 'analysis/analyzeError');
            }
          } finally {
            _analysisAbortController = null;
            set({ isAnalyzing: false, analysisStatus: '', analyzingConfigIndex: null }, false, 'analysis/analyzeEnd');
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
          set({ isAnalyzing: false, analysisStatus: '', analyzingConfigIndex: null }, false, 'analysis/stop');
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

                const splMatch = entry.spl?.match(/(\d+(?:\.\d+)?)/);
                const splDb = splMatch ? parseFloat(splMatch[1]) : DEFAULT_SPL_DB;

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
                  // Prefer the character chosen by the speech agent: it is a TTS voice
                  // label (e.g. "Clara") — map it back to its Gemini voice value.
                  const character = (entry.character || '').trim();
                  const matched = character
                    ? TTS_VOICES.find(
                        (v) => v.label.toLowerCase() === character.toLowerCase(),
                      )
                    : undefined;
                  if (matched) {
                    voiceName = matched.value;
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
                    spl_db: splDb,
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
            } else if (sc.foleyResult) {
            // Legacy foley path (fallback when orchestrate is not available)
            const selectedKeys = new Set(sc.selectedFoleyKeys ?? []);
            sc.foleyResult.scenarios.forEach((scenario, si) => {
              scenario.sound_events.forEach((sound, ei) => {
                const key = `${scenario.scenario_title}__${sound.soundName}`;
                if (!selectedKeys.has(key)) return;
                const splMatch = sound.spl?.match(/(\d+(?:\.\d+)?)/);
                const splDb = splMatch ? parseFloat(splMatch[1]) : DEFAULT_SPL_DB;
                const durationSec = (() => {
                  const d = sound.duration ?? '';
                  const colonIdx = d.indexOf(':');
                  if (colonIdx !== -1) {
                    const mm = parseFloat(d.slice(0, colonIdx)) || 0;
                    const ss = parseFloat(d.slice(colonIdx + 1)) || 0;
                    return mm * 60 + ss;
                  }
                  const n = parseFloat(d);
                  return isNaN(n) ? 5 : n;
                })();
                const pos = sound.position;
                const involvedIds = sound.objectsInvolved?.filter(Boolean) ?? [];
                const linkedObjectId = involvedIds.length > 0
                  ? involvedIds[Math.floor(Math.random() * involvedIds.length)]
                  : null;
                const normalizedCategory = (sound.category || '').toLowerCase().replace(/[\s-]+/g, '_');
                const isBgFoley = normalizedCategory === 'background' || normalizedCategory === 'background_sound';
                foleyPrompts.push({
                  id: `foley-${sc.foleyResult!.foleyId}-${si}-${ei}`,
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
                    spl_db: splDb,
                    duration_seconds: isBgFoley ? 10 : durationSec,
                    interval_seconds: LLM_SUGGESTED_INTERVAL_SECONDS,
                    timestamps: isBgFoley ? undefined : (sound.timestamps?.length ? sound.timestamps : undefined),
                    category: sound.category,
                  },
                });
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
          const signal = _analysisAbortController.signal;

          set(
            { isAnalyzing: true, analysisError: null, analyzingConfigIndex: index, analysisStatus: 'Analyzing 3D model...' },
            false,
            'analysis/analyzeModelStart',
          );

          const objects: ArchitecturalObject[] = [];
          const colorGroups: { objectIds: string[]; color: string }[] = [];
          let analysisId = '';
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

            // Use speckleStore's explorer hidden IDs — kept in sync by
            // useSpeckleFiltering.hideObjects → trackExplorerHide, which is what
            // the ObjectExplorer uses. objectExplorerStore._viewerRef is never
            // set so its syncFromExtension() is a no-op.
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

            for await (const event of streamPrompts(
              `${API_BASE_URL}/api/analyze-3dmodel-stream`,
              {
                entities: visibleEntitiesForAnalysis,
                screenshots: config.liveScreenshots,
                user_context: config.userContext,
                llm_model: useSoundscapeStore.getState().llmModel,
              },
              signal,
            )) {
              if (event.type === 'start') {
                analysisId = event.analysis_id;
              } else if (event.type === 'space_description') {
                spaceDescription = event.text || '';
                handleUpdateConfig(index, {
                  analysisResult: { analysisId, architecturalObjects: [...objects], spaceDescription },
                } as Partial<AnalyzeModelConfig>);
              } else if (event.type === 'object') {
                const { type: _t, ...obj } = event;
                const archObj = obj as ArchitecturalObject;
                objects.push(archObj);
                const idx = objects.length - 1;
                const color = getAnalysisGroupColor(idx);
                const ids = Object.keys(archObj.object_ids ?? {});
                if (ids.length > 0) {
                  colorGroups.push({ objectIds: ids, color });
                }
                // Partial update
                useSpeckleStore.getState().setAnalysisObjectGroups([...colorGroups], [...objects]);
                handleUpdateConfig(index, {
                  analysisResult: { analysisId, architecturalObjects: [...objects], spaceDescription },
                } as Partial<AnalyzeModelConfig>);
              } else if (event.type === 'done') {
                // Final update handled below
              }
            }

            const resultData: ModelAnalysisResultData = {
              analysisId,
              architecturalObjects: objects,
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
              notifyError(errorMsg, isQuota ? 'warning' : 'error');
              set({ analysisError: errorMsg }, false, 'analysis/analyzeModelError');
            }
          } finally {
            _analysisAbortController = null;
            set({ isAnalyzing: false, analysisStatus: '', analyzingConfigIndex: null }, false, 'analysis/analyzeModelEnd');
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

        handleUpdateEntitiesFromWorldTree: (index, worldTree) => {
          const { analysisConfigs, handleUpdateConfig } = get();
          const config = analysisConfigs[index] as ModelAnalysisConfig;
          if (config?.type !== '3d-model' || !config.speckleData) return;
          if (config.modelEntities.length > 0) return;

          const entities = extractSpeckleEntities(worldTree);
          handleUpdateConfig(index, { modelEntities: entities } as Partial<ModelAnalysisConfig>);
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
            analyzingConfigIndex: null,
          });
        },

        handleScenarioAnalyze: async (index) => {
          const { analysisConfigs, handleUpdateConfig } = get();
          const config = analysisConfigs[index] as ScenarioConfig;
          if (config?.type !== 'scenario') return;

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

          // Find analysis_id from the most recent 'model-analysis' config with a result
          let analysisId: string | undefined;
          if (config.useAnalysisResult) {
            // Prefer the model-analysis context card this usage card is parented to,
            // so each usage card uses its own parent context's analysis result rather
            // than always falling back to the first model-analysis card.
            const parentIdx = (config as AnalysisBaseConfig).parentContextOriginalIndex;
            let analyzeConfig: AnalyzeModelConfig | undefined;
            if (parentIdx !== undefined) {
              const parent = analysisConfigs[parentIdx];
              if (
                parent?.type === 'model-analysis' &&
                (parent as AnalyzeModelConfig).analysisResult?.analysisId
              ) {
                analyzeConfig = parent as AnalyzeModelConfig;
              }
            }
            if (!analyzeConfig && parentIdx === undefined) {
              analyzeConfig = analysisConfigs.find(
                (c) => c.type === 'model-analysis' && (c as AnalyzeModelConfig).analysisResult?.analysisId,
              ) as AnalyzeModelConfig | undefined;
            }
            analysisId = analyzeConfig?.analysisResult?.analysisId ?? undefined;
          }

          const { timelineDurationMs } = await import('@/store/audioControlsStore').then(
            (m) => m.useAudioControlsStore.getState(),
          );

          const body = {
            user_context: config.userContext || undefined,
            llm_model: 'gemini-2.5-flash',
            analysis_id: analysisId,
            people_count: config.peopleCount,
            likeliness: config.likeliness,
            duration: Math.round(timelineDurationMs / 1000),
          };

          const controller = new AbortController();
          // Working scenarios being built progressively
          let workingScenarios: ScenarioResult['scenarios'] = [];

          try {
            for await (const event of streamPrompts(
              `${API_BASE_URL}/api/scenarist-stream`,
              body,
              controller.signal,
            )) {
              if (event.type === 'scenario') {
                // New scenario header — add slot with empty events array
                const { scenario_index, title, duration, peopleCount, likeliness } = event as {
                  scenario_index: number; title: string; duration: string;
                  peopleCount: number; likeliness: number;
                };
                const next = [...workingScenarios];
                next[scenario_index] = { title, duration, peopleCount, likeliness, events: [] };
                workingScenarios = next;
                handleUpdateConfig(index, {
                  display_name: title,
                  scenarioResult: { scenarios: workingScenarios, scenarioId: '' },
                } as Partial<ScenarioConfig>);
              } else if (event.type === 'event') {
                // Timestamped event for an existing scenario slot
                const { scenario_index, event: ev } = event as {
                  scenario_index: number; event: { timestamp: string; description: string };
                };
                if (workingScenarios[scenario_index]) {
                  const next = [...workingScenarios];
                  next[scenario_index] = {
                    ...next[scenario_index],
                    events: [...next[scenario_index].events, ev],
                  };
                  workingScenarios = next;
                  handleUpdateConfig(index, {
                    scenarioResult: { scenarios: workingScenarios, scenarioId: '' },
                  } as Partial<ScenarioConfig>);
                }
              } else if (event.type === 'done') {
                const result = event.result as ScenarioResult;
                const scenarioId = (event.scenario_id as string) ?? null;
                handleUpdateConfig(index, {
                  scenarioResult: { ...result, scenarioId: scenarioId ?? '' },
                  scenarioId,
                } as Partial<ScenarioConfig>);
              } else if (event.type === 'error') {
                console.error('[handleScenarioAnalyze] SSE error:', event.message);
              }
            }
          } catch (e) {
            console.error('[handleScenarioAnalyze] stream error:', e);
          }
        },

        handleFoleyArtist: async (index) => {
          const { analysisConfigs, handleUpdateConfig } = get();
          const config = analysisConfigs[index] as ScenarioConfig;
          if (config?.type !== 'scenario' || !config.scenarioId) return;

          const { maximumFoleySounds } = await import('@/store/audioControlsStore').then(
            (m) => m.useAudioControlsStore.getState(),
          );

          let analysisId: string | undefined;
          if (config.useAnalysisResult) {
            // Prefer the model-analysis context card this usage card is parented to,
            // so each usage card uses its own parent context's analysis result rather
            // than always falling back to the first model-analysis card.
            const parentIdx = (config as AnalysisBaseConfig).parentContextOriginalIndex;
            let analyzeConfig: AnalyzeModelConfig | undefined;
            if (parentIdx !== undefined) {
              const parent = analysisConfigs[parentIdx];
              if (
                parent?.type === 'model-analysis' &&
                (parent as AnalyzeModelConfig).analysisResult?.analysisId
              ) {
                analyzeConfig = parent as AnalyzeModelConfig;
              }
            }
            if (!analyzeConfig && parentIdx === undefined) {
              analyzeConfig = analysisConfigs.find(
                (c) => c.type === 'model-analysis' && (c as AnalyzeModelConfig).analysisResult?.analysisId,
              ) as AnalyzeModelConfig | undefined;
            }
            analysisId = analyzeConfig?.analysisResult?.analysisId ?? undefined;
          }

          // ── Step 1: Foley + Speech in parallel, then check state after each ──

          // If foley already done and speech is missing, only run speech.
          // If speech already done and foley is missing, only run foley.
          // If both done, skip to step 2 (orchestrate).
          const hasFoley = !!config.foleyResult;
          const hasSpeech = !!config.speechResult;

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
              const controller = new AbortController();
              let workingResult: FoleyResult = config.foleyResult || { scenarios: [], foleyId: '' };
              const workingKeys: string[] = [...(config.selectedFoleyKeys ?? [])];
              try {
                for await (const event of streamPrompts(
                  `${API_BASE_URL}/api/foley-artist-stream`,
                  foleyBody,
                  controller.signal,
                )) {
                  if (event.type === 'sound') {
                    const { scenario_title, sound } = event as {
                      scenario_title: string; scenario_index: number; sound: FoleyResult['scenarios'][number]['sound_events'][number];
                    };
                    const key = `${scenario_title}__${sound.soundName}`;
                    workingKeys.push(key);
                    const newScenarios = [...workingResult.scenarios];
                    const si = newScenarios.findIndex((s) => s.scenario_title === scenario_title);
                    if (si === -1) {
                      newScenarios.push({ scenario_title, sound_events: [sound] });
                    } else {
                      newScenarios[si] = {
                        ...newScenarios[si],
                        sound_events: [...newScenarios[si].sound_events, sound],
                      };
                    }
                    workingResult = { ...workingResult, scenarios: newScenarios };
                    handleUpdateConfig(index, {
                      foleyResult: workingResult,
                      selectedFoleyKeys: [...workingKeys],
                    } as Partial<ScenarioConfig>);
                  } else if (event.type === 'done') {
                    const finalResult: FoleyResult = {
                      scenarios: event.result?.scenarios ?? workingResult.scenarios,
                      foleyId: (event.foley_id as string) ?? '',
                    };
                    const selectedFoleyKeys = finalResult.scenarios.flatMap((s) =>
                      s.sound_events.map((e) => `${s.scenario_title}__${e.soundName}`),
                    );
                    handleUpdateConfig(index, { foleyResult: finalResult, selectedFoleyKeys } as Partial<ScenarioConfig>);
                  } else if (event.type === 'error') {
                    console.error('[handleFoleyArtist] Foley SSE error:', event.message);
                  }
                }
              } catch (e) {
                console.error('[handleFoleyArtist] Foley stream error:', e);
              }
            })();

            const speechPromise = hasSpeech ? null : (async () => {
              const controller = new AbortController();
              let workingSpeechResult: SpeechResult = config.speechResult || { speeches: [], speechId: '' };
              try {
                for await (const event of streamPrompts(
                  `${API_BASE_URL}/api/speech-agent-stream`,
                  speechBody,
                  controller.signal,
                )) {
                  if (event.type === 'speech') {
                    const { speech } = event;
                    const newSpeeches = [...workingSpeechResult.speeches, speech];
                    workingSpeechResult = { ...workingSpeechResult, speeches: newSpeeches };
                    handleUpdateConfig(index, {
                      speechResult: workingSpeechResult,
                    } as Partial<ScenarioConfig>);
                  } else if (event.type === 'done') {
                    const finalResult: SpeechResult = {
                      speeches: event.result?.speeches ?? workingSpeechResult.speeches,
                      speechId: (event.speech_id as string) ?? '',
                    };
                    handleUpdateConfig(index, { speechResult: finalResult, speechId: finalResult.speechId } as Partial<ScenarioConfig>);
                  } else if (event.type === 'error') {
                    console.error('[handleFoleyArtist] Speech SSE error:', event.message);
                  }
                }
              } catch (e) {
                console.error('[handleFoleyArtist] Speech stream error:', e);
              }
            })();

            await Promise.all([foleyPromise, speechPromise]);
          }

          // ── Step 2: Orchestrate (foley + speech → playlist) ──
          const updatedConfig = get().analysisConfigs[index] as ScenarioConfig;
          const foleyId = updatedConfig.foleyResult?.foleyId;
          const speechId = updatedConfig.speechResult?.speechId;

          if (!foleyId || !speechId) {
            console.error('[handleFoleyArtist] Missing foley or speech result for orchestrate');
            return;
          }

          const orchestrateBody = {
            scenario_id: config.scenarioId,
            foley_id: foleyId,
            speech_id: speechId,
            llm_model: 'gemini-2.5-flash',
          };

          const orchestrator = new AbortController();
          let workingOrchestrate: OrchestrateResult = { playlist: [], orchestrateId: '' };

          try {
            for await (const event of streamPrompts(
              `${API_BASE_URL}/api/orchestrate-stream`,
              orchestrateBody,
              orchestrator.signal,
            )) {
              if (event.type === 'entry') {
                const entry = event.entry as OrchestrateResult['playlist'][number];
                workingOrchestrate = {
                  ...workingOrchestrate,
                  playlist: [...workingOrchestrate.playlist, entry],
                };
                handleUpdateConfig(index, {
                  orchestrateResult: workingOrchestrate,
                } as Partial<ScenarioConfig>);
              } else if (event.type === 'done') {
                const finalResult: OrchestrateResult = {
                  playlist: event.result?.playlist ?? workingOrchestrate.playlist,
                  orchestrateId: (event.orchestrate_id as string) ?? '',
                };
                handleUpdateConfig(index, {
                  orchestrateResult: finalResult,
                  orchestrateId: finalResult.orchestrateId,
                } as Partial<ScenarioConfig>);
              } else if (event.type === 'error') {
                console.error('[handleFoleyArtist] Orchestrate SSE error:', event.message);
              }
            }
          } catch (e) {
            console.error('[handleFoleyArtist] Orchestrate stream error:', e);
            return;
          }

          // ── Step 3: Send orchestrate results to sound generation ──
          get().handleSendToSoundGeneration(undefined, index);
        },
      }),
      { name: 'analysisStore' },
    ),
    { partialize: analysisPartialize },
  ),
);
