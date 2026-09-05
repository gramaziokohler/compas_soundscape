/**
 * Pyroom Acoustics Store
 *
 * Replaces usePyroomAcousticsSimulation. Manages per-instance simulation state
 * keyed by simulationInstanceId, plus a shared materials cache.
 *
 * The previous hook used module-level Maps for persistence across tab changes.
 * This Zustand store provides the same without module-level hacks and adds
 * undo/redo on faceMaterialAssignments + simulationSettings per instance.
 */

import { create } from 'zustand';
import { temporal } from 'zundo';
import { devtools } from 'zustand/middleware';
import { apiService } from '@/services/api';
import {
  importPyroomIRFiles,
  buildSimulationResultsText,
  type IRImportResult,
} from '@/utils/acousticMetrics';
import {
  PYROOMACOUSTICS_DEFAULT_MAX_ORDER,
  PYROOMACOUSTICS_DEFAULT_RAY_TRACING,
  PYROOMACOUSTICS_DEFAULT_AIR_ABSORPTION,
  PYROOMACOUSTICS_RAY_TRACING_N_RAYS,
  PYROOMACOUSTICS_DEFAULT_SIMULATION_MODE,
  PYROOMACOUSTICS_DEFAULT_ENABLE_GRID,
} from '@/utils/constants';
import { groupSoundsByPosition, collapseVariantsToOne } from '@/utils/positionKey';
import { notifyError } from './errorsStore';
import { resolveSimulationLayerName, resolveSimulationGeometryObjectIds } from './acousticLayerStore';
import { useUIStore } from './uiStore';
import { useAudioControlsStore } from './audioControlsStore';
import type { SourceReceiverIRMapping } from '@/types/audio';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PyroomMaterial {
  id: string;
  name: string;
  description?: string;
  category?: string;
  absorption: number;
}

export interface PyroomSimulationSettings {
  max_order: number;
  ray_tracing: boolean;
  air_absorption: boolean;
  n_rays: number;
  simulation_mode: string;
  enable_grid: boolean;
}

export interface PyroomInstanceState {
  materials: PyroomMaterial[];
  faceMaterialAssignments: Record<number, string>;
  simulationSettings: PyroomSimulationSettings;
  isRunning: boolean;
  progress: number;
  status: string;
  error: string | null;
  simulationResults: string | null;
  currentSimulationId: string | null;
  irImported: boolean;
  importedIRIds?: string[];
  sourceReceiverIRMapping?: SourceReceiverIRMapping;
  queuePosition?: number | null;
  queueTotal?: number | null;
  _pollInterval?: ReturnType<typeof setInterval> | null;
}

export interface SpeckleData {
  model_id: string;
  version_id: string;
  object_id: string;
  url: string;
  auth_token?: string;
}

// ─── Partialize ───────────────────────────────────────────────────────────────

export const pyroomAcousticsPartialize = (state: PyroomAcousticsStoreState) => ({
  instances: { ...state.instances },
});

// ─── Default state factory ────────────────────────────────────────────────────

function createDefaultInstanceState(sharedMaterials: PyroomMaterial[]): PyroomInstanceState {
  return {
    materials: sharedMaterials,
    faceMaterialAssignments: {},
    simulationSettings: {
      max_order: PYROOMACOUSTICS_DEFAULT_MAX_ORDER,
      ray_tracing: PYROOMACOUSTICS_DEFAULT_RAY_TRACING,
      air_absorption: PYROOMACOUSTICS_DEFAULT_AIR_ABSORPTION,
      n_rays: PYROOMACOUSTICS_RAY_TRACING_N_RAYS,
      simulation_mode: PYROOMACOUSTICS_DEFAULT_SIMULATION_MODE,
      enable_grid: PYROOMACOUSTICS_DEFAULT_ENABLE_GRID,
    },
    isRunning: false,
    progress: 0,
    status: 'Idle',
    error: null,
    simulationResults: null,
    currentSimulationId: null,
    irImported: false,
    _pollInterval: null,
  };
}

// ─── State interface ──────────────────────────────────────────────────────────

export interface PyroomAcousticsStoreState {
  /** Per-instance state, keyed by simulationInstanceId. */
  instances: Record<string, PyroomInstanceState>;
  /** Shared materials cache (same for all instances). */
  sharedMaterials: PyroomMaterial[];

  /** Ensure an instance slot exists (creates with defaults if absent). */
  ensureInstance: (instanceId: string) => void;

  /** Remove an instance when a simulation card is deleted. */
  removeInstance: (instanceId: string) => void;

  /** Seed instance state from a saved soundscape restore. */
  seedInstance: (instanceId: string, partial: Partial<PyroomInstanceState>) => void;

  // Per-instance actions (instanceId is the first argument)
  loadMaterials: (instanceId: string) => Promise<void>;
  assignMaterialToFace: (instanceId: string, faceIndex: number, materialId: string) => void;
  clearFaceMaterialAssignments: (instanceId: string) => void;
  updateSimulationSettings: (instanceId: string, settings: Partial<PyroomSimulationSettings>) => void;
  runSpeckleSimulation: (
    instanceId: string,
    speckleData: SpeckleData,
    simulationName: string,
    receivers: any[],
    soundscapeData: any[],
    materialAssignments: Record<string, string>,
    layerName?: string | null,
    onIRImported?: () => void,
  ) => Promise<void>;

