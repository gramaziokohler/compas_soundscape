/**
 * AcousticsSection Component
 *
 * Main container for acoustic simulations.
 * Consolidated architecture using CardSection and Card components.
 * Manages simulation configurations, material assignments, and execution.
 *
 * Simulation execution is delegated to individual hooks:
 * - runChorasSimulation for Choras (DE/DG) simulations
 * - usePyroomAcousticsSimulation for Pyroomacoustics simulations
 * 
 * ARCHITECTURE:
 *   AcousticsSection.tsx (orchestration layer)
  ├── useAcousticsMaterials() - loads Choras materials
  ├── useAcousticsMaterials() - loads Pyroom materials
  ├── SimulationSetupContent - renders material assignment + settings
  │   ├── SpeckleSurfaceMaterialsSection
  │   ├── ChorasSimulationSettings
  │   └── PyroomAcousticsSimulationSettings
  ├── ResonanceContent
  └── SimulationResultContent
 */

'use client';

import React, { useCallback, useEffect, useState, useRef, useMemo } from 'react';
import { Power } from 'lucide-react';
import { CardSection, type CardTypeOption } from '@/components/ui/CardSection';
import { Card } from '@/components/ui/Card';
import { apiService } from '@/services/api';
import { CARD_TYPE_LABELS } from '@/types/card';
import { useSpeckleStore, useAcousticsSimulationStore, useReceiversStore, useGridListenersStore, useAudioControlsStore, useSoundscapeStore } from '@/store';

// Content Components
import { ResonanceContent } from '@/components/layout/sidebar/acoustics/ResonanceContent';
import { SimulationResultContent, SimulationSettingsSection } from '@/components/layout/sidebar/acoustics/SimulationResultContent';
import { SimulationSetupContent } from '@/components/layout/sidebar/acoustics/SimulationSetupContent';

// Hooks
import { useAcousticsMaterials } from '@/hooks/useAcousticsMaterials';
// Utils
import {
  importPyroomIRFiles,
  buildSimulationResultsText,
  importChorasIRFiles,
  buildChorasSimulationResultsText
} from '@/utils/acousticMetrics';

// Types
import type {
  SimulationConfig,
  AcousticSimulationMode,
  ChorasSimulationConfig,
  PyroomAcousticsSimulationConfig,
} from '@/types/acoustics';
import type { CardType } from '@/types/card';
import type {
  CompasGeometry,
  EntityData,
  SoundEvent,
} from '@/types';
import type {
  ImpulseResponseMetadata,
  ResonanceAudioConfig,
  AuralizationConfig
} from '@/types/audio';
import type {
  SelectedGeometry,
  AcousticMaterial
} from '@/types/materials';
import type { AudioRenderingMode } from '@/components/audio/AudioRenderingModeSelector';
import type { RoomScale } from '@/components/layout/sidebar/acoustics/ResonanceAudioControls';

// Constants
import {
  MAX_FACES_FOR_LAYER_AUTO_EXCLUDE,
  UI_COLORS
} from '@/utils/constants';
import { useServiceVersions } from '@/hooks/useServiceVersions';

interface AcousticsSectionProps {
  // IR Library props
  onSelectIRFromLibrary: (irMetadata: ImpulseResponseMetadata) => Promise<void>;
  onClearIR: () => void;
  selectedIRId: string | null;
  auralizationConfig: AuralizationConfig;

  // Resonance Audio props
  resonanceAudioConfig: ResonanceAudioConfig;
  onToggleResonanceAudio: (enabled: boolean) => void;
  onUpdateRoomMaterials: (materials: any) => void;
  hasGeometry: boolean;
  showBoundingBox: boolean;
  onToggleBoundingBox: (show: boolean) => void;
  onRefreshBoundingBox?: () => void;
  roomScale?: RoomScale;
  onRoomScaleChange?: (scale: RoomScale) => void;

  // Audio Orchestrator props
  audioRenderingMode?: AudioRenderingMode;
  onAudioRenderingModeChange?: (mode: AudioRenderingMode) => void;

  // Material Assignment props
  modelEntities?: EntityData[];
  modelType?: '3dm' | 'obj' | 'ifc' | null;
  geometryData?: CompasGeometry | null;
  selectedGeometry?: SelectedGeometry | null;
  onSelectGeometry?: (selection: SelectedGeometry | null) => void;
  onHoverGeometry?: (selection: SelectedGeometry | null) => void;
  onAssignMaterial?: (selection: SelectedGeometry, material: AcousticMaterial | null) => void;

  // Simulation props
  modelFile?: File | null;
  speckleData?: { model_id: string; version_id: string; object_id: string; url: string; auth_token?: string } | null;
  soundscapeData?: SoundEvent[] | null;
  onIRImported?: () => void;
  irRefreshTrigger?: number;

  // Simulation state (passed from page/hook)
  simulationConfigs?: SimulationConfig[];
  activeSimulationIndex?: number | null;
  onAddSimulationConfig?: (mode: AcousticSimulationMode) => void;
  onRemoveSimulationConfig?: (index: number) => void;
  onUpdateSimulationConfig?: (index: number, updates: Partial<SimulationConfig>) => void;
  onSetActiveSimulation?: (index: number | null) => void;
  onUpdateSimulationName?: (index: number, name: string) => void;

  // IR hover line visualization
  onIRHover?: (sourceId: string | null, receiverId: string | null) => void;

  // World Tree (Special for Speckle)
  worldTree?: any;
}

