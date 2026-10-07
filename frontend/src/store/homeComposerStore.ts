/**
 * homeComposerStore
 *
 * Open state of the centred Home new-scene panel. It lives outside the Simple /
 * Expert views so it stays open across a mode switch. Not persisted: it opens
 * once per page load of a fresh Home stage and is dismissed by "+", reduce,
 * sending a prompt, or loading a model.
 */
import { create } from 'zustand';

interface HomeComposerState {
  isOpen: boolean;
  /** Scene just created from the Home panel — Simple mode opens its workflow view. */
  submittedUsageIndex: number | null;
  open: () => void;
  dismiss: () => void;
  setSubmitted: (usageIndex: number | null) => void;
}

export const useHomeComposerStore = create<HomeComposerState>()((set) => ({
  isOpen: false,
  submittedUsageIndex: null,
  open: () => set({ isOpen: true }),
  dismiss: () => set({ isOpen: false }),
  setSubmitted: (usageIndex) => set({ submittedUsageIndex: usageIndex }),
}));
