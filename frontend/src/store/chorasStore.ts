/**
 * Choras Store
 *
 * Manages per-instance simulation state for Choras (DE/DG) simulations.
 * Structure mirrors pyroomAcousticsStore.ts exactly.
 *
 * State is keyed by simulationInstanceId so multiple Choras cards can
 * co-exist without sharing state.
 */

import { create } from 'zustand';
import { temporal } from 'zundo';
import { devtools } from 'zustand/middleware';
import { apiService } from '@/services/api';
import {
  importChorasIRFiles,
  buildChorasSimulationResultsText,
  type IRImportResult,
} from '@/utils/acousticMetrics';
import {
  CHORAS_DEFAULT_METHOD,
  CHORAS_DE_DEFAULT_SIM_LEN_TYPE,
  CHORAS_DE_DEFAULT_EDT,
  CHORAS_DE_DEFAULT_IR_LENGTH,
  CHORAS_DE_DEFAULT_C0,
  CHORAS_DE_DEFAULT_LC,
  CHORAS_DG_DEFAULT_FREQ_UPPER,
  CHORAS_DG_DEFAULT_C0,
  CHORAS_DG_DEFAULT_RHO0,
  CHORAS_DG_DEFAULT_IR_LENGTH,
  CHORAS_DG_DEFAULT_POLY_ORDER,
  CHORAS_DG_DEFAULT_PPW,
  CHORAS_DG_DEFAULT_CFL,
} from '@/utils/constants';
import { useErrorsStore } from './errorsStore';
import type { SourceReceiverIRMapping } from '@/types/audio';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ChorasMaterial {
  id: string;
  name: string;
  description?: string;
  coeffs: number[];
  center_freqs: number[];
  /** Average absorption across frequency bands (for display / color mapping) */
  absorption: number;
}

export interface ChorasSimulationSettings {
  simulation_method: 'DE' | 'DG';
  // DE settings
  de_sim_len_type: 'ir_length' | 'edt';
  de_edt: number;
  de_ir_length: number;
  de_c0: number;
  de_lc: number;
  // DG settings
  dg_freq_upper_limit: number;
  dg_c0: number;
  dg_rho0: number;
  dg_ir_length: number;
  dg_poly_order: number;
  dg_ppw: number;
  dg_cfl: number;
}

export interface ChorasInstanceState {
  materials: ChorasMaterial[];
  faceMaterialAssignments: Record<number, string>;
  simulationSettings: ChorasSimulationSettings;
  isRunning: boolean;
  progress: number;
  status: string;
  error: string | null;
  simulationResults: string | null;
  currentSimulationId: string | null;
  irImported: boolean;
  importedIRIds?: string[];
  sourceReceiverIRMapping?: SourceReceiverIRMapping;
}

export interface SpeckleData {
  model_id: string;
  version_id: string;
  object_id: string;
  url: string;
  auth_token?: string;
}

// ─── Partialize ───────────────────────────────────────────────────────────────

export const chorasPartialize = (state: ChorasStoreState) => ({
  instances: Object.fromEntries(
    Object.entries(state.instances).map(([id, inst]) => [
      id,
      {
        ...inst,
        // Exclude transient execution state from undo/redo history
        isRunning: false,
        progress: 0,
        status: inst.status === 'Running simulation...' ? 'Idle' : inst.status,
        error: null,
      },
    ])
  ),
});

// ─── Default state factory ────────────────────────────────────────────────────

