import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

/**
 * Analysis preview — transient UI state for a text-based card.
 *
 * While the card is expanded the scene:
 *   - highlights every linked analysis-group object id (same light-warning
 *     pipeline as scenario objects), and
 *   - shows preview spheres at each SELECTED prompt's planned position
 *     (bounding box / drawn area placements).
 *
 * Also tracks which text card is expanded so the drawn-area polygon only shows
 * for that card in the Usage step.
 *
 * Not persisted and not undoable.
 */

export interface AnalysisPreviewPoint {
  promptId: string;
  position: [number, number, number];
  label: string;
  /** Render a preview sphere (unlinked prompts). Linked prompts show label-only. */
  showSphere?: boolean;
}

export interface AnalysisPreviewStoreState {
  active: boolean;
  cardIndex: number | null;
  /** Speckle object ids linked to the analysis groups of selected prompts. */
  objectIds: string[];
  /** Planned positions for selected prompts that are not linked to an object. */
  points: AnalysisPreviewPoint[];
  /** Prompt id currently hovered in the result list (highlights its preview). */
  highlightedPromptId: string | null;
  /** Original index of the expanded text card (gates the drawn-area polygon). */
  expandedTextCardIndex: number | null;
  setPreview: (preview: {
    cardIndex: number;
    objectIds: string[];
    points: AnalysisPreviewPoint[];
  }) => void;
  clearPreview: () => void;
  setHighlightedPrompt: (promptId: string | null) => void;
  setExpandedTextCard: (cardIndex: number | null) => void;
}

const initialState = {
  active: false,
  cardIndex: null as number | null,
  objectIds: [] as string[],
  points: [] as AnalysisPreviewPoint[],
  highlightedPromptId: null as string | null,
  expandedTextCardIndex: null as number | null,
};

export const useAnalysisPreviewStore = create<AnalysisPreviewStoreState>()(
  devtools(
    (set) => ({
      ...initialState,
      setPreview: (preview) => set({ active: true, ...preview }, false, 'analysisPreview/set'),
      clearPreview: () =>
        set({ active: false, cardIndex: null, objectIds: [], points: [], highlightedPromptId: null }, false, 'analysisPreview/clear'),
      setHighlightedPrompt: (promptId) =>
        set({ highlightedPromptId: promptId }, false, 'analysisPreview/highlightPrompt'),
      setExpandedTextCard: (cardIndex) =>
        set({ expandedTextCardIndex: cardIndex }, false, 'analysisPreview/expandedCard'),
    }),
    { name: 'analysisPreviewStore' },
  ),
);
