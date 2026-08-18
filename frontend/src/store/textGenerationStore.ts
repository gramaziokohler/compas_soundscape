/**
 * Text Generation Store
 *
 * Replaces useTextGeneration. Manages the AI text-to-soundscape generation
 * workflow: LLM step 1 (entity selection) and step 2 (prompt generation).
 *
 * modelEntities and useModelAsContext are now read from useFileUploadStore
 * instead of being passed as constructor arguments.
 *
 * AbortController is a non-serializable — kept as a module-level ref.
 *
 * zundo partializes on aiPrompt, numSounds, and selectedDiverseEntities.
 */

import { create } from 'zustand';
import { temporal } from 'zundo';
import { devtools } from 'zustand/middleware';
import {
  API_BASE_URL,
  DEFAULT_NUM_SOUNDS,
  UI_TIMING,
  DEFAULT_DURATION_SECONDS,
  DEFAULT_GUIDANCE_SCALE,
  DEFAULT_SEED_COPIES,
  DEFAULT_DIFFUSION_STEPS,
  DEFAULT_DBFS,
  LLM_SUGGESTED_INTERVAL_SECONDS,
  LLM_RETRY,
} from '@/utils/constants';
import type { ActiveTab } from '@/types';
import { notifyError } from './errorsStore';
import { useFileUploadStore } from './fileUploadStore';
import { useSoundscapeStore } from './soundscapeStore';
import { apiService } from '@/services/api';
import { recordInflightJob, removeInflightJob } from '@/lib/job-tracker';
import { startPolling, createPollRegistry } from '@/lib/poll-until-done';

// ─── Module-level concurrency state ──────────────────────────────────────────
// LLM jobs run concurrently on the backend IO pool (6 workers). Each invocation
// owns its own poll/abort handles via registries so a second job can never
// clobber the first's poll loop.

const textPollRegistry = createPollRegistry();
const _activeLlmJobIds = new Set<string>();
const _abortControllers = new Set<AbortController>();

let _activeCount = 0;

function syncTextGenActivity(): void {
  useTextGenerationStore.setState({ isGenerating: _activeCount > 0 }, false, 'textGen/activitySync');
}

export function beginTextGeneration(): void {
  _activeCount += 1;
  syncTextGenActivity();
}

export function endTextGeneration(): void {
  _activeCount = Math.max(0, _activeCount - 1);
  syncTextGenActivity();
}

// ─── Partialize ───────────────────────────────────────────────────────────────

export const textGenerationPartialize = (state: TextGenerationStoreState) => ({
  aiPrompt: state.aiPrompt,
  numSounds: state.numSounds,
  selectedDiverseEntities: state.selectedDiverseEntities,
});

// ─── State ────────────────────────────────────────────────────────────────────

export interface TextGenerationStoreState {
  aiPrompt: string;
  aiResponse: string | null;
  aiError: string | null;
  isGenerating: boolean;
  isAnalyzingEntities: boolean;
  numSounds: number;
  llmProgress: string;
  showConfirmLoadSounds: boolean;
  pendingSoundConfigs: any[];
  activeAiTab: ActiveTab;
  selectedDiverseEntities: any[];

  tokenSettingsTrigger: number;

  setAiPrompt: (prompt: string) => void;
  setNumSounds: (n: number) => void;
  setActiveAiTab: (tab: ActiveTab) => void;
  setPendingSoundConfigs: (configs: any[]) => void;
  setSelectedDiverseEntities: (entities: any[]) => void;
  /** Switch to settings tab, expand sidebar, and open the API Tokens accordion. */
  triggerOpenTokenSettings: () => void;

