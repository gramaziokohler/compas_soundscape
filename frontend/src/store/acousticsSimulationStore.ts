/**
 * Acoustics Simulation Store
 *
 * Replaces useAcousticsSimulation. Manages the list of acoustic simulation
 * configurations (Resonance / Pyroomacoustics / PFFDTD), active/expanded
 * tab indices, and a counter for unique naming.
 *
 * Previously used a module-level singleton to survive tab switches — this
 * Zustand store accomplishes the same without module-level hacks.
 *
 * Undo covers adding / removing / reordering / editing configs (see the Undo
 * section below); simulation runs and their results are never undone.
 */

import { create } from 'zustand';
import { temporal } from 'zundo';
import { devtools } from 'zustand/middleware';
import type {
  AcousticSimulationMode,
  SimulationConfig,
  ResonanceSimulationConfig,
  PyroomAcousticsSimulationConfig,
  PffdtdSimulationConfig,
  ImportIRsSimulationConfig,
} from '@/types/acoustics';
import { CARD_TYPE_LABELS } from '@/types/card';
import {
  PYROOMACOUSTICS_DEFAULT_MAX_ORDER,
  PYROOMACOUSTICS_DEFAULT_RAY_TRACING,
  PYROOMACOUSTICS_DEFAULT_AIR_ABSORPTION,
  PYROOMACOUSTICS_RAY_TRACING_N_RAYS,
  PYROOMACOUSTICS_DEFAULT_SIMULATION_MODE,
  PYROOMACOUSTICS_DEFAULT_ENABLE_GRID,
  PFFDTD,
} from '@/utils/constants';
import { UNDO_HISTORY_LIMIT, undoEquality, type RegisterTemporalStoreOptions } from './undoRedoRegistry';

// ─── Undo ─────────────────────────────────────────────────────────────────────
//
// Simulation runs are NOT undo steps: their run state and results (written by
// the polling jobs) are excluded from step detection and always kept live when
// a snapshot is applied, so Ctrl+Z can never discard a finished simulation.
// View-only card fields (expanded panels, chosen heatmap metric, isolation) are
// excluded the same way. Card activation / expansion are navigation state —
// they follow their card by id across undo instead of being restored.

/** Fields written by a simulation run (Pyroomacoustics / PFFDTD cards). */
const SIM_RUN_KEYS = [
  'state', 'completedAt', 'isRunning', 'progress', 'status', 'error',
  'simulationResults', 'currentSimulationId', 'currentSimulationRunId',
  'importedIRIds', 'importedIRMetadata', 'sourceReceiverIRMapping',
  'simulationPositions', 'savedSettings', 'generatedSignature', 'simulatedVersionId',
  'queuePosition', 'queueTotal', 'runProblems',
] as const;
/** Transient execution fields of cards without a backend run (import-irs). */
const EXECUTION_KEYS = ['isRunning', 'progress', 'status', 'error', 'currentSimulationRunId'] as const;
/** View-only card fields. */
const SIM_VIEW_KEYS = [
  'advancedSettingsExpanded', 'selectedGradientMetric', 'speckleIsolatedObjectIds', 'expandedMaterialItems',
] as const;

function liveOnlyKeys(config: SimulationConfig): readonly string[] {
  const runKeys = config.type === 'pyroomacoustics' || config.type === 'pffdtd'
    ? SIM_RUN_KEYS
    : EXECUTION_KEYS;
  return [...runKeys, ...SIM_VIEW_KEYS];
}

/** The user-editable part of a config (what an undo step is made of). */
function editableProjection(config: SimulationConfig): Record<string, unknown> {
  const out: Record<string, unknown> = { ...config };
  for (const key of liveOnlyKeys(config)) delete out[key];
  return out;
}

export const acousticsSimulationPartialize = (state: AcousticsSimulationStoreState) => ({
  simulationConfigs: state.simulationConfigs,
  roomScale: state.roomScale,
});

type AcousticsSimulationSnapshot = ReturnType<typeof acousticsSimulationPartialize>;

const acousticsSimulationEquality = (a: AcousticsSimulationSnapshot, b: AcousticsSimulationSnapshot) =>
  undoEquality(a.roomScale, b.roomScale) &&
  a.simulationConfigs.length === b.simulationConfigs.length &&
  a.simulationConfigs.every((c, i) => undoEquality(editableProjection(c), editableProjection(b.simulationConfigs[i])));

