/**
 * Soundscape Store
 *
 * Replaces useSoundGeneration. Manages sound configuration cards, sound
 * generation (backend/ElevenLabs/library/upload), and the resulting
 * soundscape event data.
 *
 * geometryBounds is now read from useFileUploadStore instead of being a prop.
 * AbortController is kept as a module-level ref (non-serializable).
 *
 * zundo partializes on soundConfigs (excluding blob URLs/buffers) + global settings.
 */

import { create } from 'zustand';
import { temporal } from 'zundo';
import { devtools } from 'zustand/middleware';
import type { SoundGenerationConfig, CardType, LibrarySearchResult, CatalogSoundSelection } from '@/types';
import {
  API_BASE_URL,
  DEFAULT_DURATION_SECONDS,
  DEFAULT_GUIDANCE_SCALE,
  DEFAULT_DIFFUSION_STEPS,
  DEFAULT_SEED_COPIES,
  DEFAULT_AUDIO_MODEL,
  DEFAULT_LLM_MODEL,
  AUDIO_MODEL_ELEVENLABS,
  LIBRARY_MAX_SEARCH_RESULTS,
  DUPLICATE_POSITION_OFFSET,
  DEFAULT_SPL_DB,
} from '@/utils/constants';
import { loadAudioFile, revokeAudioUrl } from '@/lib/audio/utils/audio-upload';
import { calculateSoundPosition, type GeometryBounds } from '@/utils/positioning';
import { createSoundEventFromUpload } from '@/utils/event-factory';
import { generateSoundEffect } from '@/services/elevenlabs.mts';
import { apiService } from '@/services/api';
import { useErrorsStore } from './errorsStore';
import { useFileUploadStore } from './fileUploadStore';
import { useAudioControlsStore } from './audioControlsStore';

// ─── Module-level refs ────────────────────────────────────────────────────────

let _abortController: AbortController | null = null;
let _currentGenerationId: string | null = null;
let _soundPollInterval: ReturnType<typeof setInterval> | null = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function calibrateBlobUrl(
  blobOrUrl: Blob | string,
  splDb: number,
  applyDenoising: boolean,
): Promise<string> {
  const blob =
    typeof blobOrUrl === 'string' ? await fetch(blobOrUrl).then((r) => r.blob()) : blobOrUrl;
  const { url } = await apiService.calibrateAudio(blob, splDb, applyDenoising);
  return url;
}

function reindexSounds(sounds: any[], removedIndex: number): any[] {
  return sounds
    .filter((s: any) => s.prompt_index !== removedIndex)
    .map((s: any) => ({
      ...s,
      prompt_index: s.prompt_index > removedIndex ? s.prompt_index - 1 : s.prompt_index,
    }));
}

// ─── Partialize ───────────────────────────────────────────────────────────────

export const soundscapePartialize = (state: SoundscapeStoreState) => ({
  soundConfigs: state.soundConfigs.map((c) => ({
    ...c,
    // Omit non-serializable blob data from undo history
    uploadedAudioBuffer: undefined,
    uploadedAudioUrl: undefined,
    // Never restore a "searching in progress" state after undo
    librarySearchState: c.librarySearchState
      ? { ...c.librarySearchState, isSearching: false }
      : undefined,
  })),
  generatedSounds: state.generatedSounds,
  soundscapeData: state.soundscapeData,
  globalDuration: state.globalDuration,
  globalSteps: state.globalSteps,
  globalNegativePrompt: state.globalNegativePrompt,
  applyDenoising: state.applyDenoising,
  audioModel: state.audioModel,
  llmModel: state.llmModel,
});

// ─── State ────────────────────────────────────────────────────────────────────

export interface SoundscapeStoreState {
  soundConfigs: SoundGenerationConfig[];
  activeSoundConfigTab: number;
  isSoundGenerating: boolean;
  soundGenError: string | null;
  soundGenProgress: string;
  soundGenProgressValue: number;
  generatedSounds: any[];
  soundscapeData: any[] | null;
  globalDuration: number;
  globalSteps: number;
  globalNegativePrompt: string;
  applyDenoising: boolean;
  audioModel: string;
  llmModel: string;

