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
} from '@/types/analysis';
import type { CardType } from '@/types/card';
import {
  API_BASE_URL,
  DEFAULT_SPL_DB,
  LLM_SUGGESTED_INTERVAL_SECONDS,
} from '@/utils/constants';
import { loadAudioFileWithBuffer } from '@/lib/audio/utils/audio-info';
import { apiService } from '@/services/api';
import { generatePositionsInArea } from '@/utils/positioning';
import { useErrorsStore } from './errorsStore';
import { useAreaDrawingStore } from './areaDrawingStore';

// ─── Module-level abort ref ───────────────────────────────────────────────────

let _analysisAbortController: AbortController | null = null;

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

  const processNode = (node: any) => {
    if (!node) return;
    processedCount++;

    const hasRenderView = node.model?.renderView || node.renderView;
    const raw = node.raw || node.model?.raw || {};

    const id = raw.id || node.model?.id || node.id || `node-${nodeIndex}`;
    const speckleType = raw.speckle_type || raw.speckle?.type || 'Object';
    const name = raw.name || node.model?.name || extractNameFromType(speckleType);

    if (hasRenderView || raw.speckle_type) {
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

      entities.push({
        id,
        index: nodeIndex++,
        type: speckleType,
        name,
        speckle_type: speckleType,
        raw,
        nodeId: id,
        bounds: boundsData,
      });
    }

    const children = node.model?.children || node.children;
    if (children && Array.isArray(children)) children.forEach(processNode);
  };

  try {
    if (worldTree.tree?._root?.children) {
      worldTree.tree._root.children.forEach(processNode);
    } else if (worldTree._root?.children) {
      worldTree._root.children.forEach(processNode);
    } else if (worldTree.root?.children) {
      worldTree.root.children.forEach(processNode);
    } else if (worldTree.children) {
      worldTree.children.forEach(processNode);
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

  handleTogglePromptSelection: (configIndex: number, promptId: string) => void;
  handleSendToSoundGeneration: (onSuccess?: (prompts: TextPromptResult[]) => void) => TextPromptResult[];
  handleReset: (index: number) => void;

  handleUpdateEntitiesFromWorldTree: (index: number, worldTree: any) => void;
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
            type === '3d-model'
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

            if (config.type === '3d-model') {
              const modelConfig = config as ModelAnalysisConfig;
              if (modelConfig.modelEntities.length === 0) throw new Error('No 3D model loaded');

              if (modelConfig.selectedDiverseEntities.length === 0) {
                // Step 1: select diverse entities
                set({ analysisStatus: 'Selecting diverse entities...' }, false, 'analysis/selectEntities');
                const res = await fetch(`${API_BASE_URL}/api/select-entities`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    entities: modelConfig.modelEntities,
                    max_sounds: config.numSounds,
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
                // Step 2: generate sound prompts
                set({ analysisStatus: 'Generating sound prompts...' }, false, 'analysis/generatePrompts');
                const res = await fetch(`${API_BASE_URL}/api/generate-prompts`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    context: '',
                    num_sounds: config.numSounds,
                    entities: modelConfig.selectedDiverseEntities,
                  }),
                  signal,
                });
                if (!res.ok) throw new Error('Failed to generate sound prompts');
                const textResult = await res.json();
                prompts = textResult.prompts.map((p: any, i: number) => ({
                  id: `${index}-${i}`,
                  text: p.prompt,
                  selected: true,
                  entity: p.entity || null,
                  metadata: {
                    spl_db: p.spl_db || DEFAULT_SPL_DB,
                    interval_seconds: p.interval_seconds || LLM_SUGGESTED_INTERVAL_SECONDS,
                    duration_seconds: p.duration_seconds || 10,
                  },
                }));
              }
            } else if (config.type === 'audio') {
              const audioConfig = config as AudioAnalysisConfig;
              if (!audioConfig.audioFile) throw new Error('No audio file uploaded');

              set({ analysisStatus: 'Analyzing sound events...' }, false, 'analysis/analyzingAudio');

              const formData = new FormData();
              formData.append('file', audioConfig.audioFile);
              formData.append('num_sounds', config.numSounds.toString());
              formData.append(
                'analyze_amplitudes',
                audioConfig.analysisOptions.analyze_amplitudes.toString(),
              );
              formData.append(
                'analyze_durations',
                audioConfig.analysisOptions.analyze_durations.toString(),
              );
              formData.append('top_n_classes', '100');

              const res = await fetch(`${API_BASE_URL}/api/analyze-sound-events`, {
                method: 'POST',
                body: formData,
                signal,
              });
              if (!res.ok) throw new Error('Failed to analyze sound events');
              const result = await res.json();

              prompts = result.detected_sounds
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

              const requestBody: any = { context: textConfig.textInput, num_sounds: config.numSounds };
              if (entitiesToUse.length > 0) requestBody.entities = entitiesToUse;

              const res = await fetch(`${API_BASE_URL}/api/generate-prompts`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody),
                signal,
              });

              if (!res.ok) {
                const err = await res.json().catch(() => ({ detail: 'Failed to generate sound prompts' }));
                const errorMessage = err.detail || 'Failed to generate sound prompts';
                if (res.status === 429) {
                  throw new Error(
                    errorMessage.includes('quota')
                      ? `⚠️ ${errorMessage}`
                      : '⚠️ API quota exhausted. Please try again later.',
                  );
                }
                throw new Error(errorMessage);
              }

              const result = await res.json();
              prompts = result.prompts.map((p: any, i: number) => ({
                id: `${index}-${i}`,
                text: p.prompt,
                selected: true,
                entity: p.entity || null,
                metadata: {
                  spl_db: p.spl_db || DEFAULT_SPL_DB,
                  interval_seconds: p.interval_seconds || LLM_SUGGESTED_INTERVAL_SECONDS,
                  duration_seconds: p.duration_seconds || 10,
                },
              }));

              const drawnArea = useAreaDrawingStore.getState().getArea(index);
              if (drawnArea) {
                const needingPositions = prompts.filter((p) => !p.entity?.position);
                if (needingPositions.length > 0) {
                  const positions = generatePositionsInArea(drawnArea, needingPositions.length);
                  let posIdx = 0;
                  for (const prompt of prompts) {
                    if (!prompt.entity?.position && posIdx < positions.length) {
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
              useErrorsStore.getState().addError(errorMsg, isQuotaError ? 'warning' : 'error');
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

        handleSendToSoundGeneration: (onSuccess) => {
          const { analysisResults } = get();
          const allSelected = analysisResults.flatMap((result) =>
            result.prompts.filter((p) => p.selected),
          );
          if (onSuccess) onSuccess(allSelected);
          return allSelected;
        },

        handleReset: (index) =>
          set(
            (s) => ({
              analysisResults: s.analysisResults.filter((r) => r.configIndex !== index),
            }),
            false,
            'analysis/reset',
          ),

        handleUpdateEntitiesFromWorldTree: (index, worldTree) => {
          const { analysisConfigs, handleUpdateConfig } = get();
          const config = analysisConfigs[index] as ModelAnalysisConfig;
          if (config?.type !== '3d-model' || !config.speckleData) return;
          if (config.modelEntities.length > 0) return;

          const entities = extractSpeckleEntities(worldTree);
          handleUpdateConfig(index, { modelEntities: entities } as Partial<ModelAnalysisConfig>);
        },
      }),
      { name: 'analysisStore' },
    ),
    { partialize: analysisPartialize },
  ),
);
