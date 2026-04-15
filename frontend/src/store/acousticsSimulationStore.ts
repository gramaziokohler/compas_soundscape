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
} from '@/types/acoustics';
import { CARD_TYPE_LABELS } from '@/types/card';
import {
  CHORAS_DEFAULT_C0,
  CHORAS_DEFAULT_IR_LENGTH,
  CHORAS_DEFAULT_LC,
  CHORAS_DEFAULT_EDT,
  CHORAS_DEFAULT_SIM_LEN_TYPE,
  PYROOMACOUSTICS_DEFAULT_MAX_ORDER,
  PYROOMACOUSTICS_DEFAULT_RAY_TRACING,
  PYROOMACOUSTICS_DEFAULT_AIR_ABSORPTION,
  PYROOMACOUSTICS_RAY_TRACING_N_RAYS,
  PYROOMACOUSTICS_DEFAULT_SIMULATION_MODE,
  PYROOMACOUSTICS_DEFAULT_ENABLE_GRID,
} from '@/utils/constants';

// ─── Partialize ───────────────────────────────────────────────────────────────

export const acousticsSimulationPartialize = (state: AcousticsSimulationStoreState) => ({
  simulationConfigs: state.simulationConfigs.map((c) => ({
    ...c,
    // Never restore a "running" state after undo
    isRunning: false,
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
                  de_c0: CHORAS_DEFAULT_C0,
                  de_ir_length: CHORAS_DEFAULT_IR_LENGTH,
                  de_lc: CHORAS_DEFAULT_LC,
                  edt: CHORAS_DEFAULT_EDT,
                  sim_len_type: CHORAS_DEFAULT_SIM_LEN_TYPE as 'ir_length' | 'edt',
                  selectedMaterialId: null,
                },
                faceToMaterialMap: new Map(),
                isRunning: false,
                progress: 0,
                status: 'Idle',
                error: null,
                currentSimulationId: null,
                currentSimulationRunId: null,
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
