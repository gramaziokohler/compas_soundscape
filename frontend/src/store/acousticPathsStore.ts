/**
 * Acoustic Paths Store
 *
 * Transient state of the sound-path view of the simulation cards: the paths each generated card's
 * run stored (read from its results JSON by SimulationResultContent), the IR (source-listener pair)
 * hovered or selected in a card's IR list — whose paths the 3D view draws — and which geometric
 * engines the backend offers. Not persisted and not undoable.
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { apiService } from '@/services/api';
import type { EngineCapabilities } from '@/lib/acoustics/geometric-engine';
import type { AcousticPathsFocus, AcousticPathsPayload } from '@/types/acousticPaths';

export interface AcousticPathsStoreState {
  /** Stored paths per card id (absent: none loaded, or the run stored none). */
  payloads: Record<string, AcousticPathsPayload>;
  /** IR row under the pointer. */
  hovered: AcousticPathsFocus | null;
  /** IR whose preview panel is open (shown when nothing is hovered). */
  selected: AcousticPathsFocus | null;
  /** null until loaded (or when the backend predates the endpoint). */
  capabilities: EngineCapabilities | null;
  capabilitiesLoaded: boolean;

  loadCapabilities: () => Promise<void>;
  /** The paths of a card's current run (null removes them and the card's hover / selection). */
  setPayload: (configId: string, payload: AcousticPathsPayload | null) => void;
  /** Hover an IR of a card; null ids clear that card's hover. */
  hoverPair: (configId: string, sourceId: string | null, receiverId: string | null) => void;
  /** Select an IR of a card; null ids clear that card's selection. */
  selectPair: (configId: string, sourceId: string | null, receiverId: string | null) => void;
}

function sameFocus(a: AcousticPathsFocus | null, b: AcousticPathsFocus | null): boolean {
  return a === b || (!!a && !!b && a.configId === b.configId && a.sourceId === b.sourceId && a.receiverId === b.receiverId);
}

/** The new focus of a card, or the current one when it belongs to another card. */
function nextFocus(
  current: AcousticPathsFocus | null,
  configId: string,
  sourceId: string | null,
  receiverId: string | null,
): AcousticPathsFocus | null {
  if (sourceId && receiverId) return { configId, sourceId, receiverId };
  return current?.configId === configId ? null : current;
}

/** The pair the 3D view draws: the hovered IR, else the selected one. */
export function shownPathsFocus(s: Pick<AcousticPathsStoreState, 'hovered' | 'selected'>): AcousticPathsFocus | null {
  return s.hovered ?? s.selected;
}

export const useAcousticPathsStore = create<AcousticPathsStoreState>()(
  devtools(
    (set, get) => ({
      payloads: {},
      hovered: null,
      selected: null,
      capabilities: null,
      capabilitiesLoaded: false,

      loadCapabilities: async () => {
        if (get().capabilitiesLoaded) return;
        set({ capabilitiesLoaded: true }, false, 'paths/capabilitiesRequested');
        try {
          const capabilities = await apiService.getAcousticsEngines();
          set({ capabilities }, false, 'paths/capabilities');
        } catch {
          // An older backend: leave null, the card then offers everything and the run decides.
          set({ capabilities: null }, false, 'paths/capabilitiesUnavailable');
        }
      },

      setPayload: (configId, payload) =>
        set((s) => {
          if (payload) {
            return s.payloads[configId] === payload ? {} : { payloads: { ...s.payloads, [configId]: payload } };
          }
          const { [configId]: _removed, ...rest } = s.payloads;
          return {
            payloads: rest,
            hovered: s.hovered?.configId === configId ? null : s.hovered,
            selected: s.selected?.configId === configId ? null : s.selected,
          };
        }, false, 'paths/payload'),

      hoverPair: (configId, sourceId, receiverId) =>
        set((s) => {
          const hovered = nextFocus(s.hovered, configId, sourceId, receiverId);
          return sameFocus(hovered, s.hovered) ? {} : { hovered };
        }, false, 'paths/hover'),

      selectPair: (configId, sourceId, receiverId) =>
        set((s) => {
          const selected = nextFocus(s.selected, configId, sourceId, receiverId);
          return sameFocus(selected, s.selected) ? {} : { selected };
        }, false, 'paths/select'),
    }),
    { name: 'acousticPathsStore' },
  ),
);
