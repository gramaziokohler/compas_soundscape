/**
 * AcousticsTab Component
 *
 * Refactored to use the new AcousticsSection with multiple simulation tabs.
 * Manages acoustic simulation configurations and integrates with audio orchestrator.
 *
 * NOTE: This component now receives simulation state as props from page.tsx
 * instead of calling useAcousticsSimulation internally to avoid duplicate hook instances.
 */

import { useMemo, useCallback, useEffect, useState } from 'react';
import { AcousticsSection } from './AcousticsSection';
import { apiService } from '@/services/api';
import type { CompasGeometry, EntityData, SoundEvent, ReceiverData } from '@/types';
import type { ImpulseResponseMetadata, ResonanceAudioConfig, AuralizationConfig } from '@/types/audio';
import type { SelectedGeometry, AcousticMaterial } from '@/types/materials';
import type { SimulationConfig, AcousticSimulationMode } from '@/types/acoustics';
import type { AudioRenderingMode } from '@/components/audio/AudioRenderingModeSelector';
import {
  CHORAS_DEFAULT_C0,
  CHORAS_DEFAULT_IR_LENGTH,
  CHORAS_DEFAULT_LC,
  CHORAS_DEFAULT_EDT,
  CHORAS_DEFAULT_SIM_LEN_TYPE
} from '@/lib/constants';


interface AcousticsTabProps {
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

  // Audio Orchestrator props
  audioRenderingMode?: AudioRenderingMode;
  onAudioRenderingModeChange?: (mode: AudioRenderingMode) => void;

  // Material Assignment props
  modelEntities?: EntityData[];
  modelType?: '3dm' | 'obj' | 'ifc' | null;
  geometryData?: CompasGeometry | null;
  selectedGeometry?: SelectedGeometry | null;
  onSelectGeometry?: (selection: SelectedGeometry | null) => void;
  onAssignMaterial?: (selection: SelectedGeometry, material: AcousticMaterial | null) => void;

  // Simulation props
  modelFile?: File | null;
  soundscapeData?: SoundEvent[] | null;
  onIRImported?: () => void;
  irRefreshTrigger?: number;

  // Receivers
  receivers?: ReceiverData[];
  isPlacingReceiver?: boolean;
  onStartPlacingReceiver?: () => void;
  onDeleteReceiver?: (id: string) => void;
  onUpdateReceiverName?: (id: string, name: string) => void;
  onGoToReceiver?: (id: string) => void;

  // Simulation state (NEW - passed from page.tsx)
  simulationConfigs?: SimulationConfig[];
  activeSimulationIndex?: number | null;
  expandedTabIndex?: number | null;
  onAddSimulationConfig?: (mode: AcousticSimulationMode) => void;
  onRemoveSimulationConfig?: (index: number) => void;
  onUpdateSimulationConfig?: (index: number, updates: Partial<SimulationConfig>) => void;
  onSetActiveSimulation?: (index: number | null) => void;
  onUpdateSimulationName?: (index: number, name: string) => void;
  onToggleExpandSimulation?: (index: number) => void;
}


