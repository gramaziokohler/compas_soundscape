/**
 * AcousticsSection Component
 *
 * Main container for acoustic simulations.
 * Consolidated architecture using CardSection and Card components.
 * Manages simulation configurations, material assignments, and execution.
 *
 * Simulation execution is delegated to individual hooks:
 * - useChoras for Choras simulations
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

import { useCallback, useEffect, useState, useRef } from 'react';
import { Power } from 'lucide-react';
import { CardSection, type CardTypeOption } from '@/components/ui/CardSection';
import { Card } from '@/components/ui/Card';
import { apiService } from '@/services/api';
import { CARD_TYPE_LABELS } from '@/types/card';
import { useSpeckleViewerContext } from '@/contexts/SpeckleViewerContext';

// Content Components
import { ResonanceContent } from '@/components/layout/sidebar/acoustics/ResonanceContent';
import { SimulationResultContent } from '@/components/layout/sidebar/acoustics/SimulationResultContent';
import { SimulationSetupContent } from '@/components/layout/sidebar/acoustics/SimulationSetupContent';
import { ReceiversSection } from '@/components/layout/sidebar/ReceiversSection';

// Hooks
import { useAcousticsMaterials } from '@/hooks/useAcousticsMaterials';
import { runFullSimulation as runChorasFullSimulation } from '@/hooks/useChoras';

// Utils
import {
  importPyroomIRFiles,
  buildSimulationResultsText
} from '@/utils/acousticMetrics';

// Types
import type {
  SimulationConfig,
  AcousticSimulationMode,
  ChorasSimulationConfig,
  PyroomAcousticsSimulationConfig
} from '@/types/acoustics';
import type { CardType } from '@/types/card';
import type {
  CompasGeometry,
  EntityData,
  SoundEvent,
  ReceiverData
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

interface AcousticsSectionProps {
  // Receiver props
  receivers?: ReceiverData[];
  onAddReceiver?: (type: string) => void;
  onDeleteReceiver?: (id: string) => void;
  onUpdateReceiverName?: (id: string, name: string) => void;
  onGoToReceiver?: (id: string) => void;

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

  // World Tree (Special for Speckle)
  worldTree?: any;
}

export function AcousticsSection(props: AcousticsSectionProps) {
  const {
    receivers = [],
    onAddReceiver,
    onDeleteReceiver,
    onUpdateReceiverName,
    onGoToReceiver,
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

  const { viewerRef } = useSpeckleViewerContext();

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

  // World Tree state (for Speckle material assignment)
  const [localWorldTree, setLocalWorldTree] = useState(propWorldTree);

  // Load World Tree from Speckle viewer if not provided as prop
  useEffect(() => {
    if (propWorldTree) {
      setLocalWorldTree(propWorldTree);
      return;
    }
    const checkWorldTree = () => {
      if (!viewerRef?.current) return;
      const tree = viewerRef.current.getWorldTree?.();
      const treeAny = tree as any;
      const children = treeAny?.tree?._root?.children ||
                      treeAny?._root?.children ||
                      treeAny?.root?.children ||
                      treeAny?.children;

      if (children && children.length > 0) {
        setLocalWorldTree(tree);
      }
    };
    checkWorldTree();
    const interval = setInterval(checkWorldTree, 500);
    return () => clearInterval(interval);
  }, [propWorldTree, viewerRef]);

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


  // Speckle Material Assignments Handler (for SimulationSetup)
  const handleSpeckleMaterialAssignments = useCallback((index: number, assignments: Record<string, string>, layerName: string | null) => {
    handleUpdateConfig(index, {
      speckleMaterialAssignments: assignments,
      speckleLayerName: layerName
    } as any);
  }, [handleUpdateConfig]);

  // ==========================================================================
  // Simulation Execution - Delegated to hooks (single source of truth)
  // ==========================================================================

  /**
   * Run Choras simulation - delegates to useChoras hook
   */
  const runChorasSimulation = useCallback(async (index: number) => {
    const config = simulationConfigs[index] as ChorasSimulationConfig;
    if (!config || config.type !== 'choras') return;

    const settings = config.settings;
    const selectedMaterialId = settings.selectedMaterialId;

    if (!selectedMaterialId) {
      handleUpdateConfig(index, { error: 'Please select a material' } as any);
      return;
    }

    if (!modelFile) {
      handleUpdateConfig(index, { error: 'Model file required' } as any);
      return;
    }

    handleUpdateConfig(index, { isRunning: true, progress: 0, status: 'Running simulation...', error: null } as any);

    const receiversList = receivers.map(r => ({ id: r.id, position: r.position }));
    const soundscape = soundscapeData || [];
    const excludedLayersArray: string[] = config.excludedLayers ? Array.from(config.excludedLayers) : [];

    // Prepare settings (remove selectedMaterialId as it's passed separately)
    const { selectedMaterialId: _, ...chorasSettings } = settings;

    try {
      const result = await runChorasFullSimulation(
        modelFile,
        parseInt(selectedMaterialId, 10),
        config.display_name || 'Simulation',
        (percentage, message) => handleUpdateConfig(index, { progress: percentage, status: message } as any),
        (simulationId, simulationRunId) => handleUpdateConfig(index, { currentSimulationId: simulationId, currentSimulationRunId: simulationRunId } as any),
        receiversList,
        soundscape,
        chorasSettings,
        excludedLayersArray
      );

      if (result.simulationId) {
        // Import IR from Choras
        await importChorasIR(index, result.simulationId, config.display_name || 'Choras');
      } else {
        handleUpdateConfig(index,{
          isRunning: false,
          status: 'Complete!',
          progress: 100,
          state: 'completed',
          simulationResults: 'No results.'
        } as any);
      }
    } catch (error) {
      handleUpdateConfig(index, {
        isRunning: false,
        error: error instanceof Error ? error.message : 'Simulation failed'
      } as any);
    }
  }, [simulationConfigs, modelFile, receivers, soundscapeData, handleUpdateConfig]);

  /**
   * Import IR from Choras simulation
   */
  const importChorasIR = useCallback(async (index: number, simulationId: number, simulationName: string) => {
    let resultsText = 'Simulation Complete!\n\n';

    try {
      const response = await fetch(`http://localhost:8000/choras/get-result-file/${simulationId}/wav`);

      if (response.ok) {
        const blob = await response.blob();
        const file = new File([blob], `simulation_${simulationId}_impulse_response.wav`, { type: 'audio/wav' });
        const irName = `Choras_Sim${simulationId}_${Date.now()}`;
        const irMetadata = await apiService.uploadImpulseResponse(file, irName);

        // Get acoustic metrics
        try {
          const jsonResponse = await fetch(`http://localhost:8000/choras/get-result-file/${simulationId}/json`);
          if (jsonResponse.ok) {
            const jsonData = await jsonResponse.json();
            if (Array.isArray(jsonData) && jsonData.length > 0) {
              const sourceData = jsonData[0];
              const receiverData = sourceData.responses?.[0];
              if (receiverData?.parameters) {
                const params = receiverData.parameters;
                const average = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
                resultsText += `Acoustic Metrics:\n`;
                const metrics = [];
                if (params.t30) metrics.push(`T30: ${average(params.t30).toFixed(2)}s`);
                if (params.edt) metrics.push(`EDT: ${average(params.edt).toFixed(2)}s`);
                if (params.d50) metrics.push(`D50: ${average(params.d50).toFixed(1)}`);
                if (params.c80) metrics.push(`C80: ${average(params.c80).toFixed(1)} dB`);
                resultsText += metrics.join(', ') + '\n';
              }
            }
          }
        } catch (e) { console.error(e); }

        // resultsText += '\n✓ Impulse response imported to library\n';
        handleUpdateConfig(index, {
          importedIRMetadata: irMetadata,
          simulationResults: resultsText,
          isRunning: false,
          status: 'Complete!',
          progress: 100,
          state: 'completed'
        } as any);
        if (onIRImported) onIRImported();
      }
    } catch (e) {
      handleUpdateConfig(index, {
        isRunning: false,
        status: 'Complete!',
        progress: 100,
        state: 'completed',
        simulationResults: 'Simulation Complete!\n\n⚠ Failed to import impulse response\n'
      } as any);
    }
  }, [handleUpdateConfig, onIRImported]);

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

    handleUpdateConfig(index, { isRunning: true, progress: 0, status: 'Running simulation...', error: null } as any);

    const receiversList = receivers.map(r => ({ id: r.id, position: r.position }));
    const soundscape = soundscapeData || [];

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

      const result = await apiService.runPyroomacousticsSimulationSpeckle(
        projectId,
        modelId,
        objectMaterials,
        (config as any).speckleLayerName || null,
        config.display_name || 'Simulation',
        settings,
        sourceReceiverPairs
      );

      // Import all IR files using shared utility
      if (result.ir_files && result.ir_files.length > 0) {
        const irImportResult = await importPyroomIRFiles(
          result.simulation_id,
          result.ir_files
        );

        if (irImportResult.importedCount > 0) {
          // Build results text using shared utility
          const resultsText = await buildSimulationResultsText(
            result.simulation_id,
            irImportResult
          );

          handleUpdateConfig(index, {
            importedIRMetadata: irImportResult.importedIRMetadataList[0],
            isRunning: false,
            status: 'Complete!',
            progress: 100,
            state: 'completed',
            simulationResults: resultsText,
            importedIRIds: irImportResult.importedIRIds,
            sourceReceiverIRMapping: irImportResult.sourceReceiverMapping
          } as any);
          if (onIRImported) onIRImported();
        } else {
          handleUpdateConfig(index, { isRunning: false, status: 'Complete', progress: 100, state: 'completed', simulationResults: 'Failed to import IRs' } as any);
        }
      } else {
        handleUpdateConfig(index, { isRunning: false, status: 'Complete', progress: 100, state: 'completed', simulationResults: 'No IRs generated' } as any);
      }

    } catch (e) {
      handleUpdateConfig(index, { isRunning: false, error: e instanceof Error ? e.message : 'Failed' } as any);
    }
  }, [simulationConfigs, speckleData, receivers, soundscapeData, handleUpdateConfig, onIRImported]);

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
   * Cancel a running simulation
   */
  const cancelSimulation = useCallback((index: number) => {
    handleUpdateConfig(index, { isRunning: false, status: 'Cancelled', progress: 0 } as any);
  }, [handleUpdateConfig]);

  /**
   * Reset a simulation to before-simulation state
   */
  const resetSimulation = useCallback((index: number) => {
    const config = simulationConfigs[index];
    if (!config || config.type === 'resonance') return;

    const simConfig = config as ChorasSimulationConfig | PyroomAcousticsSimulationConfig;
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
      sourceReceiverIRMapping: undefined
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
  // Render Helpers
  // ==========================================================================

  const AVAILABLE_TYPES: CardTypeOption[] = [
    { type: 'resonance', label: CARD_TYPE_LABELS['resonance'], enabled: true },
    { type: 'choras', label: CARD_TYPE_LABELS['choras'], enabled: true },
    { type: 'pyroomacoustics', label: CARD_TYPE_LABELS['pyroomacoustics'], enabled: true },
  ];

  const header = (
  <div className="flex flex-col gap-2">
    <div className="text-xs font-medium text-info">
      Acoustic cards
    </div>
  </div>
    );

  const renderCard = (config: SimulationConfig, index: number, isExpanded: boolean, onToggleExpand: (index: number) => void) => {
    const isCompleted = config.state === 'completed';
    const isRunning = config.type !== 'resonance' && (config as any).isRunning;
    const hasResult = isCompleted;
    const isActive = index === activeSimulationIndex;

    // Simulation action button state
    const isSimulationType = config.type === 'choras' || config.type === 'pyroomacoustics';
    const hasValidGeometry = !!modelFile || !!(speckleData?.model_id && speckleData?.version_id && speckleData?.object_id);
    const hasReceivers = receivers?.length > 0;
    const hasSounds = (soundscapeData?.length ?? 0) > 0;
    const actionButtonDisabled = isSimulationType && (!hasValidGeometry || !hasReceivers || !hasSounds);
    const actionButtonDisabledReason = !hasValidGeometry 
      ? 'No geometry loaded' 
      : !hasReceivers 
        ? 'No receivers configured' 
        : !hasSounds 
          ? 'No sounds configured' 
          : undefined;

    // Choose Materials based on Type
    const currentMaterials = config.type === 'choras'
        ? chorasMaterials
        : config.type === 'pyroomacoustics'
        ? pyroomMaterials
        : [];

    // Custom Activation Action
    const customActions = (
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (onSetActiveSimulation) onSetActiveSimulation(isActive ? null : index);
        }}
        className={`p-1.5 rounded-full transition-colors flex items-center justify-center ${
          isActive
            ? 'text-white ring-1'
            : 'text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100'
        }`}
        style={isActive ? {
          backgroundColor: 'var(--card-color, var(--color-primary))',
          // @ts-expect-error -- ring-color CSS custom property
          '--tw-ring-color': 'var(--card-color, var(--color-primary))',
        } : undefined}
        title={isActive ? "Disable Simulation" : "Activate Simulation"}
      >
        <Power size={11} />
      </button>
    );

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
    ) : !isCompleted ? (
        <SimulationSetupContent
            config={config}
            index={index}
            viewerRef={viewerRef}
            worldTree={localWorldTree}
            availableMaterials={currentMaterials}
            onMaterialAssignmentsChange={(assignments, layerName) =>
              handleSpeckleMaterialAssignments(index, assignments, layerName)
            }
            onUpdateConfig={(updates) => handleUpdateConfig(index, updates)}
        />
    ) : undefined;

    // After Content
    const afterContent = isCompleted ? (
        <SimulationResultContent
            config={config}
            onClearIR={onClearIR}
            irRefreshTrigger={irRefreshTrigger}
        />
    ) : undefined;

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
            customButtons={[customActions]}
            beforeContent={beforeContent}
            afterContent={afterContent}
            closeButtonTitle="Remove simulation"
            resetButtonTitle="Reset simulation"
            // Simulation action button props (for choras/pyroomacoustics)
            onRun={isSimulationType ? async () => await runSimulation(index) : undefined}
            onCancel={isSimulationType ? () => cancelSimulation(index) : undefined}
            actionButtonLabel="Start Simulation"
            actionButtonDisabled={actionButtonDisabled}
            actionButtonDisabledReason={actionButtonDisabledReason}
            actionButtonColor='info'
            color="info"
        />
    );
  };

  return (
    <div className="flex flex-col min-h-0 overflow-hidden gap-4">
      <div className="flex-1">
        <CardSection
          items={simulationConfigs}
          availableTypes={AVAILABLE_TYPES}
          emptyMessage="No acoustic simulation configured."
          statusLabel="simulation"
          addButtonTitle="Add acoustics"
          onAddItem={handleAddItem}
          renderCard={renderCard}
          color="info"
          header={header}
        />
     </div>

     <div className="flex-1" />

      {/* Receivers Section */}
      {onAddReceiver && onDeleteReceiver && onUpdateReceiverName && onGoToReceiver && (
        <>
          <div className="flex-shrink-0 mt-5" >
            <ReceiversSection
              receivers={receivers}
              onAddReceiver={onAddReceiver}
              onDeleteReceiver={onDeleteReceiver}
              onUpdateReceiverName={onUpdateReceiverName}
              onGoToReceiver={onGoToReceiver}
            />
          </div>
        </>
      )}

    </div>
  );
}
