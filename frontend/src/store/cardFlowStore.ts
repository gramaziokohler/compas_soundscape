/**
 * cardFlowStore
 *
 * Tracks the parent→child relationships between analysis cards across steps.
 * When a context card advances to Usage, we record its original index.
 * When a usage card advances to Sounds, we record its original index.
 * This lets the breadcrumb highlight the "next step" as a clickable blue link
 * whenever the expanded parent card has generated children.
 */
import { create } from 'zustand';

interface CardFlowState {
  /** Original indices of context cards that have been used to advance to the Usage step. */
  contextAdvanced: Set<number>;
  /** Original indices of usage cards that have been used to advance to the Sounds step. */
  usageAdvanced: Set<number>;

  recordContextAdvance: (originalIndex: number) => void;
  recordUsageAdvance: (originalIndex: number) => void;
  hasContextAdvanced: (originalIndex: number) => boolean;
  hasUsageAdvanced: (originalIndex: number) => boolean;
  reset: () => void;
}

export const useCardFlowStore = create<CardFlowState>()((set, get) => ({
  contextAdvanced: new Set(),
  usageAdvanced: new Set(),

  recordContextAdvance: (originalIndex) =>
    set((state) => ({
      contextAdvanced: new Set([...state.contextAdvanced, originalIndex]),
    })),

  recordUsageAdvance: (originalIndex) =>
    set((state) => ({
      usageAdvanced: new Set([...state.usageAdvanced, originalIndex]),
    })),

  hasContextAdvanced: (originalIndex) => get().contextAdvanced.has(originalIndex),
  hasUsageAdvanced: (originalIndex) => get().usageAdvanced.has(originalIndex),

  reset: () => set({ contextAdvanced: new Set(), usageAdvanced: new Set() }),
}));