export function AcousticsTab({
  receivers = [],
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
  audioRenderingMode = 'anechoic',
  onAudioRenderingModeChange,
  modelEntities = [],
  modelType = null,
  geometryData = null,
  selectedGeometry = null,
  onSelectGeometry,
  onAssignMaterial,
  modelFile = null,
  soundscapeData = null,
  onIRImported,
  irRefreshTrigger = 0,
  isPlacingReceiver = false,
  onStartPlacingReceiver,
  onDeleteReceiver,
  onUpdateReceiverName,
  onGoToReceiver,
  simulationConfigs = [],
  activeSimulationIndex = null,
  expandedTabIndex = null,
  onAddSimulationConfig,
  onRemoveSimulationConfig,
  onUpdateSimulationConfig,
  onSetActiveSimulation,
  onUpdateSimulationName,
  onToggleExpandSimulation
}: AcousticsTabProps) {
  // Use simulation state from props (passed from page.tsx)
  const handleAddConfig = onAddSimulationConfig || (() => {});
  const handleRemoveConfig = onRemoveSimulationConfig || (() => {});
  const handleUpdateConfig = onUpdateSimulationConfig || (() => {});
  const handleSetActiveSimulation = onSetActiveSimulation || (() => {});
  const handleUpdateSimulationName = onUpdateSimulationName || (() => {});
  const handleToggleExpand = onToggleExpandSimulation || (() => {});

  // Create simulation runner helper that handles per-instance execution
  const runChorasSimulation = useCallback(async (
    instanceId: string,
    file: File,
    name: string,
    receiversList: any[],
    soundscape: any[],
    onProgress: (updates: any) => void
  ) => {
    // Dynamically create and use the hook for this specific instance
    const { useChorasSimulation } = await import('@/hooks/useChorasSimulation');
    
    // We can't call hooks here, so we'll use the module's persistent state directly
    // The hook already manages per-instance state internally
    const chorasModule = await import('@/hooks/useChoras');
    const { runFullSimulation } = chorasModule;
    
    // Get settings from the simulation config
    const config = simulationConfigs.find(c => (c.simulationInstanceId || c.id) === instanceId);
    const settings = (config as any)?.settings || {
      de_c0: CHORAS_DEFAULT_C0,
      de_ir_length: CHORAS_DEFAULT_IR_LENGTH,
      de_lc: CHORAS_DEFAULT_LC,
      edt: CHORAS_DEFAULT_EDT,
      sim_len_type: CHORAS_DEFAULT_SIM_LEN_TYPE as 'ir_length' | 'edt',
      selectedMaterialId: null
    };
    const selectedMaterialId = settings.selectedMaterialId || null;
    
    if (!selectedMaterialId) {
      onProgress({ error: 'Please select a material' });
      return;
    }
    
    // Extract only simulation settings for Choras backend (exclude selectedMaterialId)
    const { selectedMaterialId: _, ...chorasSettings } = settings;
    
    try {
      const result = await runFullSimulation(
        file,
        selectedMaterialId,
        name,
        (percentage, message) => {
          onProgress({
            progress: percentage,
            status: message
          });
        },
        (simulationId, simulationRunId) => {
          onProgress({
            currentSimulationId: simulationId,
            currentSimulationRunId: simulationRunId
          });
        },
        receiversList,
        soundscape,
        chorasSettings
      );
      
      // Import IR and get metadata
      if (result.simulationId) {
        await new Promise(resolve => setTimeout(resolve, 1000));

        let resultsText = 'Simulation Complete!\n\n';

        try {
          const response = await fetch(`http://localhost:8000/choras/get-result-file/${result.simulationId}/wav`);
          if (response.ok) {
            const blob = await response.blob();
            const file = new File([blob], `simulation_${result.simulationId}_impulse_response.wav`, { type: 'audio/wav' });
            const irName = `Choras_Sim${result.simulationId}_${Date.now()}`;
            const irMetadata = await apiService.uploadImpulseResponse(file, irName);

            // Fetch and parse acoustic metrics from results JSON
            try {
              const jsonResponse = await fetch(`http://localhost:8000/choras/get-result-file/${result.simulationId}/json`);
              if (jsonResponse.ok) {
                const jsonData = await jsonResponse.json();

                if (Array.isArray(jsonData) && jsonData.length > 0) {
                  const sourceData = jsonData[0];
                  const frequencies = sourceData.frequencies;
                  const freqRange = frequencies && frequencies.length > 0
                    ? `(${frequencies[0]}-${frequencies[frequencies.length - 1]} Hz)`
                    : '';

                  const receiverData = sourceData.responses?.[0];
                  if (receiverData?.parameters) {
                    const params = receiverData.parameters;
                    const average = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

                    resultsText += `Acoustic Metrics: ${freqRange}\n`;

                    const metrics = [];
                    if (params.t30) metrics.push(`T30: ${average(params.t30).toFixed(2)}s`);
                    if (params.edt) metrics.push(`EDT: ${average(params.edt).toFixed(2)}s`);
                    if (params.d50) metrics.push(`D50: ${average(params.d50).toFixed(1)}`);
                    if (params.c80) metrics.push(`C80: ${average(params.c80).toFixed(1)} dB`);

                    resultsText += metrics.join(', ') + '\n';
                  }
                }
              }
            } catch (error) {
              console.error('Failed to parse acoustic metrics:', error);
            }

            resultsText += '\n✓ Impulse response imported to library\n';

            onProgress({
              importedIRMetadata: irMetadata,
              simulationResults: resultsText,
              isRunning: false,
              status: 'Complete!',
              progress: 100,
              state: 'completed'
            });

            if (onIRImported) {
              onIRImported();
            }
          }
        } catch (error) {
          console.error('Failed to import IR:', error);
          onProgress({
            isRunning: false,
            status: 'Complete!',
            progress: 100,
            state: 'completed',
            simulationResults: 'Simulation Complete!\n\n⚠ Failed to import impulse response\n'
          });
        }
      } else {
        onProgress({
          isRunning: false,
          status: 'Complete!',
          progress: 100,
          state: 'completed',
          simulationResults: 'Simulation completed but no results available.'
        });
      }
    } catch (error) {
      onProgress({
        isRunning: false,
        error: error instanceof Error ? error.message : 'Simulation failed'
      });
    }
  }, [simulationConfigs, onIRImported]);

  const runPyroomSimulation = useCallback(async (
    instanceId: string,
    file: File,
    name: string,
    receiversList: any[],
    soundscape: any[],
    onProgress: (updates: any) => void
  ) => {
    // Get settings from the simulation config
    const config = simulationConfigs.find(c => (c.simulationInstanceId || c.id) === instanceId);
    const settings = (config as any)?.settings || {
      max_order: 3,
      ray_tracing: false,
      air_absorption: false,
      n_rays: 5000,
      scattering: 0.1
    };
    const faceMaterials = (config as any)?.faceToMaterialMap || new Map();
    
    if (faceMaterials.size === 0) {
      onProgress({ error: 'Please assign materials to at least one face' });
      return;
    }
    
    try {
      // Build source-receiver pairs
      const sourceReceiverPairs = [];
      for (const sound of soundscape) {
        for (const receiver of receiversList) {
          sourceReceiverPairs.push({
            source_position: sound.position,
            receiver_position: receiver.position,
            source_id: sound.id || sound.name,
            receiver_id: receiver.id
          });
        }
      }
      
      // Convert Map to object for API
      const faceMaterialsObj: Record<number, string> = {};
      faceMaterials.forEach((value: string, key: number) => {
        faceMaterialsObj[key] = value;
      });
      
      const result = await apiService.runPyroomacousticsSimulation(
        file,
        name,
        settings,
        sourceReceiverPairs,
        faceMaterialsObj
      );
      
      // Import ALL IRs
      if (result.ir_files && result.ir_files.length > 0) {
        const importedIRMetadataList = [];
        const sourceReceiverMapping: Record<string, Record<string, ImpulseResponseMetadata>> = {};

        for (const irFilename of result.ir_files) {
          try {
            // Fetch the specific IR file
            const blob = await apiService.getPyroomacousticsIRFile(result.simulation_id, irFilename);

            // Create File object from blob
            const file = new File([blob], irFilename, { type: 'audio/wav' });

            // Extract source and receiver IDs from filename
            // Format: sim_{simulation_id}_src_{source_id}_rcv_{receiver_id}.wav
            const match = irFilename.match(/src_(.+?)_rcv_(.+?)\.wav$/);
            const sourceId = match ? match[1] : 'unknown';
            const receiverId = match ? match[2] : 'unknown';

            // Upload to IR library with descriptive name
            const irName = `Pyroom_${name}_S${sourceId}_R${receiverId}`;
            const irMetadata = await apiService.uploadImpulseResponse(file, irName);
            importedIRMetadataList.push(irMetadata);

            // Build source-receiver IR mapping
            if (!sourceReceiverMapping[sourceId]) {
              sourceReceiverMapping[sourceId] = {};
            }
            sourceReceiverMapping[sourceId][receiverId] = irMetadata;

            console.log(`✓ Imported IR: ${irName} (source: ${sourceId}, receiver: ${receiverId})`);
          } catch (error) {
            console.error(`Failed to import IR ${irFilename}:`, error);
          }
        }

        if (importedIRMetadataList.length > 0) {
          const importedIds = importedIRMetadataList.map(metadata => metadata.id);

          console.log('[AcousticsTab] Built source-receiver IR mapping:', sourceReceiverMapping);

          // Fetch and display acoustic metrics from results JSON
          let resultsText = 'Simulation Complete!\n\n';
          resultsText += `Generated ${result.ir_files.length} impulse response(s)\n`;

          try {
            const jsonResponse = await fetch(
              `http://localhost:8000/pyroomacoustics/get-result-file/${result.simulation_id}/json`
            );

            if (jsonResponse.ok) {
              const jsonData = await jsonResponse.json();

              if (jsonData.results && Array.isArray(jsonData.results) && jsonData.results.length > 0) {
                // Calculate average acoustic parameters across all source-receiver pairs
                const allParams = jsonData.results
                  .filter((r: any) => r.acoustic_parameters)
                  .map((r: any) => r.acoustic_parameters);

                if (allParams.length > 0) {
                  const average = (key: string) => {
                    const values = allParams.map((p: any) => p[key]).filter((v: any) => v !== undefined && !isNaN(v));
                    return values.length > 0 ? values.reduce((a: number, b: number) => a + b, 0) / values.length : null;
                  };

                  const rt60 = average('rt60');
                  const edt = average('edt');
                  const d50 = average('d50');
                  const c80 = average('c80');

                  resultsText += 'Acoustic Metrics:\n';
                  const metrics = [];
                  if (rt60 !== null) metrics.push(`RT60: ${rt60.toFixed(2)}s`);
                  if (edt !== null) metrics.push(`EDT: ${edt.toFixed(2)}s`);
                  if (d50 !== null) metrics.push(`D50: ${(d50 * 100).toFixed(1)}%`);
                  if (c80 !== null) metrics.push(`C80: ${c80.toFixed(1)} dB`);

                  if (metrics.length > 0) {
                    resultsText += metrics.join(', ') + '\n';
                  }
                }
              }
            }
          } catch (error) {
            console.error('Failed to fetch acoustic metrics:', error);
          }

          resultsText += `\n✓ ${importedIRMetadataList.length} of ${result.ir_files.length} impulse response(s) imported to library\n`;

          onProgress({
            importedIRIds: importedIds,
            sourceReceiverIRMapping: sourceReceiverMapping,
            simulationResults: resultsText,
            isRunning: false,
            status: 'Complete!',
            currentSimulationId: result.simulation_id,
            state: 'completed'
          });

          if (onIRImported) {
            onIRImported();
          }
        } else {
          onProgress({
            isRunning: false,
            status: 'Complete!',
            currentSimulationId: result.simulation_id,
            state: 'completed',
            simulationResults: `Simulation Complete!\n\nGenerated ${result.ir_files.length} impulse response(s)\n\n⚠ Failed to import impulse responses\n`
          });
        }
      } else {
        onProgress({
          isRunning: false,
          status: 'Complete!',
          currentSimulationId: result.simulation_id,
          state: 'completed',
          simulationResults: 'Simulation completed but no IR files generated.'
        });
      }
    } catch (error) {
      onProgress({
        isRunning: false,
        error: error instanceof Error ? error.message : 'Simulation failed'
      });
    }
  }, [simulationConfigs, onIRImported]);

  // Handle simulation execution
  const handleRunSimulation = useCallback(async (index: number) => {
    if (!modelFile || !receivers || !soundscapeData) return;

    const config = simulationConfigs[index];
    if (!config) return;

    const instanceId = config.simulationInstanceId || config.id;

    // Set initial running state immediately for UI feedback
    handleUpdateConfig(index, {
      isRunning: true,
      state: 'running',
      status: 'Calculating...',
      error: null
    } as any);

    // Create progress updater
    const updateProgress = (updates: any) => {
      handleUpdateConfig(index, updates as any);
    };

    if (config.mode === 'choras') {
      await runChorasSimulation(
        instanceId,
        modelFile,
        config.name,
        receivers,
        soundscapeData,
        updateProgress
      );
    } else if (config.mode === 'pyroomacoustics') {
      await runPyroomSimulation(
        instanceId,
        modelFile,
        config.name,
        receivers,
        soundscapeData,
        updateProgress
      );
    }
  }, [modelFile, receivers, soundscapeData, simulationConfigs, handleUpdateConfig, runChorasSimulation, runPyroomSimulation]);

  // Handle simulation cancellation
  const handleCancelSimulation = useCallback(async (index: number) => {
    const config = simulationConfigs[index];
    if (!config) return;

    if (config.mode === 'choras') {
      // Cancel via API directly
      const currentSimulationId = (config as any).currentSimulationId;
      if (currentSimulationId) {
        try {
          await apiService.cancelChorasSimulation(currentSimulationId);
        } catch (error) {
          console.error('Failed to cancel simulation:', error);
        }
      }
      
      handleUpdateConfig(index, {
        isRunning: false,
        state: 'idle',
        status: 'Simulation cancelled by user',
        progress: 0,
        currentSimulationId: null,
        currentSimulationRunId: null
      } as any);
    }
    // Pyroomacoustics doesn't support cancellation yet
  }, [simulationConfigs, handleUpdateConfig]);

  // Load materials for material assignment UI
  const [chorasMaterials, setChorasMaterials] = useState<any[]>([]);
  const [pyroomMaterials, setPyroomMaterials] = useState<any[]>([]);

  useEffect(() => {
    // Load Choras materials
    apiService.getChorasMaterials().then(materials => {
      setChorasMaterials(materials);
    }).catch(console.error);

    // Load Pyroomacoustics materials
    apiService.getPyroomacousticsMaterials().then(materials => {
      setPyroomMaterials(materials);
    }).catch(console.error);
  }, []);

  // Prepare materials based on active simulation mode
  const availableMaterials = useMemo(() => {
    if (activeSimulationIndex === null) return [];
    
    const activeConfig = simulationConfigs[activeSimulationIndex];
    if (!activeConfig) return [];
    
    if (activeConfig.mode === 'resonance') {
      // Return empty for now - Resonance uses its own material system
      return [];
    } else if (activeConfig.mode === 'choras') {
      return chorasMaterials.map(mat => ({
        id: `choras_${mat.id}`,
        name: mat.name
      }));
    } else {
      return pyroomMaterials.map(mat => ({
        id: `pyroom_${mat.id}`,
        name: mat.name
      }));
    }
  }, [activeSimulationIndex, simulationConfigs, chorasMaterials, pyroomMaterials]);

  // Handle material assignments independently per simulation
  const handleMaterialAssignment = useCallback((selection: SelectedGeometry, material: AcousticMaterial | null) => {
    // Call the parent callback
    if (onAssignMaterial) {
      onAssignMaterial(selection, material);
    }

    // Store material assignments in the active simulation config
    if (activeSimulationIndex !== null) {
      const activeConfig = simulationConfigs[activeSimulationIndex];
      if (!activeConfig) return;
      
      const materialId = material ? (
        material.id.startsWith('choras_') ? material.id.substring(7) :
        material.id.startsWith('pyroom_') ? material.id.substring(7) :
        material.id
      ) : null;

      // Get face indices for this selection
      const faceIndices: number[] = [];
      if (selection.type === 'face' && selection.faceIndex !== undefined) {
        faceIndices.push(selection.faceIndex);
      } else if (selection.type === 'entity' && selection.entityIndex !== undefined && geometryData) {
        const faceEntityMap = geometryData.face_entity_map || [];
        geometryData.faces.forEach((_, faceIdx) => {
          if (faceEntityMap[faceIdx] === selection.entityIndex) {
            faceIndices.push(faceIdx);
          }
        });
      } else if (selection.type === 'global' && geometryData) {
        geometryData.faces.forEach((_, faceIdx) => faceIndices.push(faceIdx));
      }

      // Update the simulation config's material assignments
      if (faceIndices.length > 0) {
        if (activeConfig.mode === 'choras') {
          // Choras uses a single global material for all surfaces
          // Store it in settings.selectedMaterialId
          const updatedSettings = {
            ...(activeConfig as any).settings,
            selectedMaterialId: materialId
          };
          
          // Also update faceToMaterialMap to persist visual state across tab switches
          const updatedMap = new Map((activeConfig as any).faceToMaterialMap);
          faceIndices.forEach(faceIdx => {
            if (materialId) {
              updatedMap.set(faceIdx, materialId);
            } else {
              updatedMap.delete(faceIdx);
            }
          });
          
          handleUpdateConfig(activeSimulationIndex, { 
            settings: updatedSettings,
            faceToMaterialMap: updatedMap
          } as any);
        } else {
          // Pyroomacoustics uses per-face material assignments
          const updatedMap = new Map((activeConfig as any).faceToMaterialMap);
          
          faceIndices.forEach(faceIdx => {
            if (materialId) {
              updatedMap.set(faceIdx, materialId);
            } else {
              updatedMap.delete(faceIdx);
            }
          });

          handleUpdateConfig(activeSimulationIndex, { faceToMaterialMap: updatedMap } as any);
        }
      }
    }
  }, [onAssignMaterial, activeSimulationIndex, simulationConfigs, geometryData, handleUpdateConfig]);

  // Auto-select simulation's IR when activating a completed simulation tab
  useEffect(() => {
    if (!onAudioRenderingModeChange || !onSelectIRFromLibrary) return;

    if (activeSimulationIndex === null) {
      // No simulation active -> anechoic mode
      if (audioRenderingMode !== 'anechoic') {
        onAudioRenderingModeChange('anechoic');
      }
    } else {
      const activeConfig = simulationConfigs[activeSimulationIndex];
      if (!activeConfig) return;

      if (activeConfig.mode === 'resonance') {
        // Resonance Audio mode
        if (audioRenderingMode !== 'resonance') {
          onAudioRenderingModeChange('resonance');
        }
      } else {
        // Choras or Pyroomacoustics - check if simulation completed
        const simConfig = activeConfig as any;
        if (simConfig.state === 'completed' && simConfig.importedIRMetadata) {
          // Auto-select the simulation's IR (this will stop audio and apply the IR)
          const currentSelectedId = selectedIRId;
          const simulationIRId = simConfig.importedIRMetadata.id;
          
          // Only select if it's different from currently selected
          if (currentSelectedId !== simulationIRId) {
            console.log('[AcousticsTab] Auto-selecting simulation IR:', simConfig.importedIRMetadata.name);
            onSelectIRFromLibrary(simConfig.importedIRMetadata).catch(err => {
              console.error('[AcousticsTab] Failed to auto-select simulation IR:', err);
            });
          } else if (audioRenderingMode !== 'precise') {
            // IR already selected, just ensure we're in precise mode
            onAudioRenderingModeChange('precise');
          }
        }
      }
    }
  }, [activeSimulationIndex, simulationConfigs, audioRenderingMode, onAudioRenderingModeChange, onSelectIRFromLibrary, selectedIRId]);

  return (
    <AcousticsSection
      simulationConfigs={simulationConfigs}
      activeSimulationIndex={activeSimulationIndex}
      onAddConfig={handleAddConfig}
      onRemoveConfig={handleRemoveConfig}
      onUpdateConfig={handleUpdateConfig}
      onSetActiveSimulation={handleSetActiveSimulation}
      onUpdateSimulationName={handleUpdateSimulationName}
      onRunSimulation={handleRunSimulation}
      onCancelSimulation={handleCancelSimulation}
      modelFile={modelFile}
      geometryData={geometryData}
      receivers={receivers}
      soundscapeData={soundscapeData}
      availableMaterials={availableMaterials}
      modelEntities={modelEntities}
      modelType={modelType}
      selectedGeometry={selectedGeometry}
      onSelectGeometry={onSelectGeometry}
      onAssignMaterial={handleMaterialAssignment}
      resonanceAudioConfig={resonanceAudioConfig}
      onToggleResonanceAudio={onToggleResonanceAudio}
      onUpdateRoomMaterials={onUpdateRoomMaterials}
      hasGeometry={hasGeometry}
      showBoundingBox={showBoundingBox}
      onToggleBoundingBox={onToggleBoundingBox}
      onRefreshBoundingBox={onRefreshBoundingBox}
      onIRImported={onIRImported}
      irRefreshTrigger={irRefreshTrigger}
      onSelectIRFromLibrary={onSelectIRFromLibrary}
      onClearIR={onClearIR}
      selectedIRId={selectedIRId}
      auralizationConfig={auralizationConfig}
      isPlacingReceiver={isPlacingReceiver}
      onStartPlacingReceiver={onStartPlacingReceiver}
      onDeleteReceiver={onDeleteReceiver}
      onUpdateReceiverName={onUpdateReceiverName}
      onGoToReceiver={onGoToReceiver}
    />
  );
}