  cancelSimulation: (instanceId: string) => void;

  /** Update arbitrary fields on an instance (used by components for status etc.) */
  patchInstance: (instanceId: string, patch: Partial<PyroomInstanceState>) => void;
}

// ─── Store ────────────────────────────────────────────────────────────────────

function patchInstance(
  set: (
    partial: Partial<PyroomAcousticsStoreState> | ((s: PyroomAcousticsStoreState) => Partial<PyroomAcousticsStoreState>),
    replace?: false,
    action?: string,
  ) => void,
  instanceId: string,
  patch: Partial<PyroomInstanceState>,
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

export const usePyroomAcousticsStore = create<PyroomAcousticsStoreState>()(
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
            'pyroom/ensureInstance',
          );
        },

        removeInstance: (instanceId) =>
          set(
            (s) => {
              const { [instanceId]: _removed, ...rest } = s.instances;
              return { instances: rest };
            },
            false,
            'pyroom/removeInstance',
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
            'pyroom/seedInstance',
          ),

        loadMaterials: async (instanceId) => {
          try {
            const materials = await apiService.getPyroomacousticsMaterials();
            set(
              (s) => {
                const updatedInstances: Record<string, PyroomInstanceState> = {};
                for (const [id, inst] of Object.entries(s.instances)) {
                  updatedInstances[id] = { ...inst, materials };
                }
                return { sharedMaterials: materials, instances: updatedInstances };
              },
              false,
              'pyroom/loadMaterials',
            );
          } catch (error) {
            patchInstance(
              set,
              instanceId,
              { error: error instanceof Error ? error.message : 'Failed to load materials' },
              'pyroom/loadMaterialsError',
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
            'pyroom/assignMaterialToFace',
          ),

        clearFaceMaterialAssignments: (instanceId) =>
          patchInstance(set, instanceId, { faceMaterialAssignments: {} }, 'pyroom/clearFaceMaterialAssignments'),

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
            'pyroom/updateSimulationSettings',
          ),

        patchInstance: (instanceId, patch) =>
          patchInstance(set, instanceId, patch, 'pyroom/patchInstance'),

        runSpeckleSimulation: async (
          instanceId,
          speckleData,
          simulationName,
          receivers,
          soundscapeData,
          materialAssignments,
          layerName,
          onIRImported,
        ) => {
          const { instances } = get();
          const inst = instances[instanceId];
          if (!inst) return;

          // Tear down any previous poll loop for this instance so a re-run can't
          // race the old simulation's completion patches against the new state.
          if (inst._pollInterval) {
            clearInterval(inst._pollInterval);
          }

          if (Object.keys(materialAssignments).length === 0) {
            patchInstance(set, instanceId, { error: 'Assign materials first' }, 'pyroom/noMaterials');
            return;
          }

          // Group sounds by position to deduplicate source-receiver pairs.
          // Variants of one source (same prompt_index) collapse to a single simulated source
          // so multi-copy sounds are not simulated as N separate sources.
          const sourceSounds = collapseVariantsToOne(
            soundscapeData as Array<{ prompt_index?: number; copy_index?: number }>,
            useAudioControlsStore.getState().selectedVariants,
          );
          const { uniquePositions: uniqueSourcePositions, soundToPosKey: sourceSoundToPosKey } =
            groupSoundsByPosition(sourceSounds as Array<{ id: string; position: [number, number, number] }>);

          // Build source-receiver pairs: unique source positions × receivers
          const sourceReceiverPairs: any[] = [];
          for (const [posKey, pos] of uniqueSourcePositions) {
            for (const receiver of receivers) {
              if (!receiver.position || receiver.position.length !== 3) {
                patchInstance(
                  set,
                  instanceId,
                  { error: `Receiver "${receiver.name || receiver.id}" has invalid position.` },
                  'pyroom/invalidReceiverPosition',
                );
                return;
              }
              sourceReceiverPairs.push({
                source_position: pos,
                receiver_position: receiver.position,
                source_id: posKey,
                receiver_id: receiver.id,
              });
            }
          }
          if (sourceReceiverPairs.length === 0) {
            patchInstance(
              set,
              instanceId,
              { error: 'No source-receiver pairs could be created' },
              'pyroom/noPairs',
            );
            return;
          }

          patchInstance(
            set,
            instanceId,
            {
              isRunning: true,
              progress: 0,
              status: 'Submitting...',
              error: null,
              simulationResults: null,
              currentSimulationId: null,
              irImported: false,
              importedIRIds: undefined,
              queuePosition: null,
              queueTotal: null,
              _pollInterval: null,
            },
            'pyroom/runStart',
          );

          try {
            const objectMaterials: Record<string, string> = {};
            for (const [objectId, materialId] of Object.entries(materialAssignments)) {
              objectMaterials[objectId] = materialId.replace(/^pyroom_/, '');
            }

            const urlMatch = speckleData.url.match(/\/projects\/([^\/]+)\/models\/([^\/\?#]+)/);
            if (!urlMatch) throw new Error('Invalid Speckle URL');
            const projectId = urlMatch[1];
            const modelId = urlMatch[2];

            // 1. Submit → returns simulation_id immediately
            const { simulation_id } = await apiService.runPyroomacousticsSimulationSpeckle(
              projectId,
              modelId,
              objectMaterials,
              resolveSimulationLayerName(layerName),
              simulationName,
              {
                ...inst.simulationSettings,
                sound_speed: useUIStore.getState().globalSoundSpeed,
              },
              sourceReceiverPairs,
              resolveSimulationGeometryObjectIds(),
            );

            patchInstance(set, instanceId, { currentSimulationId: simulation_id, status: 'Queued...' }, 'pyroom/queued');

            // Build display name lookups from position keys
            const sourceDisplayNames: Record<string, string> = {};
            const posKeyToNames = new Map<string, string[]>();
            for (const [pk] of uniqueSourcePositions) {
              posKeyToNames.set(pk, []);
            }
            for (const sound of soundscapeData as any[]) {
              const pk = sourceSoundToPosKey.get(sound.id || sound.name);
              if (pk && posKeyToNames.has(pk)) {
                posKeyToNames.get(pk)!.push(sound.display_name || sound.id || sound.name);
              }
            }
            for (const [pk, names] of posKeyToNames) {
              sourceDisplayNames[pk] = names.join(', ');
            }
            const receiverDisplayNames: Record<string, string> = {};
            for (const receiver of receivers) {
              if (receiver.id) receiverDisplayNames[receiver.id] = receiver.name || receiver.id;
            }

            // 2. Poll for progress
            const interval = setInterval(async () => {
              try {
                const statusData = await apiService.getPyroomacousticsSimulationStatus(simulation_id);

                patchInstance(
                  set,
                  instanceId,
                  {
                    progress: statusData.progress,
                    status: statusData.status,
                    queuePosition: statusData.queue_position ?? null,
                    queueTotal: statusData.queue_total ?? null,
                  },
                  'pyroom/pollUpdate',
                );

                if (statusData.cancelled) {
                  clearInterval(interval);
                  patchInstance(
                    set,
                    instanceId,
                    { isRunning: false, status: 'Cancelled', _pollInterval: null },
                    'pyroom/cancelled',
                  );
                  return;
                }

                if (statusData.error) {
                  clearInterval(interval);
                  patchInstance(
                    set,
                    instanceId,
                    { isRunning: false, status: 'Error', error: statusData.error, _pollInterval: null },
                    'pyroom/pollError',
                  );
                  return;
                }

                if (statusData.completed && statusData.result) {
                  clearInterval(interval);
                  const result = statusData.result;

                  let irImportResult: IRImportResult = {
                    importedCount: 0,
                    totalCount: 0,
                    importedIRIds: [],
                    importedIRMetadataList: [],
                    sourceReceiverMapping: {},
                  };

                  if (result.ir_files && result.ir_files.length > 0) {
                    irImportResult = await importPyroomIRFiles(
                      result.simulation_id,
                      result.ir_files,
                      undefined,
                      sourceDisplayNames,
                      receiverDisplayNames,
                    );
                    if (irImportResult.importedCount > 0 && onIRImported) {
                      onIRImported();
                    }
                  }

                  const resultsText = await buildSimulationResultsText(result.simulation_id);

                  patchInstance(
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
                      _pollInterval: null,
                    },
                    'pyroom/runComplete',
                  );

                  const irWord = irImportResult.importedCount === 1 ? 'response' : 'responses';
                  notifyError(
                    `Simulation completed! ${irImportResult.importedCount} impulse ${irWord} imported to library.`,
                    'info',
                  );
                }
              } catch (pollErr) {
                clearInterval(interval);
                patchInstance(
                  set,
                  instanceId,
                  {
                    isRunning: false,
                    status: 'Error',
                    error: pollErr instanceof Error ? pollErr.message : 'Status polling failed',
                    _pollInterval: null,
                  },
                  'pyroom/pollFetchError',
                );
              }
            }, 1500);

            patchInstance(set, instanceId, { _pollInterval: interval }, 'pyroom/pollStarted');
          } catch (error) {
            patchInstance(
              set,
              instanceId,
              {
                isRunning: false,
                status: 'Error',
                error: error instanceof Error ? error.message : 'Simulation failed',
              },
              'pyroom/runError',
            );
          }
        },

        cancelSimulation: (instanceId) => {
          const instance = get().instances[instanceId];
          if (instance?._pollInterval) clearInterval(instance._pollInterval);
          if (instance?.currentSimulationId) {
            apiService.cancelPyroomacousticsSimulation(instance.currentSimulationId).catch(console.warn);
          }
          patchInstance(
            set,
            instanceId,
            {
              isRunning: false,
              status: 'Cancelled',
              _pollInterval: null,
              queuePosition: null,
              queueTotal: null,
            },
            'pyroom/cancel',
          );
        },
      }),
      { name: 'pyroomAcousticsStore' },
    ),
    { partialize: pyroomAcousticsPartialize },
  ),
);
