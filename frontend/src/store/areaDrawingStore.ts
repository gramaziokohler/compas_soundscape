/**
 * Area Drawing Store
 *
 * Replaces AreaDrawingContext. Manages polygon area drawing state.
 * drawnAreas and areaVisualStates are stored directly in Zustand state
 * (as Maps) — version counter is kept for consumers that need a stable
 * dependency on "something changed".
 */

import { create } from 'zustand';
import { temporal } from 'zundo';
import { devtools } from 'zustand/middleware';
import type { DrawnArea, AreaVisualState } from '@/types/area-drawing';

// ─── Partialize ───────────────────────────────────────────────────────────────

export const areaDrawingPartialize = (state: AreaDrawingStoreState) => ({
  // Store Maps directly — zundo uses structuredClone which preserves Map objects
  drawnAreas: state.drawnAreas,
  areaVisualStates: state.areaVisualStates,
});

export interface AreaDrawingStoreState {
  drawnAreas: Map<number, DrawnArea>;
  areaVisualStates: Map<number, AreaVisualState>;
  isDrawing: boolean;
  drawingCardIndex: number | null;
  /** Increments on any state change — use as useEffect dependency. */
  version: number;
  /** Set to true when the sidebar "Validate" button or Enter key requests polygon close. */
  pendingConfirm: boolean;

  startDrawing: (cardIndex: number) => void;
  cancelDrawing: () => void;
  finishDrawing: (cardIndex: number, area: DrawnArea) => void;
  removeArea: (cardIndex: number) => void;
  setAreaVisualState: (cardIndex: number, state: AreaVisualState) => void;
  getArea: (cardIndex: number) => DrawnArea | undefined;
  hasArea: (cardIndex: number) => boolean;
  requestConfirmDrawing: () => void;
  clearConfirmDrawing: () => void;
  /**
   * Rebuild the runtime area map from persisted analysis configs. Called after
   * a soundscape restore so drawn areas survive a page refresh (they are stored
   * per text-card config in soundscape.json).
   */
  hydrateFromConfigs: (configs: Array<{ type: string; drawnArea?: DrawnArea | null }>) => void;
}

export const useAreaDrawingStore = create<AreaDrawingStoreState>()(
  temporal(
    devtools(
      (set, get) => ({
        drawnAreas: new Map(),
        areaVisualStates: new Map(),
        isDrawing: false,
        drawingCardIndex: null,
        version: 0,
        pendingConfirm: false,

        startDrawing: (cardIndex) =>
          set(
            (s) => ({ isDrawing: true, drawingCardIndex: cardIndex, version: s.version + 1 }),
            false,
            'areaDrawing/startDrawing',
          ),

        cancelDrawing: () =>
          set(
            (s) => ({ isDrawing: false, drawingCardIndex: null, version: s.version + 1 }),
            false,
            'areaDrawing/cancelDrawing',
          ),

        finishDrawing: (cardIndex, area) =>
          set(
            (s) => {
              const drawnAreas = new Map(s.drawnAreas).set(cardIndex, area);
              const areaVisualStates = new Map(s.areaVisualStates).set(cardIndex, 'default');
              return {
                drawnAreas,
                areaVisualStates,
                isDrawing: false,
                drawingCardIndex: null,
                version: s.version + 1,
              };
            },
            false,
            'areaDrawing/finishDrawing',
          ),

        removeArea: (cardIndex) =>
          set(
            (s) => {
              const drawnAreas = new Map(s.drawnAreas);
              drawnAreas.delete(cardIndex);
              const areaVisualStates = new Map(s.areaVisualStates);
              areaVisualStates.delete(cardIndex);
              return { drawnAreas, areaVisualStates, version: s.version + 1 };
            },
            false,
            'areaDrawing/removeArea',
          ),

        setAreaVisualState: (cardIndex, state) =>
          set(
            (s) => {
              const areaVisualStates = new Map(s.areaVisualStates).set(cardIndex, state);
              return { areaVisualStates, version: s.version + 1 };
            },
            false,
            'areaDrawing/setAreaVisualState',
          ),

        getArea: (cardIndex) => get().drawnAreas.get(cardIndex),

        hasArea: (cardIndex) => get().drawnAreas.has(cardIndex),

        requestConfirmDrawing: () =>
          set({ pendingConfirm: true }, false, 'areaDrawing/requestConfirmDrawing'),

        clearConfirmDrawing: () =>
          set({ pendingConfirm: false }, false, 'areaDrawing/clearConfirmDrawing'),

        hydrateFromConfigs: (configs) => {
          const drawnAreas = new Map<number, DrawnArea>();
          configs.forEach((config, index) => {
            if (config.type === 'text' && config.drawnArea) {
              drawnAreas.set(index, config.drawnArea);
            }
          });
          set(
            (s) => ({ drawnAreas, version: s.version + 1 }),
            false,
            'areaDrawing/hydrateFromConfigs',
          );
        },
      }),
      { name: 'areaDrawingStore' },
    ),
    { partialize: areaDrawingPartialize },
  ),
);