  handleAnalyzeModel: () => Promise<void>;
  handleGenerateText: () => Promise<void>;
  handleStopGeneration: () => void;
  handleClearAnalysis: () => void;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useTextGenerationStore = create<TextGenerationStoreState>()(
  temporal(
    devtools(
      (set, get) => ({
        aiPrompt: '',
        aiResponse: null,
        aiError: null,
        isGenerating: false,
        isAnalyzingEntities: false,
        numSounds: DEFAULT_NUM_SOUNDS,
        llmProgress: '',
        showConfirmLoadSounds: false,
        pendingSoundConfigs: [],
        activeAiTab: 'text' as ActiveTab,
        selectedDiverseEntities: [],
        tokenSettingsTrigger: 0,

        setAiPrompt: (prompt) => set({ aiPrompt: prompt }, false, 'textGen/setPrompt'),
        setNumSounds: (n) => set({ numSounds: n }, false, 'textGen/setNumSounds'),
        setActiveAiTab: (tab) => set({ activeAiTab: tab }, false, 'textGen/setTab'),
        triggerOpenTokenSettings: () =>
          set(
            (s) => ({ tokenSettingsTrigger: s.tokenSettingsTrigger + 1, activeAiTab: 'settings' as ActiveTab }),
            false, 'textGen/openTokenSettings'
          ),
        setPendingSoundConfigs: (configs) =>
          set({ pendingSoundConfigs: configs }, false, 'textGen/setPendingConfigs'),
        setSelectedDiverseEntities: (entities) =>
          set({ selectedDiverseEntities: entities }, false, 'textGen/setSelectedEntities'),

        handleAnalyzeModel: async () => {
          const { numSounds, selectedDiverseEntities } = get();
          const { modelEntities } = useFileUploadStore.getState();

          if (modelEntities.length === 0) {
            set({ aiError: 'No 3D model loaded.' }, false, 'textGen/analyzeNoModel');
            return;
          }

          const previousSelection = [...selectedDiverseEntities];
          set({ aiError: null, isAnalyzingEntities: true, llmProgress: '' }, false, 'textGen/analyzeStart');

          const controller = new AbortController();
          _abortControllers.add(controller);

          try {
            const msg =
              modelEntities.length > numSounds
                ? `Selecting ${numSounds} most diverse objects from ${modelEntities.length} total... (Auto-retry enabled)`
                : `Analyzing ${modelEntities.length} objects from 3D model... (Auto-retry enabled)`;
            set({ llmProgress: msg }, false, 'textGen/analyzeProgress');

            const res = await fetch(`${API_BASE_URL}/api/select-entities`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ entities: modelEntities, max_sounds: numSounds, llm_model: useSoundscapeStore.getState().llmModel }),
              signal: controller.signal,
            });

            if (!res.ok) {
              const errData = await res.json().catch(() => ({}));
              throw new Error(errData.detail || 'Failed to select diverse entities');
            }

            const result = await res.json();
            set(
              {
                selectedDiverseEntities: result.selected_entities,
                llmProgress: `Analysis complete! Selected ${result.selected_entities.length} diverse objects.`,
              },
              false,
              'textGen/analyzeDone',
            );
            setTimeout(() => set({ llmProgress: '' }, false, 'textGen/clearProgress'), 2000);
          } catch (err: any) {
            if (previousSelection.length > 0) {
              set({ selectedDiverseEntities: previousSelection }, false, 'textGen/restoreSelection');
            }
            if (err.name === 'AbortError') {
              set({ aiError: 'Analysis stopped by user.' }, false, 'textGen/analyzeAbort');
            } else {
              const isOverloaded =
                err.message.includes('overloaded') ||
                err.message.includes('503') ||
                err.message.includes('UNAVAILABLE');
              set(
                {
                  aiError: isOverloaded
                    ? `⏳ LLM service is overloaded even after ${LLM_RETRY.MAX_ATTEMPTS} retry attempts. ` +
                      `Please try again in a moment.` +
                      (previousSelection.length > 0 ? ' Previous selection kept.' : '')
                    : err.message,
                  llmProgress: '',
                },
                false,
                'textGen/analyzeError',
              );
            }
          } finally {
            set({ isAnalyzingEntities: false }, false, 'textGen/analyzeEnd');
            _abortControllers.delete(controller);
          }
        },

        handleGenerateText: async () => {
          const { aiPrompt, numSounds, selectedDiverseEntities } = get();
          const { modelEntities, useModelAsContext } = useFileUploadStore.getState();
          const shouldUseEntities = modelEntities.length > 0 && useModelAsContext;

          if (!shouldUseEntities && !aiPrompt.trim()) {
            set({ aiError: 'Please enter a space description.' }, false, 'textGen/generateNoPrompt');
            return;
          }

          set(
            {
              aiError: null,
              aiResponse: null,
              showConfirmLoadSounds: false,
              llmProgress: '',
            },
            false,
            'textGen/generateStart',
          );
          beginTextGeneration();

          const controller = new AbortController();
          _abortControllers.add(controller);

          try {
            const requestBody: any = {
              prompt: aiPrompt || undefined,
              num_sounds: numSounds,
              llm_model: useSoundscapeStore.getState().llmModel,
            };

            let selectedEntities: any[] | null = null;

            if (shouldUseEntities) {
              if (selectedDiverseEntities.length > 0) {
                selectedEntities = selectedDiverseEntities;
                const entityCount = selectedEntities.length;
                const progressMsg =
                  numSounds > entityCount
                    ? `Generating ${numSounds} sound prompts (${entityCount} entity-linked + ${numSounds - entityCount} context sounds)...`
                    : numSounds < entityCount
                      ? `Generating ${numSounds} sound prompts from ${entityCount} selected objects...`
                      : `Generating ${numSounds} sound prompts for selected objects...`;
                set({ llmProgress: progressMsg }, false, 'textGen/generateProgress1');
              } else {
                const selectMsg =
                  modelEntities.length > numSounds
                    ? `Selecting ${numSounds} most diverse objects from ${modelEntities.length} total... (Auto-retry enabled)`
                    : `Analyzing ${modelEntities.length} objects from 3D model... (Auto-retry enabled)`;
                set({ llmProgress: selectMsg }, false, 'textGen/generateProgress2');

                const selRes = await fetch(`${API_BASE_URL}/api/select-entities`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  credentials: 'include',
                  body: JSON.stringify({ entities: modelEntities, max_sounds: numSounds, llm_model: useSoundscapeStore.getState().llmModel }),
                  signal: controller.signal,
                });

                if (selRes.ok) {
                  const selResult = await selRes.json();
                  selectedEntities = selResult.selected_entities;
                  set(
                    { selectedDiverseEntities: selectedEntities ?? [], llmProgress: `Selected ${selectedEntities?.length} objects. Generating sound prompts...` },
                    false,
                    'textGen/entitiesSelected',
                  );
                  await new Promise((resolve) =>
                    setTimeout(resolve, UI_TIMING.ENTITY_HIGHLIGHT_DELAY_MS),
                  );
                } else {
                  requestBody.entities = modelEntities;
                }
              }

              if (selectedEntities) {
                requestBody.entities = selectedEntities;
                requestBody.num_sounds = numSounds;
              }
            }

            // Submit LLM generation and get generation_id
            set({ llmProgress: 'Submitting to LLM...' }, false, 'textGen/submitting');
            const { generation_id } = await apiService.generateText(requestBody);
            _activeLlmJobIds.add(generation_id);
            recordInflightJob(generation_id, 'llm');
            set({ llmProgress: 'Queued...' }, false, 'textGen/queued');

            // Poll until done — controller scoped to this invocation
            const llmPoll = textPollRegistry.track(
              startPolling({
                fetchStatus: () => apiService.getTextGenerationStatus(generation_id),
                onStatus: (s) => {
                  if (s.status) set({ llmProgress: s.status }, false, 'textGen/poll');
                },
              }),
            );
            let result: any;
            try {
              result = await llmPoll.done;
            } finally {
              textPollRegistry.release(llmPoll);
              _activeLlmJobIds.delete(generation_id);
              removeInflightJob(generation_id);
            }

            set({ llmProgress: '' }, false, 'textGen/generateLlmDone');

            if (result.prompts?.length > 0) {
              const hasEntities = result.prompts.some((item: any) => item.entity);
              const displayText = result.prompts
                .map((item: any, idx: number) => `${idx + 1}. ${item.prompt}`)
                .join('\n');

              if (hasEntities) {
                const configs = result.prompts.map((item: any) => ({
                  prompt: item.prompt,
                  duration: item.duration_seconds || 5,
                  guidance_scale: 4.5,
                  negative_prompt: '',
                  seed_copies: DEFAULT_SEED_COPIES,
                  steps: 25,
                  entity: item.entity,
                  display_name: item.display_name,
                  dbfs: item.dbfs ?? DEFAULT_DBFS,
                  interval_seconds: item.interval_seconds || LLM_SUGGESTED_INTERVAL_SECONDS,
                }));
                set(
                  { pendingSoundConfigs: configs, showConfirmLoadSounds: true, aiResponse: displayText },
                  false,
                  'textGen/entityPromptsDone',
                );

                if (result.selected_entities) {
                  const backendIndices = result.selected_entities
                    .map((e: any) => e.index)
                    .sort()
                    .join(',');
                  const currentIndices = (selectedEntities ?? [])
                    .map((e: any) => e.index)
                    .sort()
                    .join(',');
                  if (backendIndices !== currentIndices) {
                    set(
                      { selectedDiverseEntities: result.selected_entities },
                      false,
                      'textGen/updateEntities',
                    );
                  }
                } else if (!selectedEntities) {
                  const fromPrompts = result.prompts.map((i: any) => i.entity).filter(Boolean);
                  if (fromPrompts.length > 0)
                    set(
                      { selectedDiverseEntities: fromPrompts },
                      false,
                      'textGen/entitiesFromPrompts',
                    );
                }
              } else {
                const configs = result.prompts.map((item: any) => ({
                  prompt: item.prompt,
                  duration: item.duration_seconds || DEFAULT_DURATION_SECONDS,
                  guidance_scale: DEFAULT_GUIDANCE_SCALE,
                  negative_prompt: '',
                  seed_copies: DEFAULT_SEED_COPIES,
                  steps: DEFAULT_DIFFUSION_STEPS,
                  display_name: item.display_name,
                  dbfs: item.dbfs ?? DEFAULT_DBFS,
                  interval_seconds: item.interval_seconds || LLM_SUGGESTED_INTERVAL_SECONDS,
                }));
                set(
                  {
                    pendingSoundConfigs: configs,
                    showConfirmLoadSounds: true,
                    aiResponse: displayText,
                  },
                  false,
                  'textGen/textPromptsDone',
                );
              }
            } else if (result.sounds?.length > 0) {
              // Legacy format
              const configs = result.sounds.map((soundDesc: string) => ({
                prompt: soundDesc,
                duration: DEFAULT_DURATION_SECONDS,
                guidance_scale: DEFAULT_GUIDANCE_SCALE,
                negative_prompt: '',
                seed_copies: DEFAULT_SEED_COPIES,
                steps: DEFAULT_DIFFUSION_STEPS,
              }));
              set(
                { pendingSoundConfigs: configs, showConfirmLoadSounds: true, aiResponse: result.text },
                false,
                'textGen/legacyDone',
              );
            } else if (result.text) {
              set(
                { aiResponse: result.text, showConfirmLoadSounds: false },
                false,
                'textGen/textOnly',
              );
            }
          } catch (err: any) {
            if (err.name === 'AbortError' || err.message === 'AbortError') {
              const msg = 'Generation stopped by user.';
              set({ aiError: msg, llmProgress: '' }, false, 'textGen/abort');
              notifyError(msg, 'info');
            } else {
              const isOverloaded =
                err.message.includes('overloaded') ||
                err.message.includes('503') ||
                err.message.includes('UNAVAILABLE');
              const isQuotaError =
                err.message.includes('quota') || err.message.includes('429');

              const errorMsg =
                isQuotaError
                  ? err.message
                  : isOverloaded
                    ? `⏳ LLM service is overloaded even after ${LLM_RETRY.MAX_ATTEMPTS} retry attempts. ` +
                      `The system automatically retried with exponential backoff. Please try again in a moment.`
                    : err.message;

              set({ aiError: errorMsg, llmProgress: '' }, false, 'textGen/error');
              notifyError(errorMsg, isQuotaError ? 'warning' : 'error');
            }
          } finally {
            endTextGeneration();
            _abortControllers.delete(controller);
          }
        },

        handleStopGeneration: () => {
          textPollRegistry.stopAll(new Error('AbortError'));
          for (const id of _activeLlmJobIds) {
            apiService.cancelTextGeneration(id);
            removeInflightJob(id);
          }
          _activeLlmJobIds.clear();
          for (const c of _abortControllers) {
            try { c.abort(); } catch {}
          }
          _abortControllers.clear();
          _activeCount = 0;
          set(
            { isGenerating: false, isAnalyzingEntities: false, llmProgress: '', aiError: 'Generation stopped by user.' },
            false,
            'textGen/stop',
          );
        },

        handleClearAnalysis: () =>
          set(
            { selectedDiverseEntities: [], aiError: null, llmProgress: '' },
            false,
            'textGen/clearAnalysis',
          ),
      }),
      { name: 'textGenerationStore' },
    ),
    { partialize: textGenerationPartialize },
  ),
);