export const acousticsSimulationUndo: RegisterTemporalStoreOptions<
  AcousticsSimulationStoreState,
  AcousticsSimulationSnapshot
> = {
  partialize: acousticsSimulationPartialize,
  equality: acousticsSimulationEquality,
  apply: (snapshot) => {
    const live = useAcousticsSimulationStore.getState();
    const liveById = new Map(live.simulationConfigs.map((c) => [c.id, c]));
    const configs = snapshot.simulationConfigs.map((config) => {
      const liveConfig = liveById.get(config.id);
      const merged: Record<string, unknown> = { ...config };
      if (liveConfig) {
        // Keep the live run state / results / view fields of a card that still exists.
        for (const key of liveOnlyKeys(config)) merged[key] = (liveConfig as unknown as Record<string, unknown>)[key];
      } else if (merged.isRunning) {
        // Restored card (undo of a delete) — its old run is no longer tracked.
        merged.isRunning = false;
        merged.progress = 0;
        merged.status = '';
        merged.currentSimulationRunId = null;
      }
      return merged as unknown as SimulationConfig;
    });
    const idAt = (index: number | null) => (index === null ? null : live.simulationConfigs[index]?.id ?? null);
    const indexOf = (id: string | null) => {
      if (id === null) return null;
      const idx = configs.findIndex((c) => c.id === id);
      return idx >= 0 ? idx : null;
    };
    useAcousticsSimulationStore.setState({
      simulationConfigs: configs,
      roomScale: snapshot.roomScale,
      activeSimulationIndex: indexOf(idAt(live.activeSimulationIndex)),
      expandedTabIndex: indexOf(idAt(live.expandedTabIndex)),
    });
  },
};

// ─── State ────────────────────────────────────────────────────────────────────

export interface AcousticsSimulationStoreState {
  simulationConfigs: SimulationConfig[];
  activeSimulationIndex: number | null;
  expandedTabIndex: number | null;
  simulationCounter: number;
  roomScale: { x: number; y: number; z: number };
  /**
   * Bumped by `restoreSimulationState`. Consumers (AcousticsSection) watch it to
   * know a bulk payload restore just happened and must NOT auto-expand or
   * auto-activate a card — opening a model / refreshing starts fully reduced.
   * Never persisted.
   */
  restoreNonce: number;

