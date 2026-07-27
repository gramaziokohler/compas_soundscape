/**
 * cardFlowStore
 *
 * Tracks the parent→child relationships between analysis cards across steps.
 * When a context card advances to Usage, we record its original index.
 * When a usage card advances to Sounds, we record its original index.
 * This lets the breadcrumb highlight the "next step" as a clickable blue link
 * whenever the expanded parent card has generated children.
 *
 * Also maintains parent→child index mappings for ctrl+drag copy support —
 * when a card is duplicated with linked results, we can find its children.
 */
import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import type { PersistStorage, StorageValue } from 'zustand/middleware';

const cardFlowStorage: PersistStorage<CardFlowState> = {
  getItem: (name) => {
    try {
      const raw = localStorage.getItem(name);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return {
        ...parsed,
        state: {
          ...parsed.state,
          contextAdvanced: new Set(parsed.state?.contextAdvanced || []),
          usageAdvanced: new Set(parsed.state?.usageAdvanced || []),
          contextToUsageMap: new Map(parsed.state?.contextToUsageMap || []),
          usageToSoundMap: new Map(parsed.state?.usageToSoundMap || []),
        },
      } as StorageValue<CardFlowState>;
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    const serialized = JSON.stringify({
      ...value,
      state: {
        ...value.state,
        contextAdvanced: [...(value.state.contextAdvanced || [])],
        usageAdvanced: [...(value.state.usageAdvanced || [])],
        contextToUsageMap: [...(value.state.contextToUsageMap || [])],
        usageToSoundMap: [...(value.state.usageToSoundMap || [])],
      },
    });
    localStorage.setItem(name, serialized);
  },
  removeItem: (name) => localStorage.removeItem(name),
};

export interface CardFlowState {
  /** Original indices of context cards that have been used to advance to the Usage step. */
  contextAdvanced: Set<number>;
  /** Original indices of usage cards that have been used to advance to the Sounds step. */
  usageAdvanced: Set<number>;

  /** Maps a context index → usage indices created from it (for ctrl+drag copy). */
  contextToUsageMap: Map<number, number[]>;
  /** Maps a usage index → sound indices created from it (for ctrl+drag copy). */
  usageToSoundMap: Map<number, number[]>;

  recordContextAdvance: (originalIndex: number) => void;
  recordUsageAdvance: (originalIndex: number) => void;

  /** Record that a specific usage card was created from a context card. */
  recordContextAdvanceWithChild: (contextIndex: number, usageIndex: number) => void;
  /** Record that a specific sound card was created from a usage card. */
  recordUsageAdvanceWithChild: (usageIndex: number, soundIndex: number) => void;

  /** Get usage indices linked to a context card. */
  getContextChildren: (contextIndex: number) => number[];
  /** Get sound indices linked to a usage card. */
  getUsageChildren: (usageIndex: number) => number[];

  hasContextAdvanced: (originalIndex: number) => boolean;
  hasUsageAdvanced: (originalIndex: number) => boolean;
  reset: () => void;

  /** Active context card index (which context card is selected in step 0). Persisted for refresh survival. */
  activeContextOriginalIndex: number | null;
  setActiveContextOriginalIndex: (index: number | null) => void;
  /** Active usage card index (which usage card is selected in step 1). Persisted for refresh survival. */
  activeUsageOriginalIndex: number | null;
  setActiveUsageOriginalIndex: (index: number | null) => void;
}

export const useCardFlowStore = create<CardFlowState>()(
  persist(
    devtools(
      (set, get) => ({
  contextAdvanced: new Set(),
  usageAdvanced: new Set(),
  contextToUsageMap: new Map(),
  usageToSoundMap: new Map(),
  activeContextOriginalIndex: null as number | null,
  activeUsageOriginalIndex: null as number | null,

  recordContextAdvance: (originalIndex) =>
    set((state) => ({
      contextAdvanced: new Set([...state.contextAdvanced, originalIndex]),
    })),

  recordUsageAdvance: (originalIndex) =>
    set((state) => ({
      usageAdvanced: new Set([...state.usageAdvanced, originalIndex]),
    })),

  recordContextAdvanceWithChild: (contextIndex, usageIndex) =>
    set((state) => {
      const newMap = new Map(state.contextToUsageMap);
      const existing = newMap.get(contextIndex) || [];
      newMap.set(contextIndex, [...existing, usageIndex]);
      return {
        contextToUsageMap: newMap,
        contextAdvanced: new Set([...state.contextAdvanced, contextIndex]),
      };
    }),

  recordUsageAdvanceWithChild: (usageIndex, soundIndex) =>
    set((state) => {
      const newMap = new Map(state.usageToSoundMap);
      const existing = newMap.get(usageIndex) || [];
      newMap.set(usageIndex, [...existing, soundIndex]);
      return {
        usageToSoundMap: newMap,
        usageAdvanced: new Set([...state.usageAdvanced, usageIndex]),
      };
    }),

  getContextChildren: (contextIndex) => {
    return get().contextToUsageMap.get(contextIndex) || [];
  },

  getUsageChildren: (usageIndex) => {
    return get().usageToSoundMap.get(usageIndex) || [];
  },

  hasContextAdvanced: (originalIndex) => get().contextAdvanced.has(originalIndex),
  hasUsageAdvanced: (originalIndex) => get().usageAdvanced.has(originalIndex),

  reset: () => set({
    contextAdvanced: new Set(),
    usageAdvanced: new Set(),
    contextToUsageMap: new Map(),
    usageToSoundMap: new Map(),
    activeContextOriginalIndex: null,
    activeUsageOriginalIndex: null,
  }),
  setActiveContextOriginalIndex: (index) => set({ activeContextOriginalIndex: index }, false, 'cardFlow/setActiveContext'),
  setActiveUsageOriginalIndex: (index) => set({ activeUsageOriginalIndex: index }, false, 'cardFlow/setActiveUsage'),
    }),
    { name: 'cardFlowStore' },
  ),
  {
    name: 'compas-cardflow-state',
    storage: cardFlowStorage,
    skipHydration: true,
  },
));
