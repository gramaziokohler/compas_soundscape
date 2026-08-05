import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

/**
 * Scenario 3D preview — transient UI state (not persisted, not undoable).
 *
 * When a scenario card is expanded, the sidebar writes the scenario's involved
 * object IDs and the ordered parcours stops here. `useSpeckleScenarioPreview`
 * (in SpeckleScene) subscribes and:
 *   - colors every `objectIds` entry light-primary via the FilteringExtension
 *     (same pipeline as the hover highlight — always while the card is expanded),
 *   - draws dashed-arrow segments between consecutive stops of each `parcours`
 *     line, only while the viewer's "Show scenario parcours" toggle
 *     (`uiStore.showScenarioParcours`, Advanced Settings → Viewer) is on.
 *
 * `parcours` holds one stop per object REFERENCE in the scenario text (an
 * object repeated in the text yields repeated stops), so the arrow count is
 * references − 1 and each arrow connects one object to the next.
 */

/** One parcours stop = a single object reference in the scenario text.
 *  Its 3D point is the object's bounds center (resolved in the hook).
 *  Repeats of the same object are kept as separate stops so each reference
 *  in the text becomes its own waypoint. */
export interface ScenarioPreviewStop {
  id: string;
}

/** Parcours data: one array of stops per scenario, in event order. */
export type ScenarioPreviewParcours = ScenarioPreviewStop[][];

export interface ScenarioPreviewStoreState {
  enabled: boolean;
  /** Speckle object IDs involved in the scenario — highlighted light-primary */
  objectIds: string[];
  /** Ordered stops (one array per scenario) for the dashed parcours */
  parcours: ScenarioPreviewParcours;
  setPreview: (preview: { objectIds: string[]; parcours: ScenarioPreviewParcours }) => void;
  clearPreview: () => void;
}

const initialState = {
  enabled: false,
  objectIds: [] as string[],
  parcours: [] as ScenarioPreviewParcours,
};

export const useScenarioPreviewStore = create<ScenarioPreviewStoreState>()(
  devtools(
    (set) => ({
      ...initialState,
      setPreview: (preview) => set({ enabled: true, ...preview }),
      clearPreview: () => set(initialState),
    }),
    { name: 'scenarioPreviewStore' },
  ),
);