  handleAddConfig: (type?: CardType) => void;
  handleBatchAddConfigs: (count: number) => number;
  handleRemoveConfig: (index: number) => void;
  handleUpdateConfig: (index: number, field: keyof SoundGenerationConfig, value: any) => void;
  handleTypeChange: (index: number, type: CardType) => Promise<void>;
  handleGlobalDurationChange: (duration: number) => void;
  handleGlobalStepsChange: (steps: number) => void;
  handleGenerate: () => Promise<void>;
  handleStopGeneration: () => void;
  handleReprocessSounds: (applyDenoising: boolean) => Promise<void>;
  setActiveSoundConfigTab: (tab: number) => void;
  setSoundConfigsFromPrompts: (prompts: any[]) => void;
  setSoundscapeData: (data: any[] | null) => void;
  setGlobalNegativePrompt: (val: string) => void;
  setApplyDenoising: (val: boolean) => void;
  setAudioModel: (model: string) => void;
  setLlmModel: (model: string) => void;
  handleUploadAudio: (index: number, file: File) => Promise<void>;
  handleClearUploadedAudio: (index: number) => void;
  handleLibrarySearch: (index: number) => Promise<void>;
  handleLibrarySoundSelect: (index: number, sound: LibrarySearchResult) => void;
  handleCatalogSoundSelect: (index: number, sound: CatalogSoundSelection) => void;
  handleResetToDefaults: () => void;
  handleResetSoundConfig: (index: number) => void;
  handleReorderSoundConfigs: (from: number, to: number) => void;
  handleDuplicateConfig: (index: number) => void;
  handleDetachSoundFromEntity: (index: number) => void;
  handleAttachSoundToEntity: (index: number, entity: any) => void;
  updateSoundPosition: (soundId: string, position: [number, number, number]) => void;
  restoreSoundscape: (
    configs: SoundGenerationConfig[],
    events: any[],
    settings?: { negativePrompt?: string; audioModel?: string },
  ) => void;
  injectExtractedSEDSounds: (sounds: Array<{
    name: string;
    spl_db?: number;
    interval_seconds?: number;
    variants: Array<{ url: string; duration: number }>;
  }>) => void;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useSoundscapeStore = create<SoundscapeStoreState>()(
  temporal(
    devtools(
      (set, get) => ({
        soundConfigs: [],
        activeSoundConfigTab: 0,
        isSoundGenerating: false,
        soundGenError: null,
        soundGenProgress: '',
        soundGenProgressValue: 0,
        generatedSounds: [],
        soundscapeData: null,
        globalDuration: DEFAULT_DURATION_SECONDS,
        globalSteps: DEFAULT_DIFFUSION_STEPS,
        globalNegativePrompt:
          'distorted, reverb, echo, background noise, hall, spaciousness',
        applyDenoising: false,
        llmModel: DEFAULT_LLM_MODEL,
        audioModel: DEFAULT_AUDIO_MODEL,

        handleAddConfig: (type = 'text-to-audio') => {
          const { globalDuration, globalSteps, soundConfigs } = get();
          const newConfig: SoundGenerationConfig = {
            prompt: '',
            duration: globalDuration,
            guidance_scale: DEFAULT_GUIDANCE_SCALE,
            negative_prompt: '',
            seed_copies: DEFAULT_SEED_COPIES,
            steps: globalSteps,
            type,
            uploadedAudioBuffer: undefined,
            uploadedAudioInfo: undefined,
            uploadedAudioUrl: undefined,
            selectedLibrarySound: undefined,
            librarySearchState: undefined,
            selectedCatalogSound: undefined,
            display_name: undefined,
            entity: undefined,
          };
          set(
            { soundConfigs: [...soundConfigs, newConfig], activeSoundConfigTab: soundConfigs.length },
            false,
            'soundscape/addConfig',
          );
        },

        handleBatchAddConfigs: (count) => {
          const { soundConfigs, globalDuration, globalSteps } = get();
          const startIndex = soundConfigs.length;
          const newConfigs = Array.from({ length: count }, () => ({
            prompt: '',
            duration: globalDuration,
            guidance_scale: DEFAULT_GUIDANCE_SCALE,
            negative_prompt: '',
            seed_copies: DEFAULT_SEED_COPIES,
            steps: globalSteps,
            type: 'text-to-audio' as CardType,
          }));
          set(
            { soundConfigs: [...soundConfigs, ...newConfigs] },
            false,
            'soundscape/batchAddConfigs',
          );
          return startIndex;
        },

        handleRemoveConfig: (index) => {
          const { soundConfigs, activeSoundConfigTab, soundscapeData, generatedSounds } = get();
          const newConfigs = soundConfigs.filter((_, i) => i !== index);
          const newTab =
            activeSoundConfigTab >= soundConfigs.length - 1
              ? Math.max(0, soundConfigs.length - 2)
              : activeSoundConfigTab;
          const newSoundscape = soundscapeData ? reindexSounds(soundscapeData, index) : null;
          const newGenerated = reindexSounds(generatedSounds, index);
          set(
            {
              soundConfigs: newConfigs,
              activeSoundConfigTab: newTab,
              soundscapeData: newSoundscape,
              generatedSounds: newGenerated,
            },
            false,
            'soundscape/removeConfig',
          );
        },

        handleReorderSoundConfigs: (from, to) => {
          const { soundConfigs, activeSoundConfigTab } = get();
          const newConfigs = [...soundConfigs];
          const [removed] = newConfigs.splice(from, 1);
          newConfigs.splice(to, 0, removed);
          let newTab = activeSoundConfigTab;
          if (newTab === from) newTab = to;
          else if (from < to && newTab > from && newTab <= to) newTab--;
          else if (from > to && newTab >= to && newTab < from) newTab++;
          set(
            { soundConfigs: newConfigs, activeSoundConfigTab: newTab },
            false,
            'soundscape/reorderConfigs',
          );
        },

        handleUpdateConfig: (index, field, value) => {
          const { soundConfigs, soundscapeData, generatedSounds } = get();
          const updated = soundConfigs.map((c, i) =>
            i === index ? { ...c, [field]: value } : c,
          );
          // Sync display_name changes into soundscapeData / generatedSounds
          if (field === 'display_name') {
            const syncDisplayName = (sounds: any[]) =>
              sounds.map((s) =>
                s.prompt_index === index && value ? { ...s, display_name: value } : s,
              );
            set(
              {
                soundConfigs: updated,
                soundscapeData: soundscapeData ? syncDisplayName(soundscapeData) : null,
                generatedSounds: syncDisplayName(generatedSounds),
              },
              false,
              'soundscape/updateConfig',
            );
          } else {
            set({ soundConfigs: updated }, false, 'soundscape/updateConfig');
          }
        },

        handleTypeChange: async (index, type) => {
          const { soundConfigs } = get();
          const config = soundConfigs[index];
          let updated: SoundGenerationConfig;

          if (
            (config.type === 'upload' || config.type === 'sample-audio') &&
            type !== 'upload' &&
            type !== 'sample-audio' &&
            config.uploadedAudioUrl
          ) {
            revokeAudioUrl(config.uploadedAudioUrl);
            updated = {
              ...config,
              type,
              uploadedAudioBuffer: undefined,
              uploadedAudioInfo: undefined,
              uploadedAudioUrl: undefined,
              display_name: undefined,
            };
          } else if (type === 'upload' || type === 'sample-audio') {
            updated = { ...config, type, display_name: undefined };
          } else {
            updated = { ...config, type };
          }

          const newConfigs = soundConfigs.map((c, i) => (i === index ? updated : c));
          set({ soundConfigs: newConfigs }, false, 'soundscape/typeChange');

          if (type === 'sample-audio') {
            try {
              const response = await fetch(`${API_BASE_URL}/api/sample-audio`);
              if (!response.ok) throw new Error('Failed to load sample audio');
              const blob = await response.blob();
              const file = new File([blob], 'Le Corbeau et le Renard (french).wav', {
                type: 'audio/wav',
              });
              const result = await loadAudioFile(file);
              set(
                (s) => ({
                  soundConfigs: s.soundConfigs.map((c, i) =>
                    i === index
                      ? {
                          ...c,
                          uploadedAudioBuffer: result.audioBuffer,
                          uploadedAudioInfo: result.audioInfo,
                          uploadedAudioUrl: result.audioUrl,
                        }
                      : c,
                  ),
                }),
                false,
                'soundscape/sampleLoaded',
              );
            } catch (error) {
              set(
                { soundGenError: error instanceof Error ? error.message : 'Failed to load sample audio' },
                false,
                'soundscape/sampleError',
              );
            }
          }
        },

        handleGlobalDurationChange: (duration) => {
          const { soundConfigs } = get();
          set(
            {
              globalDuration: duration,
              soundConfigs: soundConfigs.map((c) => ({ ...c, duration })),
            },
            false,
            'soundscape/globalDuration',
          );
        },

        handleGlobalStepsChange: (steps) => {
          const { soundConfigs } = get();
          set(
            {
              globalSteps: steps,
              soundConfigs: soundConfigs.map((c) => ({ ...c, steps })),
            },
            false,
            'soundscape/globalSteps',
          );
        },

        handleGenerate: async () => {
          const {
            soundConfigs,
            soundscapeData,
            globalNegativePrompt,
            applyDenoising,
            audioModel,
          } = get();
          const { geometryBounds } = useFileUploadStore.getState();

          // Identify already-generated config indices
          const alreadyGenerated = new Set<number>();
          if (soundscapeData) {
            soundscapeData.forEach((s: any) => {
              if (s.prompt_index !== undefined) alreadyGenerated.add(s.prompt_index);
            });
          }

          const withIndices = soundConfigs.map((config, idx) => ({ config, originalIndex: idx }));

          const uploadedConfigs = withIndices.filter(
            ({ config, originalIndex }) =>
              !alreadyGenerated.has(originalIndex) &&
              (config.type === 'upload' || config.type === 'sample-audio') &&
              config.uploadedAudioUrl,
          );

          const libraryConfigs = withIndices.filter(
            ({ config, originalIndex }) =>
              !alreadyGenerated.has(originalIndex) &&
              config.type === 'library' &&
              config.selectedLibrarySound,
          );

          const catalogConfigs = withIndices.filter(
            ({ config, originalIndex }) =>
              !alreadyGenerated.has(originalIndex) &&
              config.type === 'catalog' &&
              config.selectedCatalogSound,
          );

          const elevenLabsConfigs2 = withIndices.filter(
            ({ config, originalIndex }) =>
              !alreadyGenerated.has(originalIndex) &&
              (config.type === 'text-to-audio' || !config.type) &&
              !config.uploadedAudioUrl &&
              config.prompt.trim() !== '',
          );

          const generationConfigs =
            audioModel !== AUDIO_MODEL_ELEVENLABS ? elevenLabsConfigs2 : [];
          const elevenLabsConfigs =
            audioModel === AUDIO_MODEL_ELEVENLABS ? elevenLabsConfigs2 : [];

          const total =
            generationConfigs.length +
            uploadedConfigs.length +
            libraryConfigs.length +
            catalogConfigs.length +
            elevenLabsConfigs.length;

          if (total === 0) {
            set(
              { soundGenError: 'Please enter at least one sound prompt or upload an audio file.' },
              false,
              'soundscape/generateEmpty',
            );
            return;
          }

          set(
            { soundGenError: null, isSoundGenerating: true, soundGenProgress: '', soundGenProgressValue: 0 },
            false,
            'soundscape/generateStart',
          );
          _abortController = new AbortController();

          try {
            let generatedEvents: any[] = [];

            // ── Backend ML generation (async submit + poll) ───────────────────
            if (generationConfigs.length > 0) {
              const hasEntities = generationConfigs.some(({ config }) => config.entity);
              const configsWithNeg = generationConfigs.map(({ config }) => ({
                ...config,
                negative_prompt: globalNegativePrompt,
              }));

              // Submit and get generation_id
              const { generation_id } = await apiService.generateSounds({
                sounds: configsWithNeg,
                bounding_box: hasEntities ? null : geometryBounds,
                apply_denoising: applyDenoising,
                audio_model: audioModel,
                base_spl_db: useAudioControlsStore.getState().globalBaseSplDb,
              });
              _currentGenerationId = generation_id;

              // Map a raw backend sound object to a SoundEvent, resolving the
              // actual prompt_index and entity position from generationConfigs.
              const mapBackendSound = (sound: any) => {
                const backendIndex = sound.prompt_index;
                const actualIndex =
                  generationConfigs[backendIndex]?.originalIndex ?? backendIndex;
                const originalConfig = generationConfigs[backendIndex]?.config;
                let entityIndex = sound.entity_index;
                if (
                  entityIndex === undefined &&
                  originalConfig?.entity?.index !== undefined
                )
                  entityIndex = originalConfig.entity.index;

                let position: number[] = [0, 0, 0];
                if (originalConfig?.entity?.bounds?.center) {
                  position = originalConfig.entity.bounds.center;
                } else if (originalConfig?.entity?.position) {
                  position = originalConfig.entity.position;
                }

                return {
                  ...sound,
                  prompt_index: actualIndex,
                  position,
                  geometry: sound.geometry || { vertices: [], faces: [] },
                  ...(entityIndex !== undefined && { entity_index: entityIndex }),
                };
              };

              // Poll until done, streaming each completed sound into the UI immediately
              const mlResult = await new Promise<any[]>((resolve, reject) => {
                let lastPartialCount = 0;
                _soundPollInterval = setInterval(async () => {
                  try {
                    const s = await apiService.getSoundGenerationStatus(generation_id);
                    set(
                      {
                        soundGenProgress: s.status,
                        soundGenProgressValue: s.progress,
                      },
                      false,
                      'soundscape/generatePoll',
                    );

                    // Stream newly-completed sounds into the UI
                    if (s.partial_sounds && s.partial_sounds.length > lastPartialCount) {
                      const newPartials = s.partial_sounds.slice(lastPartialCount).map(mapBackendSound);
                      lastPartialCount = s.partial_sounds.length;
                      const { generatedSounds: current } = get();
                      const newIds = new Set(newPartials.map((e: any) => e.id));
                      const merged = [
                        ...(current || []).filter((e: any) => !newIds.has(e.id)),
                        ...newPartials,
                      ];
                      set({ generatedSounds: merged }, false, 'soundscape/partialSound');
                    }

                    if (s.cancelled) {
                      clearInterval(_soundPollInterval!);
                      _soundPollInterval = null;
                      reject(new Error('AbortError'));
                    } else if (s.error) {
                      clearInterval(_soundPollInterval!);
                      _soundPollInterval = null;
                      reject(new Error(s.error));
                    } else if (s.completed && s.result) {
                      clearInterval(_soundPollInterval!);
                      _soundPollInterval = null;
                      resolve(s.result);
                    }
                  } catch (pollErr: any) {
                    clearInterval(_soundPollInterval!);
                    _soundPollInterval = null;
                    reject(pollErr);
                  }
                }, 1500);
              });

              generatedEvents = mlResult.map(mapBackendSound);
            }

            // ── Uploaded / sample audio ───────────────────────────────────────
            const globalBaseSplDb = useAudioControlsStore.getState().globalBaseSplDb;
            const uploadedEvents: any[] = [];
            for (const { config, originalIndex } of uploadedConfigs) {
              const resolvedSpl = config.spl_db ?? globalBaseSplDb;
              const audioUrl = await calibrateBlobUrl(
                config.uploadedAudioUrl!,
                resolvedSpl,
                applyDenoising,
              );
              uploadedEvents.push(
                createSoundEventFromUpload(
                  { ...config, spl_db: resolvedSpl },
                  audioUrl,
                  originalIndex,
                  total,
                  geometryBounds as GeometryBounds | undefined,
                  'uploaded',
                ),
              );
            }

            // ── Library ───────────────────────────────────────────────────────
            const libraryEvents: any[] = [];
            for (const { config, originalIndex } of libraryConfigs) {
              if (!config.selectedLibrarySound) continue;
              try {
                const dlRes = await fetch(`${API_BASE_URL}/api/library/download`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    location: config.selectedLibrarySound.location,
                    description: config.selectedLibrarySound.description,
                  }),
                  signal: _abortController.signal,
                });
                if (!dlRes.ok) throw new Error('Failed to download sound');
                const resolvedSpl = config.spl_db ?? globalBaseSplDb;
                const audioUrl = await calibrateBlobUrl(
                  await dlRes.blob(),
                  resolvedSpl,
                  applyDenoising,
                );
                libraryEvents.push(
                  createSoundEventFromUpload(
                    { ...config, spl_db: resolvedSpl },
                    audioUrl,
                    originalIndex,
                    total,
                    geometryBounds as GeometryBounds | undefined,
                    'library',
                  ),
                );
              } catch (error) {
                console.error('[soundscapeStore] Library download error:', error);
              }
            }

            // ── Catalog ───────────────────────────────────────────────────────
            const catalogEvents: any[] = [];
            for (const { config, originalIndex } of catalogConfigs) {
              if (!config.selectedCatalogSound) continue;
              try {
                const dlRes = await fetch(config.selectedCatalogSound.url, {
                  signal: _abortController.signal,
                });
                if (!dlRes.ok) throw new Error('Failed to download catalog sound');
                const resolvedSpl = config.spl_db ?? globalBaseSplDb;
                const audioUrl = await calibrateBlobUrl(
                  await dlRes.blob(),
                  resolvedSpl,
                  applyDenoising,
                );
                catalogEvents.push(
                  createSoundEventFromUpload(
                    { ...config, spl_db: resolvedSpl },
                    audioUrl,
                    originalIndex,
                    total,
                    geometryBounds as GeometryBounds | undefined,
                    'catalog',
                  ),
                );
              } catch (error) {
                const errorMsg = error instanceof Error ? error.message : 'Failed to download catalog sound';
                console.error('[soundscapeStore] Catalog download error:', error);
                // Set per-card error
                get().handleUpdateConfig(originalIndex, 'error', errorMsg);
              }
            }

            // ── ElevenLabs ────────────────────────────────────────────────────
            const elevenLabsEvents: any[] = [];
            for (const { config, originalIndex } of elevenLabsConfigs) {
              const duration = config.duration ?? DEFAULT_DURATION_SECONDS;
              const rawUrl = await generateSoundEffect({
                text: config.prompt,
                durationSeconds:
                  duration >= 0.5 && duration <= 22 ? duration : undefined,
              });
              const resolvedSpl = config.spl_db ?? globalBaseSplDb;
              const audioUrl = await calibrateBlobUrl(
                rawUrl,
                resolvedSpl,
                applyDenoising,
              );
              elevenLabsEvents.push(
                createSoundEventFromUpload(
                  { ...config, spl_db: resolvedSpl },
                  audioUrl,
                  originalIndex,
                  total,
                  geometryBounds as GeometryBounds | undefined,
                  'elevenlabs',
                ),
              );
            }

            // ── Merge ─────────────────────────────────────────────────────────
            const existing = soundscapeData ? [...soundscapeData] : [];
            const newEvents = [
              ...generatedEvents,
              ...uploadedEvents,
              ...libraryEvents,
              ...catalogEvents,
              ...elevenLabsEvents,
            ];
            const newEventIds = new Set(newEvents.map((e) => e.id));
            const allEvents = [
              ...existing.filter((e) => !newEventIds.has(e.id)),
              ...newEvents,
            ];

            set(
              { generatedSounds: allEvents, soundscapeData: allEvents.length > 0 ? allEvents : null },
              false,
              'soundscape/generateDone',
            );
          } catch (err: any) {
            if (err.name === 'AbortError' || err.message === 'AbortError') {
              const msg = 'Sound generation stopped by user.';
              set({ soundGenError: msg }, false, 'soundscape/generateAbort');
              useErrorsStore.getState().addError(msg, 'info');
            } else {
              const isQuota = err.message.includes('quota') || err.message.includes('429');
              set({ soundGenError: err.message }, false, 'soundscape/generateError');
              useErrorsStore.getState().addError(err.message, isQuota ? 'warning' : 'error');
            }
          } finally {
            set({ isSoundGenerating: false, soundGenProgress: '', soundGenProgressValue: 0 }, false, 'soundscape/generateEnd');
            _abortController = null;
            _currentGenerationId = null;
            if (_soundPollInterval) {
              clearInterval(_soundPollInterval);
              _soundPollInterval = null;
            }
          }
        },

        handleStopGeneration: () => {
          if (_soundPollInterval) {
            clearInterval(_soundPollInterval);
            _soundPollInterval = null;
          }
          if (_abortController) {
            _abortController.abort();
            _abortController = null;
          }
          if (_currentGenerationId) {
            apiService.cancelSoundGeneration(_currentGenerationId);
            _currentGenerationId = null;
          }
          set(
            { isSoundGenerating: false, soundGenError: 'Sound generation stopped by user.', soundGenProgress: '', soundGenProgressValue: 0 },
            false,
            'soundscape/stop',
          );
        },

        handleReprocessSounds: async (applyDenoising) => {
          const { soundscapeData } = get();
          if (!soundscapeData || soundscapeData.length === 0) return;

          try {
            const soundUrls = soundscapeData.map((s: any) => s.url);
            const response = await fetch(`${API_BASE_URL}/api/reprocess-sounds`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sound_urls: soundUrls, apply_denoising: applyDenoising }),
            });

            if (!response.ok) {
              const err = await response.json();
              throw new Error(err.detail || 'Failed to reprocess sounds');
            }

            const timestamp = Date.now();
            const updated = soundscapeData.map((s: any) => ({
              ...s,
              url: s.url.includes('?') ? `${s.url}&t=${timestamp}` : `${s.url}?t=${timestamp}`,
            }));
            set({ soundscapeData: updated }, false, 'soundscape/reprocessed');
          } catch (error) {
            set(
              { soundGenError: error instanceof Error ? error.message : 'Failed to reprocess sounds' },
              false,
              'soundscape/reprocessError',
            );
          }
        },

        setActiveSoundConfigTab: (tab) =>
          set({ activeSoundConfigTab: tab }, false, 'soundscape/setTab'),

        setSoundConfigsFromPrompts: (prompts) => {
          const { soundConfigs } = get();
          const isSingleEmpty =
            soundConfigs.length === 1 &&
            !soundConfigs[0].prompt &&
            !soundConfigs[0].uploadedAudioUrl &&
            !soundConfigs[0].selectedLibrarySound;

          if (isSingleEmpty) {
            set({ soundConfigs: prompts }, false, 'soundscape/setConfigsFromPrompts');
            return;
          }

          const newPrompts = prompts.filter(
            (newConfig) =>
              !soundConfigs.some((existing) => {
                const samePrompt =
                  existing.prompt.trim().toLowerCase() ===
                  newConfig.prompt.trim().toLowerCase();
                const sameEntity =
                  (!existing.entity && !newConfig.entity) ||
                  (existing.entity?.index !== undefined &&
                    newConfig.entity?.index !== undefined &&
                    existing.entity.index === newConfig.entity.index);
                return samePrompt && sameEntity;
              }),
          );

          if (newPrompts.length > 0) {
            set(
              { soundConfigs: [...soundConfigs, ...newPrompts] },
              false,
              'soundscape/appendFromPrompts',
            );
          }
        },

        setSoundscapeData: (data) => {
          set(
            { soundscapeData: data, generatedSounds: data ?? [] },
            false,
            'soundscape/setSoundscapeData',
          );
        },

        setGlobalNegativePrompt: (val) =>
          set({ globalNegativePrompt: val }, false, 'soundscape/setNegPrompt'),

        setApplyDenoising: (val) =>
          set({ applyDenoising: val }, false, 'soundscape/setDenoising'),

        setAudioModel: (model) =>
          set({ audioModel: model }, false, 'soundscape/setModel'),

        setLlmModel: (model) =>
          set({ llmModel: model }, false, 'soundscape/setLlmModel'),

        handleUploadAudio: async (index, file) => {
          try {
            const result = await loadAudioFile(file);
            set(
              (s) => ({
                soundConfigs: s.soundConfigs.map((c, i) =>
                  i === index
                    ? {
                        ...c,
                        type: 'upload' as CardType,
                        uploadedAudioBuffer: result.audioBuffer,
                        uploadedAudioInfo: result.audioInfo,
                        uploadedAudioUrl: result.audioUrl,
                      }
                    : c,
                ),
              }),
              false,
              'soundscape/uploadAudio',
            );
          } catch (error) {
            set(
              { soundGenError: error instanceof Error ? error.message : 'Failed to upload audio' },
              false,
              'soundscape/uploadAudioError',
            );
          }
        },

        handleClearUploadedAudio: (index) => {
          const { soundConfigs } = get();
          const config = soundConfigs[index];
          if (config?.uploadedAudioUrl) revokeAudioUrl(config.uploadedAudioUrl);
          set(
            (s) => ({
              soundConfigs: s.soundConfigs.map((c, i) =>
                i === index
                  ? { ...c, uploadedAudioBuffer: undefined, uploadedAudioInfo: undefined, uploadedAudioUrl: undefined }
                  : c,
              ),
            }),
            false,
            'soundscape/clearUpload',
          );
        },

        handleLibrarySearch: async (index) => {
          const { soundConfigs } = get();
          const config = soundConfigs[index];
          const prompt = config?.prompt.trim();
          if (!prompt) return;

          set(
            (s) => ({
              soundConfigs: s.soundConfigs.map((c, i) =>
                i === index
                  ? {
                      ...c,
                      librarySearchState: {
                        isSearching: true,
                        results: [],
                        selectedSound: null,
                        error: null,
                      },
                    }
                  : c,
              ),
            }),
            false,
            'soundscape/librarySearchStart',
          );

          try {
            const response = await fetch(`${API_BASE_URL}/api/library/search`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ prompt, max_results: LIBRARY_MAX_SEARCH_RESULTS }),
            });
            if (!response.ok) throw new Error('Search failed');
            const data = await response.json();
            set(
              (s) => ({
                soundConfigs: s.soundConfigs.map((c, i) =>
                  i === index
                    ? {
                        ...c,
                        librarySearchState: {
                          isSearching: false,
                          results: data.results || [],
                          selectedSound: null,
                          error: null,
                        },
                      }
                    : c,
                ),
              }),
              false,
              'soundscape/librarySearchDone',
            );
          } catch {
            set(
              (s) => ({
                soundConfigs: s.soundConfigs.map((c, i) =>
                  i === index
                    ? {
                        ...c,
                        librarySearchState: {
                          isSearching: false,
                          results: [],
                          selectedSound: null,
                          error: 'Search failed. Please try again.',
                        },
                      }
                    : c,
                ),
              }),
              false,
              'soundscape/librarySearchError',
            );
          }
        },

        handleLibrarySoundSelect: (index, sound) =>
          set(
            (s) => ({
              soundConfigs: s.soundConfigs.map((c, i) =>
                i === index
                  ? {
                      ...c,
                      selectedLibrarySound: sound,
                      display_name: c.display_name || sound.description,
                      librarySearchState: c.librarySearchState
                        ? { ...c.librarySearchState, selectedSound: sound }
                        : undefined,
                    }
                  : c,
              ),
            }),
            false,
            'soundscape/librarySelect',
          ),

        handleCatalogSoundSelect: (index, sound) =>
          set(
            (s) => ({
              soundConfigs: s.soundConfigs.map((c, i) =>
                i === index
                  ? { ...c, selectedCatalogSound: sound, display_name: c.display_name || sound.name }
                  : c,
              ),
            }),
            false,
            'soundscape/catalogSelect',
          ),

        handleResetToDefaults: () =>
          set(
            {
              globalDuration: DEFAULT_DURATION_SECONDS,
              globalSteps: DEFAULT_DIFFUSION_STEPS,
              globalNegativePrompt: 'distorted, reverb, echo, background noise, hall, spaciousness',
              applyDenoising: false,
              audioModel: DEFAULT_AUDIO_MODEL,
              llmModel: DEFAULT_LLM_MODEL,
            },
            false,
            'soundscape/resetDefaults',
          ),

        handleResetSoundConfig: (index) => {
          const { soundConfigs } = get();
          const config = soundConfigs[index];
          if (!config) return;
          if (config.uploadedAudioUrl) {
            try { URL.revokeObjectURL(config.uploadedAudioUrl); } catch {}
          }
          set(
            (s) => ({
              soundConfigs: s.soundConfigs.map((c, i) =>
                i === index
                  ? {
                      ...c,
                      display_name: undefined,
                      uploadedAudioBuffer: undefined,
                      uploadedAudioInfo: undefined,
                      uploadedAudioUrl: undefined,
                      selectedLibrarySound: undefined,
                      librarySearchState: undefined,
                      selectedCatalogSound: undefined,
                    }
                  : c,
              ),
            }),
            false,
            'soundscape/resetSoundConfig',
          );
        },

        handleDuplicateConfig: (index) => {
          const { soundConfigs, soundscapeData } = get();
          const config = soundConfigs[index];
          if (!config) return;

          const newConfig: SoundGenerationConfig = {
            ...config,
            display_name: config.display_name ? `${config.display_name} (copy)` : undefined,
            entity: undefined,
          };

          const newPromptIndex = soundConfigs.length;
          const newConfigs = [...soundConfigs, newConfig];

          let newSoundscape = soundscapeData;
          if (soundscapeData) {
            const origEvents = soundscapeData.filter((s: any) => s.prompt_index === index);
            if (origEvents.length > 0) {
              const duped = origEvents.map((event: any, vIdx: number) => ({
                ...event,
                id: `duplicate-${newPromptIndex}-${vIdx}-${Date.now()}`,
                prompt_index: newPromptIndex,
                position: [
                  (event.position as [number, number, number])[0] + DUPLICATE_POSITION_OFFSET,
                  (event.position as [number, number, number])[1],
                  (event.position as [number, number, number])[2],
                ] as [number, number, number],
                display_name: newConfig.display_name || event.display_name,
                entity_index: undefined,
              }));
              newSoundscape = [...soundscapeData, ...duped];
            }
          }

          set(
            {
              soundConfigs: newConfigs,
              activeSoundConfigTab: newPromptIndex,
              soundscapeData: newSoundscape,
              generatedSounds: newSoundscape ?? [],
            },
            false,
            'soundscape/duplicateConfig',
          );
        },

        handleDetachSoundFromEntity: (index) => {
          const { soundConfigs, soundscapeData, generatedSounds } = get();
          const newConfigs = soundConfigs.map((c, i) =>
            i === index ? { ...c, entity: undefined } : c,
          );
          const detach = (sounds: any[]) =>
            sounds.map((s) => {
              if (s.prompt_index !== index) return s;
              const { entity_index, ...rest } = s;
              return rest;
            });
          set(
            {
              soundConfigs: newConfigs,
              soundscapeData: soundscapeData ? detach(soundscapeData) : null,
              generatedSounds: detach(generatedSounds),
            },
            false,
            'soundscape/detachEntity',
          );
        },

        handleAttachSoundToEntity: (index, entity) => {
          const { soundConfigs, soundscapeData, generatedSounds } = get();
          const newConfigs = soundConfigs.map((c, i) =>
            i === index ? { ...c, entity } : c,
          );
          const entityPosition: [number, number, number] = entity.bounds?.center
            ? [
                entity.bounds.center[0],
                entity.bounds.center[1],
                entity.bounds.center[2],
              ]
            : entity.position?.length >= 3
              ? [entity.position[0], entity.position[1], entity.position[2]]
              : [0, 0, 0];

          const attach = (sounds: any[]) =>
            sounds.map((s) =>
              s.prompt_index === index
                ? { ...s, entity_index: entity.index, position: entityPosition }
                : s,
            );
          set(
            {
              soundConfigs: newConfigs,
              soundscapeData: soundscapeData ? attach(soundscapeData) : null,
              generatedSounds: attach(generatedSounds),
            },
            false,
            'soundscape/attachEntity',
          );
        },

        updateSoundPosition: (soundId, position) => {
          const { soundscapeData, generatedSounds } = get();
          const existing = soundscapeData?.find((s) => s.id === soundId);
          const promptIndex = existing?.prompt_index;
          if (
            existing?.position &&
            existing.position[0] === position[0] &&
            existing.position[1] === position[1] &&
            existing.position[2] === position[2]
          ) {
            return; // no-op
          }
          const update = (sounds: any[]) =>
            sounds.map((s) => {
              if (promptIndex !== undefined && s.prompt_index === promptIndex) {
                return { ...s, position };
              }
              if (promptIndex === undefined && s.id === soundId) {
                return { ...s, position };
              }
              return s;
            });
          set(
            {
              soundscapeData: soundscapeData ? update(soundscapeData) : null,
              generatedSounds: update(generatedSounds),
            },
            false,
            'soundscape/updatePosition',
          );
        },

        restoreSoundscape: (configs, events, settings) => {
          set(
            {
              soundConfigs: configs,
              soundscapeData: events.length > 0 ? events : null,
              generatedSounds: events,
              activeSoundConfigTab: 0,
              ...(settings?.negativePrompt !== undefined && {
                globalNegativePrompt: settings.negativePrompt,
              }),
              ...(settings?.audioModel !== undefined && { audioModel: settings.audioModel }),
              ...(settings?.llmModel !== undefined && { llmModel: settings.llmModel }),
            },
            false,
            'soundscape/restore',
          );
        },

        injectExtractedSEDSounds: (sounds) => {
          const { soundConfigs, generatedSounds, soundscapeData, globalDuration, globalSteps } = get();
          const startIndex = soundConfigs.length;

          const newConfigs: SoundGenerationConfig[] = sounds.map((s) => ({
            prompt: s.name,
            duration: s.variants[0]?.duration ?? globalDuration,
            guidance_scale: undefined,
            negative_prompt: '',
            seed_copies: 1,
            steps: globalSteps,
            type: 'upload' as import('@/types').CardType,
            display_name: s.name,
            spl_db: s.spl_db,
            interval_seconds: s.interval_seconds,
          }));

          const newEvents: any[] = sounds.flatMap((s, si) => {
            const promptIndex = startIndex + si;
            return s.variants.map((v, vi) => ({
              id: `sed-${promptIndex}-${vi}-${Date.now()}`,
              url: v.url,
              position: [0, 0, 0] as [number, number, number],
              geometry: { vertices: [], faces: [] },
              display_name: s.variants.length > 1 ? `${s.name}_${vi + 1}` : s.name,
              prompt: s.name,
              prompt_index: promptIndex,
              total_copies: 1,
              volume_db: s.spl_db ?? 70,
              interval_seconds: s.interval_seconds ?? 30,
              isUploaded: true,
            }));
          });

          const existing = soundscapeData ? [...soundscapeData] : [...generatedSounds];
          const allEvents = [...existing, ...newEvents];
          set(
            {
              soundConfigs: [...soundConfigs, ...newConfigs],
              generatedSounds: allEvents,
              soundscapeData: allEvents.length > 0 ? allEvents : null,
            },
            false,
            'soundscape/injectSEDSounds',
          );
        },
      }),
      { name: 'soundscapeStore' },
    ),
    { partialize: soundscapePartialize },
  ),
);