function createDefaultInstanceState(sharedMaterials: ChorasMaterial[]): ChorasInstanceState {
  return {
    materials: sharedMaterials,
    faceMaterialAssignments: {},
    simulationSettings: {
      simulation_method: CHORAS_DEFAULT_METHOD as 'DE' | 'DG',
      de_sim_len_type: CHORAS_DE_DEFAULT_SIM_LEN_TYPE as 'ir_length' | 'edt',
      de_edt: CHORAS_DE_DEFAULT_EDT,
      de_ir_length: CHORAS_DE_DEFAULT_IR_LENGTH,
      de_c0: CHORAS_DE_DEFAULT_C0,
      de_lc: CHORAS_DE_DEFAULT_LC,
      dg_freq_upper_limit: CHORAS_DG_DEFAULT_FREQ_UPPER,
      dg_c0: CHORAS_DG_DEFAULT_C0,
      dg_rho0: CHORAS_DG_DEFAULT_RHO0,
      dg_ir_length: CHORAS_DG_DEFAULT_IR_LENGTH,
      dg_poly_order: CHORAS_DG_DEFAULT_POLY_ORDER,
      dg_ppw: CHORAS_DG_DEFAULT_PPW,
      dg_cfl: CHORAS_DG_DEFAULT_CFL,
    },
    isRunning: false,
    progress: 0,
    status: 'Idle',
    error: null,
    simulationResults: null,
    currentSimulationId: null,
    irImported: false,
  };
}

// ─── State interface ──────────────────────────────────────────────────────────

export interface ChorasStoreState {
  instances: Record<string, ChorasInstanceState>;
  sharedMaterials: ChorasMaterial[];

  ensureInstance:  (instanceId: string) => void;
  removeInstance:  (instanceId: string) => void;
  seedInstance:    (instanceId: string, partial: Partial<ChorasInstanceState>) => void;

  loadMaterials:             (instanceId: string) => Promise<void>;
  assignMaterialToFace:      (instanceId: string, faceIndex: number, materialId: string) => void;
  clearFaceMaterialAssignments: (instanceId: string) => void;
  updateSimulationSettings:  (instanceId: string, settings: Partial<ChorasSimulationSettings>) => void;
  patchInstance:             (instanceId: string, patch: Partial<ChorasInstanceState>) => void;

  runSpeckleSimulation: (
    instanceId: string,
    speckleData: SpeckleData,
    simulationName: string,
    receivers: any[],
    soundscapeData: any[],
    materialAssignments: Record<string, string>,
    layerName?: string | null,
    geometryObjectIds?: string[],
    onIRImported?: () => void,
  ) => Promise<void>;
}

// ─── Internal helper ──────────────────────────────────────────────────────────

