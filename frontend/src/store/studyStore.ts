/**
 * Study Store
 *
 * UI state of the research-study logger: whether study logging is on (from
 * GET /api/study/config), the participant pseudonym shown for the external SUS
 * form, and the pending design-intent question shown in the model loading
 * overlay (version upload / first import). Not undo-tracked, not persisted —
 * the question draft itself is kept in localStorage by DesignIntentPrompt.
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { StudyIntentPrompt } from '@/types/study';

export interface StudyStoreState {
  enabled: boolean;
  pseudonym: string | null;
  pendingIntentPrompt: StudyIntentPrompt | null;
  /** Incremented by the Moment shortcut; the feedback button opens on its Moment tab. */
  momentRequestNonce: number;
  setStudyEnabled: (enabled: boolean, pseudonym: string | null) => void;
  /** Ask the design-intent question (no-op while study logging is off). */
  requestIntentPrompt: (prompt: StudyIntentPrompt) => void;
  /** Fill in the version id once the new version is known. */
  setIntentTargetVersion: (toVersionId: string | null) => void;
  clearIntentPrompt: () => void;
  /** Open the Moment capture (keyboard shortcut). No-op while study logging is off. */
  requestMoment: () => void;
}

export const useStudyStore = create<StudyStoreState>()(
  devtools(
    (set, get) => ({
      enabled: false,
      pseudonym: null,
      pendingIntentPrompt: null,
      momentRequestNonce: 0,
      setStudyEnabled: (enabled, pseudonym) =>
        set({ enabled, pseudonym }, false, 'study/setEnabled'),
      requestIntentPrompt: (prompt) => {
        if (!get().enabled) return;
        set({ pendingIntentPrompt: prompt }, false, 'study/requestIntentPrompt');
      },
      setIntentTargetVersion: (toVersionId) => {
        const pending = get().pendingIntentPrompt;
        if (!pending) return;
        set({ pendingIntentPrompt: { ...pending, toVersionId } }, false, 'study/setIntentTargetVersion');
      },
      clearIntentPrompt: () => set({ pendingIntentPrompt: null }, false, 'study/clearIntentPrompt'),
      requestMoment: () => {
        if (!get().enabled) return;
        set((s) => ({ momentRequestNonce: s.momentRequestNonce + 1 }), false, 'study/requestMoment');
      },
    }),
    { name: 'studyStore' },
  ),
);