export function AcousticsSection(props: AcousticsSectionProps) {
  const {
    onSelectIRFromLibrary,
    onClearIR,
    selectedIRId,
    auralizationConfig,
    resonanceAudioConfig,
    onToggleResonanceAudio,
    onUpdateRoomMaterials,
    hasGeometry,
    showBoundingBox,
    onToggleBoundingBox,
    onRefreshBoundingBox,
    roomScale,
    onRoomScaleChange,
    audioRenderingMode = 'anechoic',
    onAudioRenderingModeChange,
    modelEntities = [],
    geometryData,
    onAssignMaterial,
    modelFile,
    speckleData,
    soundscapeData,
    onIRImported,
    irRefreshTrigger = 0,
    simulationConfigs = [],
    activeSimulationIndex = null,
    onAddSimulationConfig,
    onRemoveSimulationConfig,
    onUpdateSimulationConfig,
    onSetActiveSimulation,
    worldTree: propWorldTree
  } = props;

  // ==========================================================================
  // Hooks & State
  // ==========================================================================

  const serviceVersions = useServiceVersions();

  const { getViewerRef, clearMaterialColors, filteringEnabled, viewMode, setViewMode, worldTreeVersion } = useSpeckleStore();
  const viewerRef = useMemo<{ current: any }>(() => ({ get current() { return getViewerRef(); } }), [getViewerRef]);

  // Read listeners/receivers from global store (no longer passed as props)
  const receivers = useReceiversStore((s) => s.receivers);
  const updateReceiverPosition = useReceiversStore((s) => s.updateReceiverPosition);
  const gridListeners = useGridListenersStore((s) => s.gridListeners);
  const updateSoundPosition = useSoundscapeStore((s) => s.updateSoundPosition);

  // Muted sounds from audio controls store
  const mutedSounds = useAudioControlsStore((s) => s.mutedSounds);

  // Combined receiver list: active (not hidden) point receivers + active grid listener points
  const allReceivers = useMemo<Array<{ id: string; position: [number, number, number] }>>(() => {
    const list: Array<{ id: string; position: [number, number, number] }> = receivers
      .filter((r) => !r.hiddenForSimulation)
      .map((r) => ({ id: r.id, position: r.position }));
    for (const g of gridListeners) {
      if (!g.hiddenForSimulation) {
        g.points.forEach((pt, i) => {
          list.push({ id: `${g.id}-${i}`, position: pt });
        });
      }
    }
    return list;
  }, [receivers, gridListeners]);

  // Active soundscape: exclude muted sounds from simulation
  const activeSoundscapeData = useMemo(
    () => (soundscapeData ?? []).filter((s) => !mutedSounds.has(s.id)),
    [soundscapeData, mutedSounds],
  );

  // Only fetch materials when a card of that type exists
  const hasChorasCard = simulationConfigs.some(c => c.type === 'choras');
  const hasPyroomCard = simulationConfigs.some(c => c.type === 'pyroomacoustics');

  const { materials: chorasMaterials } = useAcousticsMaterials({
    fetchMaterials: () => apiService.getChorasMaterials(),
    idPrefix: 'choras',
    enabled: hasChorasCard
  });

  const { materials: pyroomMaterials } = useAcousticsMaterials({
    fetchMaterials: () => apiService.getPyroomacousticsMaterials(),
    idPrefix: 'pyroom',
    enabled: hasPyroomCard
  });

  // Clear material colors when layer isolation is disabled (filteringEnabled comes from context,
  // controlled by the View Mode switch in SpeckleScene)
  useEffect(() => {
    if (!filteringEnabled) {
      clearMaterialColors();
    }
  }, [filteringEnabled, clearMaterialColors]);

  // World Tree state (for Speckle material assignment)
  const [localWorldTree, setLocalWorldTree] = useState(propWorldTree);

  // Load World Tree from Speckle viewer if not provided as prop.
  // worldTreeVersion is a reactive Zustand counter incremented by SpeckleScene
  // when the tree loads. Also poll briefly in case the version was already set
  // before this component mounted (e.g., soundscape restore after model load).
  useEffect(() => {
    if (propWorldTree) {
      setLocalWorldTree(propWorldTree);
      return;
    }
    const tryGetTree = (): boolean => {
      const viewer = getViewerRef();
      if (!viewer) return false;
      const tree = viewer.getWorldTree?.();
      const treeAny = tree as any;
      const children = treeAny?.tree?._root?.children ||
                      treeAny?._root?.children ||
                      treeAny?.root?.children ||
                      treeAny?.children;
      if (children && children.length > 0) {
        setLocalWorldTree(tree);
        return true;
      }
      return false;
    };
    // Try immediately
    if (tryGetTree()) return;
    // Fallback: poll briefly in case viewer is still initializing
    const interval = setInterval(() => {
      if (tryGetTree()) clearInterval(interval);
    }, 300);
    return () => clearInterval(interval);
  }, [propWorldTree, getViewerRef, worldTreeVersion]);

  // ==========================================================================
  // Handlers
  // ==========================================================================

  // Stable fallback function to prevent infinite re-renders
  const noopUpdateConfig = useCallback((_index: number, _updates: Partial<SimulationConfig>) => {}, []);
  const handleUpdateConfig = onUpdateSimulationConfig || noopUpdateConfig;

  // Add Config with Auto-Exclude Logic
  const handleAddItem = useCallback((type: CardType) => {
    if (!onAddSimulationConfig) return;

    const mode = type as AcousticSimulationMode;
    onAddSimulationConfig(mode);

    // Check for large layers to exclude
    if (geometryData && geometryData.face_entity_map && (mode === 'choras' || mode === 'pyroomacoustics')) {
      const layerFaceCounts = new Map<string, number>();

      geometryData.face_entity_map.forEach((entityIndex, faceIndex) => {
        const entity = modelEntities.find(e => e.index === entityIndex);
        const layerName = entity?.layer || 'Default';
        layerFaceCounts.set(layerName, (layerFaceCounts.get(layerName) || 0) + 1);
      });

      const layersToExclude = new Set<string>();
      layerFaceCounts.forEach((count, layerName) => {
        if (count > MAX_FACES_FOR_LAYER_AUTO_EXCLUDE) {
          layersToExclude.add(layerName);
        }
      });

      if (layersToExclude.size > 0 && onUpdateSimulationConfig) {
        const newIndex = simulationConfigs.length;
        setTimeout(() => {
          onUpdateSimulationConfig(newIndex, { excludedLayers: layersToExclude } as any);
        }, 0);
      }
    }
  }, [onAddSimulationConfig, geometryData, modelEntities, simulationConfigs.length, onUpdateSimulationConfig]);


  // ==========================================================================
  // Simulation Execution - Delegated to hooks (single source of truth)
  // ==========================================================================

  /**
   * Per-card polling interval refs — keyed by card index.
   * Cleared on cancel, completion, error, or component unmount.
   */
  const pollIntervalsRef = useRef<Map<number, ReturnType<typeof setInterval>>>(new Map());

  // Clear all active poll intervals when this component unmounts
  useEffect(() => {
    return () => {
      pollIntervalsRef.current.forEach(clearInterval);
      pollIntervalsRef.current.clear();
    };
  }, []);

  // Resume polling for any cards that were already running when the component mounts
  // (e.g. after a hot-reload or panel re-mount mid-simulation)
  useEffect(() => {
    simulationConfigs.forEach((config, index) => {
      if (
        (config as any).isRunning &&
        (config as any).currentSimulationRunId &&
        !pollIntervalsRef.current.has(index)
      ) {
        const simulationId = (config as any).currentSimulationRunId as string;
        const pollInterval = setInterval(async () => {
          try {
            const statusData = await apiService.getChorasSimulationStatus(simulationId);
            handleUpdateConfig(index, { progress: statusData.progress, status: statusData.status } as any);
            if (statusData.completed) {
              clearInterval(pollInterval);
              pollIntervalsRef.current.delete(index);
              if (statusData.cancelled) {
                handleUpdateConfig(index, { isRunning: false, progress: 0, status: 'Cancelled', currentSimulationRunId: null } as any);
              } else if (statusData.error) {
                handleUpdateConfig(index, { isRunning: false, status: 'Error', error: statusData.error, currentSimulationRunId: null } as any);
              } else {
                handleUpdateConfig(index, { isRunning: false, progress: 100, status: 'Complete!', currentSimulationRunId: null } as any);
              }
            }
          } catch {
            clearInterval(pollInterval);
            pollIntervalsRef.current.delete(index);
            handleUpdateConfig(index, { isRunning: false, status: 'Error', error: 'Status check failed', currentSimulationRunId: null } as any);
          }
        }, 1000);
        pollIntervalsRef.current.set(index, pollInterval);
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Run Choras simulation.
   * Starts the simulation (returns immediately with simulation_id),
   * then polls /choras/simulation-status every second and routes
   * progress updates to the Card progress bar.
   */
  const runChorasSimulation = useCallback(async (index: number) => {
    const config = simulationConfigs[index] as ChorasSimulationConfig;
    if (!config || config.type !== 'choras') return;

    if (!speckleData) {
      handleUpdateConfig(index, { error: 'No Speckle data' } as any);
      return;
    }

    const settings = config.settings;
    const speckleMaterialAssignments = (config as any).speckleMaterialAssignments || {};

    if (Object.keys(speckleMaterialAssignments).length === 0) {
      handleUpdateConfig(index, { error: 'Assign materials first' } as any);
      return;
    }

    handleUpdateConfig(index, { isRunning: true, progress: 0, status: 'Initializing...', error: null } as any);

    const receiversList = allReceivers;
    const soundscape = activeSoundscapeData;

    try {
      // Build source-receiver pairs
      const sourceReceiverPairs: Array<{
        source_position: number[];
        receiver_position: number[];
        source_id: string;
        receiver_id: string;
      }> = [];
      for (const sound of soundscape) {
        for (const receiver of receiversList) {
          sourceReceiverPairs.push({
            source_position: sound.position,
            receiver_position: receiver.position,
            source_id: sound.id,
            receiver_id: receiver.id
          });
        }
      }

      // Prepare object materials (strip prefix)
      const objectMaterials: Record<string, string> = {};
      Object.entries(speckleMaterialAssignments).forEach(([objectId, materialId]) => {
        objectMaterials[objectId] = (materialId as string).replace(/^choras_/, '');
      });

      // Parse Speckle URL for project/model IDs
      const urlMatch = speckleData.url.match(/\/projects\/([^\/]+)\/models\/([^\/\?#]+)/);
      if (!urlMatch) throw new Error('Invalid Speckle URL');
      const projectId = urlMatch[1];
      const modelId = urlMatch[2];

      const geometryObjectIds = (config as any).speckleGeometryObjectIds as string[] | undefined;

      // Start simulation — returns immediately with simulation_id
      const { simulation_id } = await apiService.runChorasSimulationSpeckle(
        projectId,
        modelId,
        objectMaterials,
        (config as any).speckleLayerName || null,
        config.display_name || 'Simulation',
        settings,
        sourceReceiverPairs,
        geometryObjectIds
      );

      // Store the running simulation ID so the cancel handler can reach it
      handleUpdateConfig(index, { currentSimulationRunId: simulation_id } as any);

      // Poll for progress every second
      const pollInterval = setInterval(async () => {
        try {
          const statusData = await apiService.getChorasSimulationStatus(simulation_id);

          // Update progress bar on every tick
          handleUpdateConfig(index, { progress: statusData.progress, status: statusData.status } as any);

          if (!statusData.completed) return; // keep polling

          // ── Terminal states ──────────────────────────────────────────────
          clearInterval(pollInterval);
          pollIntervalsRef.current.delete(index);

          if (statusData.cancelled) {
            handleUpdateConfig(index, { isRunning: false, progress: 0, status: 'Cancelled', currentSimulationRunId: null } as any);
            return;
          }

          if (statusData.error) {
            handleUpdateConfig(index, { isRunning: false, status: 'Error', error: statusData.error, currentSimulationRunId: null } as any);
            return;
          }

          const result = statusData.result;
          if (!result?.ir_files?.length) {
            handleUpdateConfig(index, { isRunning: false, error: 'Simulation completed but generated no impulse responses.', currentSimulationRunId: null } as any);
            return;
          }

          // ── Import IRs + build results text (same as before) ─────────────
          const irImportResult = await importChorasIRFiles(result.simulation_id, result.ir_files);

          if (irImportResult.importedCount > 0) {
            const resultsText = await buildChorasSimulationResultsText(result.simulation_id, irImportResult);

            handleUpdateConfig(index, {
              importedIRMetadata: irImportResult.importedIRMetadataList[0],
              isRunning: false,
              status: 'Complete!',
              progress: 100,
              state: 'completed',
              completedAt: Date.now(),
              simulationResults: resultsText,
              importedIRIds: irImportResult.importedIRIds,
              sourceReceiverIRMapping: irImportResult.sourceReceiverMapping,
              currentSimulationRunId: null,
              currentSimulationId: result.simulation_id,
              simulationPositions: {
                sources: Object.fromEntries(soundscape.map(s => [s.id, s.position as [number, number, number]])),
                receivers: Object.fromEntries(receiversList.map(r => [r.id, r.position])),
              },
            } as any);
            if (onIRImported) onIRImported();
          } else {
            handleUpdateConfig(index, {
              isRunning: false,
              error: 'Simulation completed but failed to import impulse responses.',
              currentSimulationRunId: null,
            } as any);
          }

        } catch (pollErr) {
          clearInterval(pollInterval);
          pollIntervalsRef.current.delete(index);
          handleUpdateConfig(index, {
            isRunning: false,
            status: 'Error',
            error: pollErr instanceof Error ? pollErr.message : 'Status check failed',
            currentSimulationRunId: null,
          } as any);
        }
      }, 1000);

      pollIntervalsRef.current.set(index, pollInterval);

    } catch (e) {
      handleUpdateConfig(index, { isRunning: false, error: e instanceof Error ? e.message : 'Failed' } as any);
    }
  }, [simulationConfigs, speckleData, allReceivers, activeSoundscapeData, handleUpdateConfig, onIRImported]);

  /**
   * Run Pyroomacoustics simulation via Speckle
   */
  const runPyroomSimulation = useCallback(async (index: number) => {
    const config = simulationConfigs[index] as PyroomAcousticsSimulationConfig;
    if (!config || config.type !== 'pyroomacoustics') return;

    if (!speckleData) {
      handleUpdateConfig(index, { error: 'No Speckle data' } as any);
      return;
    }

    const settings = config.settings;
    const speckleMaterialAssignments = (config as any).speckleMaterialAssignments || {};

    if (Object.keys(speckleMaterialAssignments).length === 0) {
      handleUpdateConfig(index, { error: 'Assign materials first' } as any);
      return;
    }

    handleUpdateConfig(index, { isRunning: true, progress: 0, status: 'Submitting...', error: null } as any);

    const receiversList = allReceivers;
    const soundscape = activeSoundscapeData;

    try {
      // Build source-receiver pairs
      const sourceReceiverPairs = [];
      for (const sound of soundscape) {
        for (const receiver of receiversList) {
          sourceReceiverPairs.push({
            source_position: sound.position,
            receiver_position: receiver.position,
            source_id: sound.id,
            receiver_id: receiver.id
          });
        }
      }

      // Prepare object materials (strip prefix)
      const objectMaterials: Record<string, string> = {};
      Object.entries(speckleMaterialAssignments).forEach(([objectId, materialId]) => {
        objectMaterials[objectId] = (materialId as string).replace(/^pyroom_/, '');
      });

      // Parse Speckle URL for project/model IDs
      const urlMatch = speckleData.url.match(/\/projects\/([^\/]+)\/models\/([^\/\?#]+)/);
      if (!urlMatch) throw new Error('Invalid Speckle URL');
      const projectId = urlMatch[1];
      const modelId = urlMatch[2];

      const geometryObjectIds = (config as any).speckleGeometryObjectIds as string[] | undefined;
      const speckleScatteringAssignments = (config as any).speckleScatteringAssignments as Record<string, number> | undefined;

      // Start simulation — returns immediately with simulation_id
      const { simulation_id } = await apiService.runPyroomacousticsSimulationSpeckle(
        projectId,
        modelId,
        objectMaterials,
        (config as any).speckleLayerName || null,
        config.display_name || 'Simulation',
        settings,
        sourceReceiverPairs,
        geometryObjectIds,
        speckleScatteringAssignments || {}
      );

      // Store running simulation ID so the cancel handler can reach it
      handleUpdateConfig(index, { currentSimulationRunId: simulation_id } as any);

      // Poll for progress every 1.5 seconds
      const pollInterval = setInterval(async () => {
        try {
          const statusData = await apiService.getPyroomacousticsSimulationStatus(simulation_id);

          // Build status string — include queue position when waiting
          const statusStr = statusData.queue_position != null
            ? `Queued — position ${statusData.queue_position} of ${statusData.queue_total}`
            : statusData.status;

          handleUpdateConfig(index, { progress: statusData.progress, status: statusStr } as any);

          if (!statusData.completed) return; // keep polling

          // ── Terminal states ──────────────────────────────────────────────
          clearInterval(pollInterval);
          pollIntervalsRef.current.delete(index);

          if (statusData.cancelled) {
            handleUpdateConfig(index, { isRunning: false, progress: 0, status: 'Cancelled', currentSimulationRunId: null } as any);
            return;
          }

          if (statusData.error) {
            handleUpdateConfig(index, { isRunning: false, status: 'Error', error: statusData.error, currentSimulationRunId: null } as any);
            return;
          }

          const result = statusData.result;
          if (!result?.ir_files?.length) {
            handleUpdateConfig(index, { isRunning: false, error: 'Simulation completed but generated no impulse responses.', currentSimulationRunId: null } as any);
            return;
          }

          // ── Import IRs + build results text ──────────────────────────────
          const irImportResult = await importPyroomIRFiles(result.simulation_id, result.ir_files);

          if (irImportResult.importedCount > 0) {
            const resultsText = await buildSimulationResultsText(result.simulation_id);

            handleUpdateConfig(index, {
              importedIRMetadata: irImportResult.importedIRMetadataList[0],
              isRunning: false,
              status: 'Complete!',
              progress: 100,
              state: 'completed',
              completedAt: Date.now(),
              simulationResults: resultsText,
              importedIRIds: irImportResult.importedIRIds,
              sourceReceiverIRMapping: irImportResult.sourceReceiverMapping,
              currentSimulationRunId: null,
              currentSimulationId: result.simulation_id,
              simulationPositions: {
                sources: Object.fromEntries(soundscape.map(s => [s.id, s.position as [number, number, number]])),
                receivers: Object.fromEntries(receiversList.map(r => [r.id, r.position])),
              },
            } as any);
            if (onIRImported) onIRImported();
          } else {
            handleUpdateConfig(index, {
              isRunning: false,
              error: 'Simulation completed but failed to import impulse responses.',
              currentSimulationRunId: null,
            } as any);
          }

        } catch (pollErr) {
          clearInterval(pollInterval);
          pollIntervalsRef.current.delete(index);
          handleUpdateConfig(index, {
            isRunning: false,
            status: 'Error',
            error: pollErr instanceof Error ? pollErr.message : 'Status check failed',
            currentSimulationRunId: null,
          } as any);
        }
      }, 1500);

      pollIntervalsRef.current.set(index, pollInterval);

    } catch (e) {
      handleUpdateConfig(index, { isRunning: false, error: e instanceof Error ? e.message : 'Failed' } as any);
    }
  }, [simulationConfigs, speckleData, allReceivers, activeSoundscapeData, handleUpdateConfig, onIRImported]);

  /**
   * Run simulation for the given config index
   */
  const runSimulation = useCallback(async (index: number) => {
    const config = simulationConfigs[index];
    if (!config) return;

    if (config.type === 'choras') {
      await runChorasSimulation(index);
    } else if (config.type === 'pyroomacoustics') {
      await runPyroomSimulation(index);
    }
  }, [simulationConfigs, runChorasSimulation, runPyroomSimulation]);

  /**
   * Cancel a running simulation.
   * Stops the local poll interval, tells the backend to abort, and resets card state.
   */
  const cancelSimulation = useCallback((index: number) => {
    // Stop polling immediately
    const interval = pollIntervalsRef.current.get(index);
    if (interval) {
      clearInterval(interval);
      pollIntervalsRef.current.delete(index);
    }

    // Tell backend to cancel (fire-and-forget — UI resets regardless)
    const config = simulationConfigs[index] as any;
    if (config?.currentSimulationRunId) {
      if (config.type === 'pyroomacoustics') {
        apiService.cancelPyroomacousticsSimulation(config.currentSimulationRunId).catch(console.error);
      } else {
        apiService.cancelChorasSimulation(config.currentSimulationRunId).catch(console.error);
      }
    }

    handleUpdateConfig(index, { isRunning: false, status: 'Cancelled', progress: 0, currentSimulationRunId: null } as any);
  }, [simulationConfigs, handleUpdateConfig]);

  /**
   * Duplicate a simulation config.
   * - Before-simulation: copies all settings and material assignments into a new card.
   * - After-simulation (completed): creates a new card reset to before-simulation state,
   *   restoring the pre-run settings snapshot (savedSettings) and material assignments.
   */
  const handleDuplicateSimulation = useCallback((index: number) => {
    const config = simulationConfigs[index];
    if (!config || !onAddSimulationConfig || !onUpdateSimulationConfig) return;

    const newIndex = simulationConfigs.length;
    onAddSimulationConfig(config.type as AcousticSimulationMode);

    // Resonance cards have no per-card settings to copy — just add the new card.
    if (config.type === 'resonance') return;

    const simConfig = config as ChorasSimulationConfig | PyroomAcousticsSimulationConfig;
    const isCompleted = config.state === 'completed';

    // Speckle material data that should always be preserved
    const speckleMaterials = {
      speckleMaterialAssignments: (simConfig as any).speckleMaterialAssignments,
      speckleLayerName: (simConfig as any).speckleLayerName,
      speckleGeometryObjectIds: (simConfig as any).speckleGeometryObjectIds,
      speckleScatteringAssignments: (simConfig as any).speckleScatteringAssignments,
      speckleIsolatedObjectIds: (simConfig as any).speckleIsolatedObjectIds,
    };

    // Apply updates synchronously — Zustand updates are synchronous and React 18
    // auto-batches them, so the new card renders with speckleMaterialAssignments
    // already set. This ensures SpeckleSurfaceMaterialsSection mounts with the
    // correct initialAssignments instead of an empty object.
    const updates: any = {
      state: 'before-simulation',
      isRunning: false,
      status: '',
      error: null,
      progress: 0,
      simulationResults: null,
      importedIRMetadata: undefined,
      currentSimulationId: null,
      currentSimulationRunId: null,
      importedIRIds: undefined,
      sourceReceiverIRMapping: undefined,
      ...speckleMaterials,
    };

    if (isCompleted && simConfig.savedSettings) {
      // Restore from the pre-run snapshot saved before the simulation ran
      updates.settings = { ...simConfig.savedSettings.settings };
      updates.faceToMaterialMap = new Map(simConfig.savedSettings.faceToMaterialMap);
      updates.expandedMaterialItems = simConfig.savedSettings.expandedMaterialItems;
      updates.excludedLayers = simConfig.savedSettings.excludedLayers;
    } else {
      // Copy current (before-simulation) state directly
      updates.settings = { ...(simConfig as any).settings };
      if (simConfig.faceToMaterialMap) {
        updates.faceToMaterialMap = new Map(simConfig.faceToMaterialMap);
      }
      updates.expandedMaterialItems = simConfig.expandedMaterialItems;
      updates.excludedLayers = simConfig.excludedLayers;
    }

    onUpdateSimulationConfig(newIndex, updates);
  }, [simulationConfigs, onAddSimulationConfig, onUpdateSimulationConfig]);

  /**
   * Reset a simulation to before-simulation state
   */
  const resetSimulation = useCallback((index: number) => {
    const config = simulationConfigs[index];
    if (!config || config.type === 'resonance') return;

    const simConfig = config as ChorasSimulationConfig | PyroomAcousticsSimulationConfig;

    // Explicitly preserve Speckle material assignments and isolation across reset
    // so that SpeckleSurfaceMaterialsSection can restore them on remount
    const preservedMaterials = {
      speckleMaterialAssignments: (simConfig as any).speckleMaterialAssignments,
      speckleLayerName: (simConfig as any).speckleLayerName,
      speckleGeometryObjectIds: (simConfig as any).speckleGeometryObjectIds,
      speckleScatteringAssignments: (simConfig as any).speckleScatteringAssignments,
      speckleIsolatedObjectIds: (simConfig as any).speckleIsolatedObjectIds,
    };

    const resetState = {
      state: 'before-simulation',
      isRunning: false,
      status: '',
      error: null,
      progress: 0,
      simulationResults: null,
      importedIRMetadata: undefined,
      currentSimulationId: null,
      currentSimulationRunId: null,
      importedIRIds: undefined,
      sourceReceiverIRMapping: undefined,
      ...preservedMaterials,
    };

    if (simConfig.savedSettings) {
      handleUpdateConfig(index, {
        ...resetState,
        settings: simConfig.savedSettings.settings,
        faceToMaterialMap: new Map(simConfig.savedSettings.faceToMaterialMap),
        expandedMaterialItems: simConfig.savedSettings.expandedMaterialItems,
        excludedLayers: simConfig.savedSettings.excludedLayers,
        savedSettings: undefined
      } as any);
    } else {
      handleUpdateConfig(index, resetState as any);
    }

    if (activeSimulationIndex === index) {
      if (onAudioRenderingModeChange) onAudioRenderingModeChange('anechoic');
      if (onClearIR) onClearIR();
    }
  }, [simulationConfigs, activeSimulationIndex, handleUpdateConfig, onAudioRenderingModeChange, onClearIR]);

  // Speckle Material Assignments Handler (for SimulationSetup)
  // If the card is already completed and materials *actually changed*, auto-reset to before-simulation state.
  // On mount/restore the hook re-emits the same persisted assignments — skip reset in that case.
  const handleSpeckleMaterialAssignments = useCallback((index: number, assignments: Record<string, string>, layerName: string | null, geometryObjectIds: string[], scatteringAssignments: Record<string, number>) => {
    const config = simulationConfigs[index];
    // Pause acousticsSimulation temporal so this config-sync never becomes its own undo step.
    // Material assignment undo is owned entirely by acousticMaterial store.
    const acousticsTemporalPause = () => useAcousticsSimulationStore.temporal.getState().pause();
    const acousticsTemporalResume = () => useAcousticsSimulationStore.temporal.getState().resume();

    if (config && config.state === 'completed') {
      // Compare with existing persisted assignments to detect actual changes
      const existing = (config as any).speckleMaterialAssignments as Record<string, string> | undefined;
      const existingScattering = (config as any).speckleScatteringAssignments as Record<string, number> | undefined;

      const materialsChanged = JSON.stringify(existing ?? {}) !== JSON.stringify(assignments);
      const scatteringChanged = JSON.stringify(existingScattering ?? {}) !== JSON.stringify(scatteringAssignments);

      if (materialsChanged || scatteringChanged) {
        acousticsTemporalPause();
        resetSimulation(index);
        setTimeout(() => {
          handleUpdateConfig(index, {
            speckleMaterialAssignments: assignments,
            speckleLayerName: layerName,
            speckleGeometryObjectIds: geometryObjectIds,
            speckleScatteringAssignments: scatteringAssignments
          } as any);
          acousticsTemporalResume();
        }, 0);
        return;
      }
      // Same assignments — just a restore from mount, skip reset
      return;
    }

    acousticsTemporalPause();
    handleUpdateConfig(index, {
      speckleMaterialAssignments: assignments,
      speckleLayerName: layerName,
      speckleGeometryObjectIds: geometryObjectIds,
      speckleScatteringAssignments: scatteringAssignments
    } as any);
    acousticsTemporalResume();
  }, [handleUpdateConfig, simulationConfigs, resetSimulation]);

  // Auto-Select IR logic - use refs to avoid infinite loops
  // Store callbacks in refs to avoid dependency issues
  const onAudioRenderingModeChangeRef = useRef(onAudioRenderingModeChange);
  const onSelectIRFromLibraryRef = useRef(onSelectIRFromLibrary);
  useEffect(() => {
    onAudioRenderingModeChangeRef.current = onAudioRenderingModeChange;
    onSelectIRFromLibraryRef.current = onSelectIRFromLibrary;
  });

  // Derive the active config's relevant properties to use as stable dependencies
  const activeConfig = activeSimulationIndex !== null ? simulationConfigs[activeSimulationIndex] : null;
  const activeConfigType = activeConfig?.type;
  const activeConfigState = activeConfig?.state;
  const activeConfigIRId = activeConfig && 'importedIRMetadata' in activeConfig
    ? (activeConfig as any).importedIRMetadata?.id
    : null;

  useEffect(() => {
    const changeMode = onAudioRenderingModeChangeRef.current;
    const selectIR = onSelectIRFromLibraryRef.current;
    if (!changeMode || !selectIR) return;

    if (activeSimulationIndex === null) {
      if (audioRenderingMode !== 'anechoic') changeMode('anechoic');
    } else if (activeConfigType === 'resonance') {
      if (audioRenderingMode !== 'resonance') changeMode('resonance');
    } else if (activeConfigState === 'completed' && activeConfigIRId) {
      if (selectedIRId !== activeConfigIRId) {
        const activeSimConfig = simulationConfigs[activeSimulationIndex] as any;
        if (activeSimConfig?.importedIRMetadata) {
          selectIR(activeSimConfig.importedIRMetadata).catch(console.error);
        }
      } else if (audioRenderingMode !== 'precise') {
        changeMode('precise');
      }
    }
  }, [activeSimulationIndex, activeConfigType, activeConfigState, activeConfigIRId, audioRenderingMode, selectedIRId, simulationConfigs]);


  // ==========================================================================
  // Expand / Active Simulation Sync
  // ==========================================================================

  // Local expanded state (controlled mode for CardSection)
  const [expandedCardIndex, setExpandedCardIndex] = useState<number | null>(
    simulationConfigs.length > 0 ? 0 : null
  );

  // Auto-expand newly added cards, deactivate audio, and switch to Acoustic mode
  const prevSimCount = useRef(simulationConfigs.length);
  useEffect(() => {
    if (simulationConfigs.length > prevSimCount.current) {
      const newIndex = simulationConfigs.length - 1;
      const newConfig = simulationConfigs[newIndex];
      setExpandedCardIndex(newIndex);
      if (newConfig?.type === 'resonance') {
        // Resonance card is always ready → activate immediately so Resonance Audio launches
        // Do NOT change the view mode — Resonance doesn't use layer isolation/coloring
        if (onSetActiveSimulation) onSetActiveSimulation(newIndex);
      } else {
        // Non-resonance cards are always before-simulation → deactivate audio
        if (activeSimulationIndex !== null && onSetActiveSimulation) {
          onSetActiveSimulation(null);
        }
        // Switch to Acoustic mode so the new card's layer isolation + colors are active
        if (viewMode !== 'acoustic') {
          setViewMode('acoustic');
        }
      }
    }
    prevSimCount.current = simulationConfigs.length;
  }, [simulationConfigs.length, simulationConfigs, activeSimulationIndex, onSetActiveSimulation, viewMode, setViewMode]);

  // Track last completed-card index so the power button can re-enable it
  const lastActiveIndexRef = useRef<number | null>(null);
  useEffect(() => {
    if (activeSimulationIndex !== null) {
      lastActiveIndexRef.current = activeSimulationIndex;
    }
  }, [activeSimulationIndex]);

  // Auto-activate a card when it transitions to completed state
  const prevStatesRef = useRef<string[]>(simulationConfigs.map(c => c.state));
  useEffect(() => {
    const prevStates = prevStatesRef.current;
    simulationConfigs.forEach((config, index) => {
      if (config.state === 'completed' && prevStates[index] !== 'completed') {
        // Card just became completed → activate and expand it
        if (onSetActiveSimulation) onSetActiveSimulation(index);
        setExpandedCardIndex(index);
      }
    });
    prevStatesRef.current = simulationConfigs.map(c => c.state);
  }, [simulationConfigs, onSetActiveSimulation]);

  // Handle expand/collapse from CardSection
  const handleExpandedIndexChange = useCallback((index: number | null) => {
    setExpandedCardIndex(index);

    if (index === null) {
      // Collapsing all cards → switch to Default mode (unless dark mode is active)
      if (activeSimulationIndex !== null && onSetActiveSimulation) {
        onSetActiveSimulation(null);
      }
      if (viewMode !== 'dark') {
        setViewMode('default');
      }
    } else {
      const config = simulationConfigs[index];
      // Resonance cards don't use layer isolation/coloring — don't touch the view mode
      if (config?.type !== 'resonance' && viewMode !== 'dark') {
        setViewMode('acoustic');
      }
      if (config?.state === 'completed' || config?.type === 'resonance') {
        // Expanding a completed card or a resonance card → activate it
        // (Resonance is always ready; it doesn't need a simulation run)
        if (onSetActiveSimulation) onSetActiveSimulation(index);
      } else if (activeSimulationIndex !== null && onSetActiveSimulation) {
        // Expanding a before-simulation card → deactivate current
        onSetActiveSimulation(null);
      }
    }
  }, [onSetActiveSimulation, simulationConfigs, activeSimulationIndex, viewMode, setViewMode]);

  // Global power button: toggle audio rendering (only for completed cards)
  const hasAnyCompletedCard = simulationConfigs.some(c => c.state === 'completed');
  const isAudioActive = activeSimulationIndex !== null;
  const handleToggleAudioRendering = useCallback(() => {
    if (!onSetActiveSimulation) return;
    if (activeSimulationIndex !== null) {
      // Deactivate and collapse the active card → switch to Default mode
      onSetActiveSimulation(null);
      setExpandedCardIndex(null);
      if (viewMode !== 'dark') {
        setViewMode('default');
      }
    } else {
      // Re-activate audio: prefer the currently expanded card if it's completed,
      // then fall back to the last active card, then the first completed card
      const expandedIsCompleted =
        expandedCardIndex !== null &&
        simulationConfigs[expandedCardIndex]?.state === 'completed';

      let targetIndex: number | null = null;
      if (expandedIsCompleted) {
        targetIndex = expandedCardIndex;
      } else if (
        lastActiveIndexRef.current !== null &&
        lastActiveIndexRef.current < simulationConfigs.length &&
        simulationConfigs[lastActiveIndexRef.current]?.state === 'completed'
      ) {
        targetIndex = lastActiveIndexRef.current;
      } else {
        const firstCompleted = simulationConfigs.findIndex(c => c.state === 'completed');
        targetIndex = firstCompleted >= 0 ? firstCompleted : null;
      }

      if (targetIndex !== null) {
        onSetActiveSimulation(targetIndex);
        setExpandedCardIndex(targetIndex);
      }
      if (viewMode !== 'dark') {
        setViewMode('acoustic');
      }
    }
  }, [activeSimulationIndex, onSetActiveSimulation, simulationConfigs, viewMode, setViewMode, expandedCardIndex]);

  // ==========================================================================
  // Render Helpers
  // ==========================================================================

  const AVAILABLE_TYPES: CardTypeOption[] = [
    { type: 'resonance', label: CARD_TYPE_LABELS['resonance'], enabled: true },
    { type: 'pyroomacoustics', label: CARD_TYPE_LABELS['pyroomacoustics'], enabled: true },
    { type: 'choras', label: CARD_TYPE_LABELS['choras'], enabled: true },
  ];

  const header = (
  <div className="flex items-center gap-2 w-full justify-between">
    <div className="text-xs font-medium text-info">
      Acoustic cards
    </div>
    {simulationConfigs.length > 0 && hasAnyCompletedCard && (
      <button
        onClick={(e) => {
          e.stopPropagation();
          handleToggleAudioRendering();
        }}
        className={`p-1.5 rounded-full transition-colors flex items-center justify-center ${
          isAudioActive
            ? 'bg-info text-white'
            : 'text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100'
        }`}
        title={isAudioActive ? "Disable Auralization" : "Enable Auralization"}
      >
        <Power size={11} />
      </button>
    )}
  </div>
    );

  const renderCard = (config: SimulationConfig, index: number, isExpanded: boolean, onToggleExpand: (index: number) => void) => {
    const isCompleted = config.state === 'completed';
    const isRunning = config.type !== 'resonance' && (config as any).isRunning;
    const hasResult = isCompleted;

    // Simulation action button state
    const isSimulationType = config.type === 'choras' || config.type === 'pyroomacoustics';
    const hasValidGeometry = !!modelFile || !!(speckleData?.model_id && speckleData?.version_id && speckleData?.object_id);
    const hasReceivers = allReceivers.length > 0;
    const hasSounds = activeSoundscapeData.length > 0;
    const actionButtonDisabled = isSimulationType && (!hasValidGeometry || !hasReceivers || !hasSounds);
    const actionButtonDisabledReason = !hasValidGeometry
      ? 'No geometry loaded'
      : !hasReceivers
        ? 'No listeners configured (all hidden)'
        : !hasSounds
          ? 'No sounds configured (all muted)'
          : undefined;

    // Choose Materials based on Type
    const currentMaterials = config.type === 'choras'
        ? chorasMaterials
        : config.type === 'pyroomacoustics'
        ? pyroomMaterials
        : [];

    // Simulation setup component — always rendered for non-resonance types
    // so that filtering, coloring, and material context stay active
    // regardless of completion state (decoupled from generation state)
    const simulationSetup = config.type !== 'resonance' ? (
        <SimulationSetupContent
            config={config}
            index={index}
            viewerRef={viewerRef}
            worldTree={localWorldTree}
            availableMaterials={currentMaterials}
            filteringEnabled={filteringEnabled}
            onMaterialAssignmentsChange={(assignments, layerName, geometryObjectIds, scatteringAssignments) =>
              handleSpeckleMaterialAssignments(index, assignments, layerName, geometryObjectIds, scatteringAssignments)
            }
            onUpdateConfig={(updates) => handleUpdateConfig(index, updates)}
            onIsolationChange={(ids) => handleUpdateConfig(index, { speckleIsolatedObjectIds: ids } as any)}
        />
    ) : null;

    // Before Content - Simulation Setup
    const beforeContent = config.type === 'resonance' ? (
        <ResonanceContent
            config={config}
            resonanceAudioConfig={resonanceAudioConfig}
            onToggleResonanceAudio={onToggleResonanceAudio}
            onUpdateRoomMaterials={onUpdateRoomMaterials}
            hasGeometry={hasGeometry}
            showBoundingBox={showBoundingBox}
            onToggleBoundingBox={onToggleBoundingBox}
            onRefreshBoundingBox={onRefreshBoundingBox}
            roomScale={roomScale}
            onRoomScaleChange={onRoomScaleChange}
        />
    ) : !isCompleted ? simulationSetup : undefined;

    // After Content - results + hidden setup (keeps effects mounted for filtering/coloring)
    // Build display name maps from current soundscapeData and receivers for the IR label override
    const sourceDisplayNames: Record<string, string> = {};
    (soundscapeData ?? []).forEach((s) => {
      const sid = s.id;
      if (sid) sourceDisplayNames[sid] = s.display_name || sid;
    });
    const receiverDisplayNames: Record<string, string> = {};
    (receivers ?? []).forEach((r) => {
      if (r.id) receiverDisplayNames[r.id] = r.name || r.id;
    });

    // Current positions for mismatch detection in SimulationResultContent
    const currentSourcePositions: Record<string, [number, number, number]> = {};
    (soundscapeData ?? []).forEach((s) => {
      if (s.id && s.position) currentSourcePositions[s.id] = s.position as [number, number, number];
    });
    const currentReceiverPositions: Record<string, [number, number, number]> = {};
    receivers.forEach((r) => { currentReceiverPositions[r.id] = r.position; });
    gridListeners.forEach((g) => {
      g.points.forEach((pt, i) => { currentReceiverPositions[`${g.id}-${i}`] = pt; });
    });

    // Reset mismatched objects to their simulation-time positions
    const handleResetPositions = (sourceIds: string[], receiverIds: string[]) => {
      const simPositions = (config as any).simulationPositions as {
        sources: Record<string, [number, number, number]>;
        receivers: Record<string, [number, number, number]>;
      } | undefined;
      if (!simPositions) return;
      for (const id of sourceIds) {
        const pos = simPositions.sources[id];
        if (pos) updateSoundPosition(id, pos);
      }
      for (const id of receiverIds) {
        const pos = simPositions.receivers[id];
        if (pos) updateReceiverPosition(id, pos);
      }
    };

    const afterContent = isCompleted ? (
        <>
          <SimulationResultContent
              config={config}
              onClearIR={onClearIR}
              irRefreshTrigger={irRefreshTrigger}
              onIRHover={props.onIRHover}
              sourceDisplayNames={sourceDisplayNames}
              receiverDisplayNames={receiverDisplayNames}
              isExpanded={isExpanded}
              selectedMetric={(config as any).selectedGradientMetric ?? null}
              onMetricChange={(metric) => handleUpdateConfig(index, { selectedGradientMetric: metric } as any)}
              currentSourcePositions={currentSourcePositions}
              currentReceiverPositions={currentReceiverPositions}
              onResetPositions={handleResetPositions}
          />
          <SimulationSettingsSection config={config} />
          {/* Hidden: keeps SpeckleSurfaceMaterialsSection mounted for filtering/coloring effects */}
          <div className="hidden">{simulationSetup}</div>
        </>
    ) : undefined;

    // Duplicate button — available for all simulation types and states
    const customButtons: React.ReactNode[] = [];
    if (onAddSimulationConfig && onUpdateSimulationConfig) {
      customButtons.push(
        <button
          key="duplicate"
          onClick={(e) => {
            e.stopPropagation();
            handleDuplicateSimulation(index);
          }}
          className="w-5 h-5 flex items-center justify-center rounded-full transition-colors text-secondary-hover hover:bg-secondary-light hover:text-foreground"
          title="Duplicate simulation"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        </button>
      );
    }

    // Derive version + timestamp lines for this card type
    const cardVersion = (() => {
      if (!serviceVersions || !hasResult) return undefined;
      let versionLine: string | undefined;
      if (config.type === 'pyroomacoustics') {
        const v = serviceVersions.pyroomacoustics;
        versionLine = `${v.name} ${v.version}`;
      } else if (config.type === 'choras') {
        const method = (config as any).settings?.simulation_method;
        if (method === 'DG') {
          const v = serviceVersions.edg_acoustics;
          versionLine = `${v.name} ${v.version}`;
        } else {
          const v = serviceVersions.acousticDE;
          versionLine = `${v.name} ${v.version}`;
        }
      }
      if (!versionLine) return undefined;
      const completedAt: number | undefined = (config as any).completedAt;
      if (completedAt) {
        const d = new Date(completedAt);
        const pad = (n: number) => String(n).padStart(2, '0');
        const timestamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
        return [versionLine, timestamp];
      }
      return versionLine;
    })();

    return (
        <Card
            config={config}
            index={index}
            isExpanded={isExpanded}
            hasResult={hasResult}
            isRunning={isRunning}
            progress={(config as any).progress ?? 0}
            status={(config as any).status}
            error={(config as any).error}
            onToggleExpand={() => onToggleExpand(index)}
            onUpdateConfig={(idx, updates) => handleUpdateConfig(idx, updates)}
            onRemove={() => onRemoveSimulationConfig && onRemoveSimulationConfig(index)}
            onReset={() => resetSimulation(index)}
            onDismissError={(idx) => handleUpdateConfig(idx, { error: null } as any)}
            beforeContent={beforeContent}
            afterContent={afterContent}
            closeButtonTitle="Remove simulation"
            resetButtonTitle="Reset simulation"
            customButtons={customButtons.length > 0 ? customButtons : undefined}
            // Simulation action button props (for choras/pyroomacoustics)
            onRun={isSimulationType ? async () => await runSimulation(index) : undefined}
            onCancel={isSimulationType ? () => cancelSimulation(index) : undefined}
            actionButtonLabel="Start Simulation"
            actionButtonDisabled={actionButtonDisabled}
            actionButtonDisabledReason={actionButtonDisabledReason}
            actionButtonColor='info'
            color="info"
            version={cardVersion}
        />
    );
  };

  return (
    <div className="flex flex-col min-h-0 gap-4">
      <div className="flex-1">
        <CardSection
          items={simulationConfigs}
          availableTypes={AVAILABLE_TYPES}
          emptyMessage="No acoustic simulation configured."
          statusLabel="simulation"
          addButtonTitle="Add acoustic simulation"
          onAddItem={handleAddItem}
          renderCard={renderCard}
          color="info"
          header={header}
          expandedIndex={expandedCardIndex}
          onExpandedIndexChange={handleExpandedIndexChange}
        />
     </div>

     <div className="flex-1" />

    </div>
  );
}