function _patch(
  set: (
    partial: Partial<ChorasStoreState> | ((s: ChorasStoreState) => Partial<ChorasStoreState>),
    replace?: boolean,
    action?: string,
  ) => void,
  instanceId: string,
  patch: Partial<ChorasInstanceState>,
  actionName: string,
) {
  set(
    (s) => ({
      instances: {
        ...s.instances,
        [instanceId]: { ...s.instances[instanceId], ...patch },
      },
    }),
    false,
    actionName,
  );
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useChorasStore = create<ChorasStoreState>()(
  temporal(
    devtools(
      (set, get) => ({
        instances: {},
        sharedMaterials: [],

        ensureInstance: (instanceId) => {
          if (get().instances[instanceId]) return;
          set(
            (s) => ({
              instances: {
                ...s.instances,
                [instanceId]: createDefaultInstanceState(s.sharedMaterials),
              },
            }),
            false,
            'choras/ensureInstance',
          );
        },

        removeInstance: (instanceId) =>
          set(
            (s) => {
              const { [instanceId]: _removed, ...rest } = s.instances;
              return { instances: rest };
            },
            false,
            'choras/removeInstance',
          ),

        seedInstance: (instanceId, partial) =>
          set(
            (s) => ({
              instances: {
                ...s.instances,
                [instanceId]: {
                  ...(s.instances[instanceId] ?? createDefaultInstanceState(s.sharedMaterials)),
                  ...partial,
                },
              },
            }),
            false,
            'choras/seedInstance',
          ),

        loadMaterials: async (instanceId) => {
          try {
            const rawMaterials = await apiService.getChorasMaterials();
            const materials: ChorasMaterial[] = rawMaterials.map((m) => ({
              id: m.id,
              name: m.name,
              description: m.description,
              coeffs: m.coeffs,
              center_freqs: m.center_freqs,
              absorption: m.absorption,
            }));
            set(
              (s) => {
                const updatedInstances: Record<string, ChorasInstanceState> = {};
                for (const [id, inst] of Object.entries(s.instances)) {
                  updatedInstances[id] = { ...inst, materials };
                }
                return { sharedMaterials: materials, instances: updatedInstances };
              },
              false,
              'choras/loadMaterials',
            );
          } catch (error) {
            _patch(
              set,
              instanceId,
              { error: error instanceof Error ? error.message : 'Failed to load materials' },
              'choras/loadMaterialsError',
            );
          }
        },

        assignMaterialToFace: (instanceId, faceIndex, materialId) =>
          set(
            (s) => {
              const inst = s.instances[instanceId];
              if (!inst) return s;
              return {
                instances: {
                  ...s.instances,
                  [instanceId]: {
                    ...inst,
                    faceMaterialAssignments: { ...inst.faceMaterialAssignments, [faceIndex]: materialId },
                  },
                },
              };
            },
            false,
            'choras/assignMaterialToFace',
          ),

        clearFaceMaterialAssignments: (instanceId) =>
          _patch(set, instanceId, { faceMaterialAssignments: {} }, 'choras/clearFaceMaterialAssignments'),

        updateSimulationSettings: (instanceId, settings) =>
          set(
            (s) => {
              const inst = s.instances[instanceId];
              if (!inst) return s;
              return {
                instances: {
                  ...s.instances,
                  [instanceId]: {
                    ...inst,
                    simulationSettings: { ...inst.simulationSettings, ...settings },
                  },
                },
              };
            },
            false,
            'choras/updateSimulationSettings',
          ),

        patchInstance: (instanceId, patch) =>
          _patch(set, instanceId, patch, 'choras/patchInstance'),

        runSpeckleSimulation: async (
          instanceId,
          speckleData,
          simulationName,
          receivers,
          soundscapeData,
          materialAssignments,
          layerName,
          geometryObjectIds,
          onIRImported,
        ) => {
          const { instances } = get();
          const inst = instances[instanceId];
          if (!inst) return;

          if (Object.keys(materialAssignments).length === 0) {
            _patch(set, instanceId, { error: 'Assign materials first' }, 'choras/noMaterials');
            return;
          }

          // Build source-receiver pairs
          const sourceReceiverPairs: any[] = [];
          for (const sound of soundscapeData) {
            if (!sound.position || sound.position.length !== 3) {
              _patch(
                set,
                instanceId,
                { error: `Sound "${sound.display_name || sound.id}" has invalid position.` },
                'choras/invalidPosition',
              );
              return;
            }
            for (const receiver of receivers) {
              if (!receiver.position || receiver.position.length !== 3) {
                _patch(
                  set,
                  instanceId,
                  { error: `Receiver "${receiver.name || receiver.id}" has invalid position.` },
                  'choras/invalidReceiverPosition',
                );
                return;
              }
              sourceReceiverPairs.push({
                source_position: sound.position,
                receiver_position: receiver.position,
                source_id: sound.id || sound.name,
                receiver_id: receiver.id,
              });
            }
          }

          if (sourceReceiverPairs.length === 0) {
            _patch(
              set,
              instanceId,
              { error: 'No source-receiver pairs could be created' },
              'choras/noPairs',
            );
            return;
          }

          _patch(
            set,
            instanceId,
            {
              isRunning: true,
              progress: 0,
              status: 'Running simulation...',
              error: null,
              simulationResults: null,
              currentSimulationId: null,
              irImported: false,
              importedIRIds: undefined,
            },
            'choras/runStart',
          );

          try {
            // Strip any frontend prefix from material IDs before sending to backend
            const objectMaterials: Record<string, string> = {};
            for (const [objectId, materialId] of Object.entries(materialAssignments)) {
              objectMaterials[objectId] = materialId;
            }

            // Extract project + model IDs from Speckle URL
            const urlMatch = speckleData.url.match(/\/projects\/([^\/]+)\/models\/([^\/\?#]+)/);
            if (!urlMatch) throw new Error('Invalid Speckle URL');
            const projectId = urlMatch[1];
            const modelId   = urlMatch[2];

            const { simulationSettings } = inst;

            // Start the simulation (non-blocking — returns simulation_id immediately)
            const { simulation_id } = await apiService.runChorasSimulationSpeckle(
              projectId,
              modelId,
              objectMaterials,
              layerName || '',
              simulationName,
              {
                simulation_method:    simulationSettings.simulation_method,
                de_sim_len_type:      simulationSettings.de_sim_len_type,
                de_edt:               simulationSettings.de_edt,
                de_ir_length:         simulationSettings.de_ir_length,
                de_c0:                simulationSettings.de_c0,
                de_lc:                simulationSettings.de_lc,
                dg_freq_upper_limit:  simulationSettings.dg_freq_upper_limit,
                dg_c0:                simulationSettings.dg_c0,
                dg_rho0:              simulationSettings.dg_rho0,
                dg_ir_length:         simulationSettings.dg_ir_length,
                dg_poly_order:        simulationSettings.dg_poly_order,
                dg_ppw:               simulationSettings.dg_ppw,
                dg_cfl:               simulationSettings.dg_cfl,
              },
              sourceReceiverPairs,
              geometryObjectIds,
            );

            // Poll until completion
            await new Promise<void>((resolve, reject) => {
              const pollInterval = setInterval(async () => {
                try {
                  const statusData = await apiService.getChorasSimulationStatus(simulation_id);
                  _patch(set, instanceId, { progress: statusData.progress, status: statusData.status }, 'choras/runProgress');

                  if (!statusData.completed) return;
                  clearInterval(pollInterval);

                  if (statusData.cancelled) {
                    _patch(set, instanceId, { isRunning: false, progress: 0, status: 'Cancelled' }, 'choras/runCancelled');
                    resolve();
                    return;
                  }
                  if (statusData.error) { reject(new Error(statusData.error)); return; }

                  const result = statusData.result;
                  if (!result) { reject(new Error('No result returned')); return; }

                  // Import IRs to the audio library
                  let irImportResult: IRImportResult = {
                    importedCount: 0,
                    totalCount: 0,
                    importedIRIds: [],
                    importedIRMetadataList: [],
                    sourceReceiverMapping: {},
                  };

                  if (result.ir_files && result.ir_files.length > 0) {
                    // Build display name lookup maps from the simulation's sound and receiver data
                    const sourceDisplayNames: Record<string, string> = {};
                    for (const sound of soundscapeData) {
                      const sid = (sound as any).id || (sound as any).name;
                      if (sid) sourceDisplayNames[sid] = (sound as any).display_name || sid;
                    }
                    const receiverDisplayNames: Record<string, string> = {};
                    for (const receiver of receivers) {
                      if (receiver.id) receiverDisplayNames[receiver.id] = receiver.name || receiver.id;
                    }
                    irImportResult = await importChorasIRFiles(result.simulation_id, result.ir_files, sourceDisplayNames, receiverDisplayNames);
                    if (irImportResult.importedCount > 0 && onIRImported) {
                      onIRImported();
                    }
                  }

                  const resultsText = await buildChorasSimulationResultsText(
                    result.simulation_id,
                    irImportResult,
                  );

                  _patch(
                    set,
                    instanceId,
                    {
                      isRunning: false,
                      progress: 100,
                      status: 'Complete!',
                      simulationResults: resultsText,
                      currentSimulationId: result.simulation_id,
                      irImported: irImportResult.importedCount > 0,
                      importedIRIds: irImportResult.importedIRIds,
                      sourceReceiverIRMapping: irImportResult.sourceReceiverMapping,
                    },
                    'choras/runComplete',
                  );

                  const irWord = irImportResult.importedCount === 1 ? 'response' : 'responses';
                  useErrorsStore.getState().addError(
                    `Simulation completed! ${irImportResult.importedCount} impulse ${irWord} imported to library.`,
                    'info',
                  );
                  resolve();
                } catch (pollErr) {
                  clearInterval(pollInterval);
                  reject(pollErr);
                }
              }, 1000);
            });
          } catch (error) {
            _patch(
              set,
              instanceId,
              {
                isRunning: false,
                status: 'Error',
                error: error instanceof Error ? error.message : 'Simulation failed',
              },
              'choras/runError',
            );
          }
        },
      }),
      { name: 'chorasStore' },
    ),
    { partialize: chorasPartialize },
  ),
);
