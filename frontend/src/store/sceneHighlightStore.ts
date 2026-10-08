import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

/**
 * Simple-mode scene highlights — transient UI state (not persisted, not undoable).
 *
 * Simple mode only colors the model while the analysis / scenario step runs;
 * afterwards these toggles (scene workflow panel) bring the colors back.
 * `useSimpleSceneHighlights` is the only reader that drives the viewer.
 */
export interface SceneHighlightStoreState {
  /** Model-analysis card whose object groups are shown (null = off). */
  analysisContextIndex: number | null;
  /** Scenario (usage) card whose referenced objects are shown (null = off). */
  scenarioUsageIndex: number | null;
  /** Group hovered in the analysis group list — colored alone. */
  focusedGroup: { contextIndex: number; groupIndex: number } | null;
  setAnalysisShown: (contextIndex: number | null) => void;
  setScenarioShown: (usageIndex: number | null) => void;
  setFocusedGroup: (focus: { contextIndex: number; groupIndex: number } | null) => void;
  reset: () => void;
}

const initialState = {
  analysisContextIndex: null as number | null,
  scenarioUsageIndex: null as number | null,
  focusedGroup: null as { contextIndex: number; groupIndex: number } | null,
};

export const useSceneHighlightStore = create<SceneHighlightStoreState>()(
  devtools(
    (set) => ({
      ...initialState,
      setAnalysisShown: (contextIndex) =>
        set({ analysisContextIndex: contextIndex }, false, 'sceneHighlight/analysis'),
      setScenarioShown: (usageIndex) =>
        set({ scenarioUsageIndex: usageIndex }, false, 'sceneHighlight/scenario'),
      setFocusedGroup: (focus) => set({ focusedGroup: focus }, false, 'sceneHighlight/focusGroup'),
      reset: () => set(initialState, false, 'sceneHighlight/reset'),
    }),
    { name: 'sceneHighlightStore' },
  ),
);
