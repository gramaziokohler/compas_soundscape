/**
 * Acoustics Simulation Store
 *
 * Replaces useAcousticsSimulation. Manages the list of acoustic simulation
 * configurations (Resonance / Choras / Pyroomacoustics), active/expanded
 * tab indices, and a counter for unique naming.
 *
 * Previously used a module-level singleton to survive tab switches — this
 * Zustand store accomplishes the same without module-level hacks.
 *
 * zundo partializes on simulationConfigs + activeSimulationIndex so that
 * adding/removing/updating configs is undoable.
 */

import { create } from 'zustand';
import { temporal } from 'zundo';
import { devtools } from 'zustand/middleware';
import type {
  AcousticSimulationMode,
  SimulationConfig,
  ResonanceSimulationConfig,
  ChorasSimulationConfig,
  PyroomAcousticsSimulationConfig,
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
  CHORAS_DEFAULT_METHOD,
  CHORAS_DE_DEFAULT_C0,
  CHORAS_DE_DEFAULT_LC,
  CHORAS_DG_DEFAULT_FREQ_UPPER,
  CHORAS_DG_DEFAULT_C0,
  CHORAS_DG_DEFAULT_RHO0,
  CHORAS_DG_DEFAULT_POLY_ORDER,
  CHORAS_DG_DEFAULT_PPW,
  CHORAS_DG_DEFAULT_CFL,
} from '@/utils/constants';

// ─── Partialize ───────────────────────────────────────────────────────────────

export const acousticsSimulationPartialize = (state: AcousticsSimulationStoreState) => ({
  simulationConfigs: state.simulationConfigs.map((c) => ({
    ...c,
    // Never restore a "running" state or in-flight simulation ID after undo
    isRunning: false,
    progress: 0,
    currentSimulationRunId: null,
  })),
  activeSimulationIndex: state.activeSimulationIndex,
  roomScale: state.roomScale,
});

// ─── State ────────────────────────────────────────────────────────────────────

export interface AcousticsSimulationStoreState {
  simulationConfigs: SimulationConfig[];
  activeSimulationIndex: number | null;
  expandedTabIndex: number | null;
  simulationCounter: number;
  roomScale: { x: number; y: number; z: number };

  handleAddConfig: (mode: AcousticSimulationMode) => void;
  handleRemoveConfig: (index: number) => void;
  handleReorderConfigs: (from: number, to: number) => void;
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

            case 'choras':
              newConfig = {
                id,
                display_name: name,
                type: 'choras',
                state: 'before-simulation',
                createdAt: timestamp,
                simulationInstanceId: `choras_${timestamp}`,
                settings: {
                  simulation_method: CHORAS_DEFAULT_METHOD as 'DE' | 'DG',
                  de_c0: CHORAS_DE_DEFAULT_C0,
                  de_lc: CHORAS_DE_DEFAULT_LC,
                  dg_freq_upper_limit: CHORAS_DG_DEFAULT_FREQ_UPPER,
                  dg_c0: CHORAS_DG_DEFAULT_C0,
                  dg_rho0: CHORAS_DG_DEFAULT_RHO0,
                  dg_poly_order: CHORAS_DG_DEFAULT_POLY_ORDER,
                  dg_ppw: CHORAS_DG_DEFAULT_PPW,
                  dg_cfl: CHORAS_DG_DEFAULT_CFL,
                },
                faceToMaterialMap: new Map(),
                isRunning: false,
                progress: 0,
                status: 'Idle',
                error: null,
                simulationResults: null,
              } as ChorasSimulationConfig;
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

            case 'import-irs':
              newConfig = {
                id,
                display_name: name,
                type: 'import-irs',
                state: 'completed',
                createdAt: timestamp,
                completedAt: timestamp,
                simulationResults: null,
                importedIRIds: undefined,
                sourceReceiverIRMapping: undefined,
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

        restoreSimulationState: (savedConfigs, savedActiveIndex) =>
          set(
            (s) => ({
              simulationConfigs: savedConfigs,
              activeSimulationIndex: savedActiveIndex,
              expandedTabIndex: savedActiveIndex,
              simulationCounter: Math.max(s.simulationCounter, savedConfigs.length + 1),
            }),
            false,
            'acousticsSim/restore',
          ),
      }),
      { name: 'acousticsSimulationStore' },
    ),
    { partialize: acousticsSimulationPartialize },
  ),
);