  handleAddConfig: (mode: AcousticSimulationMode) => void;
  handleRemoveConfig: (index: number) => void;
  handleReorderConfigs: (from: number, to: number) => void;
  /** Ctrl+drag duplicate — deep-clones the config at `from` and inserts at `toInsertion`. */
  duplicateConfigAt: (from: number, toInsertion: number) => void;
  handleUpdateConfig: (index: number, updates: Partial<SimulationConfig>) => void;
  handleSetActiveSimulation: (index: number | null) => void;
  handleUpdateSimulationName: (index: number, name: string) => void;
  handleToggleExpand: (index: number) => void;
  setRoomScale: (scale: { x: number; y: number; z: number }) => void;
  restoreSimulationState: (
    savedConfigs: SimulationConfig[],
    savedActiveIndex: number | null,
  ) => void;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useAcousticsSimulationStore = create<AcousticsSimulationStoreState>()(
  temporal(
    devtools(
      (set, get) => ({
        simulationConfigs: [],
        activeSimulationIndex: null,
        expandedTabIndex: null,
        simulationCounter: 1,
        roomScale: { x: 1, y: 1, z: 1 },
        restoreNonce: 0,

        setRoomScale: (scale) =>
          set({ roomScale: scale }, false, 'acousticsSim/setRoomScale'),

        handleAddConfig: (mode) => {
          const { simulationConfigs, simulationCounter } = get();
          const timestamp = Date.now();
          const id = `sim_${timestamp}`;
          const name = `${CARD_TYPE_LABELS[mode]} ${simulationCounter}`;

          let newConfig: SimulationConfig;

          switch (mode) {
            case 'resonance':
              newConfig = {
                id,
                display_name: name,
                type: 'resonance',
                state: 'idle',
                createdAt: timestamp,
              } as ResonanceSimulationConfig;
              break;

            case 'pyroomacoustics':
              newConfig = {
                id,
                display_name: name,
                type: 'pyroomacoustics',
                state: 'before-simulation',
                createdAt: timestamp,
                simulationInstanceId: `pyroom_${timestamp}`,
                settings: {
                  max_order: PYROOMACOUSTICS_DEFAULT_MAX_ORDER,
                  ray_tracing: PYROOMACOUSTICS_DEFAULT_RAY_TRACING,
                  air_absorption: PYROOMACOUSTICS_DEFAULT_AIR_ABSORPTION,
                  n_rays: PYROOMACOUSTICS_RAY_TRACING_N_RAYS,
                  simulation_mode: PYROOMACOUSTICS_DEFAULT_SIMULATION_MODE,
                  enable_grid: PYROOMACOUSTICS_DEFAULT_ENABLE_GRID,
                },
                faceToMaterialMap: new Map(),
                isRunning: false,
                progress: 0,
                status: 'Idle',
                error: null,
                simulationResults: null,
              } as PyroomAcousticsSimulationConfig;
              break;

            case 'pffdtd':
              newConfig = {
                id,
                display_name: name,
                type: 'pffdtd',
                state: 'before-simulation',
                createdAt: timestamp,
                simulationInstanceId: `pffdtd_${timestamp}`,
                settings: {
                  simulation_mode: PYROOMACOUSTICS_DEFAULT_SIMULATION_MODE,
                  fmax: PFFDTD.DEFAULT_FMAX,
                  ppw: PFFDTD.DEFAULT_PPW,
                  duration: PFFDTD.DEFAULT_DURATION,
                  air_absorption: PFFDTD.DEFAULT_AIR_ABSORPTION,
                  free_mode: PFFDTD.DEFAULT_FREE_MODE,
                  free_grid_spacing: PFFDTD.FREE_GRID_SPACING_DEFAULT,
                },
                faceToMaterialMap: new Map(),
                isRunning: false,
                progress: 0,
                status: 'Idle',
                error: null,
                simulationResults: null,
              } satisfies PffdtdSimulationConfig;
              break;

            case 'import-irs':
              newConfig = {
                id,
                display_name: name,
                type: 'import-irs',
                state: 'idle',
                createdAt: timestamp,
                simulationResults: null,
                importedIRIds: undefined,
                sourceReceiverIRMapping: undefined,
                irImportMode: 'single',
              } as ImportIRsSimulationConfig;
              break;

          }

          const newIndex = simulationConfigs.length;
          set(
            {
              simulationConfigs: [...simulationConfigs, newConfig],
              simulationCounter: simulationCounter + 1,
              expandedTabIndex: newIndex,
            },
            false,
            'acousticsSim/addConfig',
          );
        },

        handleReorderConfigs: (from, to) => {
          const { simulationConfigs, activeSimulationIndex, expandedTabIndex } = get();
          const newConfigs = [...simulationConfigs];
          const [removed] = newConfigs.splice(from, 1);
          newConfigs.splice(to, 0, removed);
          const remap = (idx: number | null): number | null => {
            if (idx === null) return null;
            if (idx === from) return to;
            if (from < to && idx > from && idx <= to) return idx - 1;
            if (from > to && idx >= to && idx < from) return idx + 1;
            return idx;
          };
          set(
            { simulationConfigs: newConfigs, activeSimulationIndex: remap(activeSimulationIndex), expandedTabIndex: remap(expandedTabIndex) },
            false,
            'acousticsSim/reorderConfigs',
          );
        },

        duplicateConfigAt: (from, toInsertion) => {
          const { simulationConfigs, activeSimulationIndex, expandedTabIndex, simulationCounter } = get();
          const config = simulationConfigs[from];
          if (!config) return;

          const cloned = structuredClone(config) as SimulationConfig;
          const simCount = simulationCounter + 1;

          set({ simulationCounter: simCount }, false, 'acousticsSim/incrementCounter');

          cloned.id = `${cloned.type}-${simCount}`;
          cloned.display_name = cloned.display_name
            ? `${cloned.display_name} (copy)`
            : cloned.type === 'resonance'
              ? `${CARD_TYPE_LABELS[cloned.type]} ${simCount}`
              : undefined;

          // Reset execution state; preserve config settings
          if (cloned.type !== 'resonance') {
            const sim = cloned as any;
            sim.state = 'before-simulation';
            sim.isRunning = false;
            sim.progress = 0;
            sim.status = '';
            sim.error = null;
            sim.simulationResults = null;
            sim.currentSimulationId = null;
            sim.currentSimulationRunId = null;
            sim.importedIRMetadata = undefined;
            sim.importedIRIds = undefined;
            sim.sourceReceiverIRMapping = undefined;
            if (sim.savedSettings) {
              sim.settings = { ...sim.savedSettings.settings };
              if (sim.savedSettings.faceToMaterialMap) {
                sim.faceToMaterialMap = new Map(sim.savedSettings.faceToMaterialMap);
              }
              sim.expandedMaterialItems = sim.savedSettings.expandedMaterialItems;
              sim.excludedLayers = sim.savedSettings.excludedLayers;
              sim.savedSettings = undefined;
            }
          }

          const newConfigs = [...simulationConfigs];
          const insertAt = toInsertion > from ? toInsertion - 1 : toInsertion;
          newConfigs.splice(insertAt, 0, cloned);

          const remap = (idx: number | null): number | null => {
            if (idx === null) return null;
            if (idx >= insertAt) return idx + 1;
            return idx;
          };

          set(
            {
              simulationConfigs: newConfigs,
              activeSimulationIndex: remap(activeSimulationIndex),
              expandedTabIndex: remap(expandedTabIndex),
            },
            false,
            'acousticsSim/duplicateConfigAt',
          );
        },

        handleRemoveConfig: (index) => {
          const { simulationConfigs, activeSimulationIndex, expandedTabIndex } = get();
          const nextConfigs = simulationConfigs.filter((_, i) => i !== index);

          let nextActive = activeSimulationIndex;
          if (activeSimulationIndex === index) nextActive = null;
          else if (activeSimulationIndex !== null && activeSimulationIndex > index)
            nextActive = activeSimulationIndex - 1;

          let nextExpanded = expandedTabIndex;
          if (expandedTabIndex === index) nextExpanded = null;
          else if (expandedTabIndex !== null && expandedTabIndex > index)
            nextExpanded = expandedTabIndex - 1;

          set(
            {
              simulationConfigs: nextConfigs,
              activeSimulationIndex: nextActive,
              expandedTabIndex: nextExpanded,
            },
            false,
            'acousticsSim/removeConfig',
          );
        },

        handleUpdateConfig: (index, updates) => {
          set(
            (s) => {
              const current = s.simulationConfigs[index];
              if (!current) return s;

              const hasChanges = Object.entries(updates).some(
                ([k, v]) => (current as any)[k] !== v,
              );
              if (!hasChanges) return s;

              const next = s.simulationConfigs.map((cfg, i) => {
                if (i !== index) return cfg;
                const updated = { ...cfg };
                for (const key of Object.keys(updates)) {
                  (updated as any)[key] = (updates as any)[key];
                }
                return updated as SimulationConfig;
              });
              return { simulationConfigs: next };
            },
            false,
            'acousticsSim/updateConfig',
          );
        },

        handleSetActiveSimulation: (index) =>
          set(
            { activeSimulationIndex: index, ...(index !== null ? { expandedTabIndex: index } : {}) },
            false,
            'acousticsSim/setActive',
          ),

        handleUpdateSimulationName: (index, name) =>
          set(
            (s) => ({
              simulationConfigs: s.simulationConfigs.map((cfg, i) =>
                i === index ? { ...cfg, display_name: name } : cfg,
              ),
            }),
            false,
            'acousticsSim/updateName',
          ),

        handleToggleExpand: (index) =>
          set(
            (s) => ({ expandedTabIndex: s.expandedTabIndex === index ? null : index }),
            false,
            'acousticsSim/toggleExpand',
          ),

        restoreSimulationState: (savedConfigs, _savedActiveIndex) =>
          set(
            (s) => ({
              simulationConfigs: savedConfigs,
              // Restored cards start fully reduced: collapsed AND inactive, so no
              // IR convolution is applied on load. AcousticsSection sees the null
              // active index and switches playback back to anechoic (dry) — the
              // exact effect of manually collapsing an acoustic card. The user
              // re-activates via the card's power button.
              activeSimulationIndex: null,
              expandedTabIndex: null,
              simulationCounter: Math.max(s.simulationCounter, savedConfigs.length + 1),
              restoreNonce: s.restoreNonce + 1,
            }),
            false,
            'acousticsSim/restore',
          ),
      }),
      { name: 'acousticsSimulationStore' },
    ),
    { partialize: acousticsSimulationPartialize, equality: acousticsSimulationEquality, limit: UNDO_HISTORY_LIMIT },
  ),
);
