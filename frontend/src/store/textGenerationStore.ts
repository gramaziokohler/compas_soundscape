/**
 * Text Generation Store
 *
 * Holds the token-settings accordion trigger used by Advanced Settings,
 * SpeckleScene, SpeckleModelBrowser, SceneEmptyState, and errorsStore.
 * The former job-based text-generation workflow was removed; prompt
 * generation now lives in analysisStore via SSE stream endpoints.
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

export interface TextGenerationStoreState {
  tokenSettingsTrigger: number;
  /** Switch to settings tab, expand sidebar, and open the API Tokens accordion. */
  triggerOpenTokenSettings: () => void;
}

export const useTextGenerationStore = create<TextGenerationStoreState>()(
  devtools(
    (set) => ({
      tokenSettingsTrigger: 0,
      triggerOpenTokenSettings: () =>
        set(
          (s) => ({ tokenSettingsTrigger: s.tokenSettingsTrigger + 1 }),
          false,
          'textGen/openTokenSettings',
        ),
    }),
    { name: 'textGenerationStore' },
  ),
);
