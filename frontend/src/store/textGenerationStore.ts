/**
 * Text Generation Store
 *
 * Replaces useTextGeneration. Manages the AI text-to-soundscape generation
 * workflow: prompt generation from a space description.
 *
 * AbortController is a non-serializable — kept as a module-level ref.
 *
 * zundo partializes on aiPrompt and numSounds.
 */

import { create } from 'zustand';
import { temporal } from 'zundo';
import { devtools } from 'zustand/middleware';
import {
  DEFAULT_NUM_SOUNDS,
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
});

// ─── State ────────────────────────────────────────────────────────────────────

export interface TextGenerationStoreState {
  aiPrompt: string;
  aiResponse: string | null;
  aiError: string | null;
  isGenerating: boolean;
  numSounds: number;
  llmProgress: string;
  showConfirmLoadSounds: boolean;
  pendingSoundConfigs: any[];
  activeAiTab: ActiveTab;

  tokenSettingsTrigger: number;

  setAiPrompt: (prompt: string) => void;
  setNumSounds: (n: number) => void;
  setActiveAiTab: (tab: ActiveTab) => void;
  setPendingSoundConfigs: (configs: any[]) => void;
  /** Switch to settings tab, expand sidebar, and open the API Tokens accordion. */
  triggerOpenTokenSettings: () => void;

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
        numSounds: DEFAULT_NUM_SOUNDS,
        llmProgress: '',
        showConfirmLoadSounds: false,
        pendingSoundConfigs: [],
        activeAiTab: 'text' as ActiveTab,
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

        handleGenerateText: async () => {
          const { aiPrompt, numSounds } = get();

          if (!aiPrompt.trim()) {
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
              const displayText = result.prompts
                .map((item: any, idx: number) => `${idx + 1}. ${item.prompt}`)
                .join('\n');

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
            { isGenerating: false, llmProgress: '', aiError: 'Generation stopped by user.' },
            false,
            'textGen/stop',
          );
        },

        handleClearAnalysis: () =>
          set(
            { aiError: null, llmProgress: '' },
            false,
            'textGen/clearAnalysis',
          ),
      }),
      { name: 'textGenerationStore' },
    ),
    { partialize: textGenerationPartialize },
  ),
);
