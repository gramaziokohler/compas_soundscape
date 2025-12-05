/**
 * AcousticsTab Component
 *
 * Combines Receivers, IR Library, Spatial Mode Selection, and Acoustic Simulation sections.
 *
 * Modes:
 * - No Acoustics: Dry signal only (no room acoustics)
 * - ShoeBox Acoustics: Real-time HRTF-based spatial audio with room acoustics
 * - Precise Acoustics: Advanced simulation with Choras (diffusion equation) or Pyroomacoustics (image source method)
 */

import { useState, useCallback, useMemo } from 'react';
import { ReceiversSection } from './ReceiversSection';
import { ImpulseResponseUpload } from '@/components/audio/ImpulseResponseUpload';
import { ResonanceAudioControls } from '@/components/controls/ResonanceAudioControls';
import { AudioRenderingModeSelector, type AudioRenderingMode } from '@/components/audio/AudioRenderingModeSelector';
import { MaterialAssignmentUI } from '@/components/acoustics/MaterialAssignmentUI';
import { ChorasSimulationSection } from '@/components/acoustics/ChorasSimulationSection';
import { PyroomAcousticsSimulationSection } from '@/components/acoustics/PyroomAcousticsSimulationSection';
import { useChorasSimulation } from '@/hooks/useChorasSimulation';
import { usePyroomAcousticsSimulation } from '@/hooks/usePyroomAcousticsSimulation';
import type { ReceiverData, CompasGeometry, EntityData, SoundEvent } from '@/types';
import type { ImpulseResponseMetadata, ResonanceAudioConfig, ResonanceRoomMaterial, AuralizationConfig } from '@/types/audio';
import type { SelectedGeometry, AcousticMaterial } from '@/types/materials';
import { UI_COLORS } from '@/lib/constants';

// Type for precision simulation mode
type PrecisionSimulationMode = 'choras' | 'pyroomacoustics';

interface AcousticsTabProps {
  // Receiver props
  receivers: ReceiverData[];
  isPlacingReceiver: boolean;
  onStartPlacingReceiver: () => void;
  onDeleteReceiver: (id: string) => void;
  onUpdateReceiverName: (id: string, name: string) => void;

  // IR Library props
  onSelectIRFromLibrary: (irMetadata: ImpulseResponseMetadata) => Promise<void>;
  onClearIR: () => void;
  selectedIRId: string | null;
  auralizationConfig: AuralizationConfig;

  // Resonance Audio props
  resonanceAudioConfig: ResonanceAudioConfig;
  onToggleResonanceAudio: (enabled: boolean) => void;
  onUpdateRoomMaterials: (materials: ResonanceRoomMaterial) => void;
  hasGeometry: boolean;
  showBoundingBox: boolean;
  onToggleBoundingBox: (show: boolean) => void;
  onRefreshBoundingBox?: () => void;

  // Audio Orchestrator props
  audioRenderingMode?: AudioRenderingMode;
  onAudioRenderingModeChange?: (mode: AudioRenderingMode) => void;

  // Material Assignment props (legacy - kept for backward compatibility)
  modelEntities?: EntityData[];
  modelType?: '3dm' | 'obj' | 'ifc' | null;
  geometryData?: CompasGeometry | null;
  selectedGeometry?: SelectedGeometry | null;
  onSelectGeometry?: (selection: SelectedGeometry | null) => void;
  onAssignMaterial?: (selection: SelectedGeometry, material: AcousticMaterial | null) => void;

  // Choras Simulation props (NEW)
  modelFile?: File | null;
  soundscapeData?: SoundEvent[] | null;
  onIRImported?: () => void;
  irRefreshTrigger?: number;
}

export function AcousticsTab({
  receivers,
  isPlacingReceiver,
  onStartPlacingReceiver,
  onDeleteReceiver,
  onUpdateReceiverName,
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
  irRefreshTrigger = 0
}: AcousticsTabProps) {
  // State for precision simulation mode selection
  const [precisionMode, setPrecisionMode] = useState<PrecisionSimulationMode>('choras');

  // Load Choras materials and simulation results for Material Assignment UI
  const { state: chorasState } = useChorasSimulation(onIRImported);
  const { state: pyroomState, methods: pyroomMethods } = usePyroomAcousticsSimulation(onIRImported);

  // Convert materials to AcousticMaterial format based on selected mode
  // Add prefix to ensure unique keys across different simulation modes
  // Use useMemo to ensure stable reference
  const availableMaterials: AcousticMaterial[] = useMemo(() => {
    return precisionMode === 'choras'
      ? chorasState.materials.map(mat => ({
          id: `choras_${mat.id}`,
          name: mat.name
        }))
      : pyroomState.materials.map(mat => ({
          id: `pyroom_${mat.id}`,
          name: mat.name
        }));
  }, [precisionMode, chorasState.materials, pyroomState.materials]);

  // Handle material assignment - forward to Pyroomacoustics if in pyroom mode
  const handleMaterialAssignment = useCallback((selection: SelectedGeometry, material: AcousticMaterial | null) => {
    // Call the parent callback
    if (onAssignMaterial) {
      onAssignMaterial(selection, material);
    }

    // If in Pyroomacoustics mode, also update the hook
    if (precisionMode === 'pyroomacoustics' && material) {
      // Remove the 'pyroom_' prefix to get the actual material ID
      const actualMaterialId = material.id.startsWith('pyroom_') 
        ? material.id.substring(7) 
        : material.id;

      // Handle different selection types
      if (selection.type === 'face' && selection.faceIndex !== undefined) {
        pyroomMethods.assignMaterialToFace(selection.faceIndex, actualMaterialId);
      } else if (selection.type === 'entity' && selection.entityIndex !== undefined && geometryData) {
        // Assign to all faces of this entity
        const faces = geometryData.faces;
        const faceEntityMap = geometryData.face_entity_map || [];
        
        faces.forEach((_, faceIdx) => {
          if (faceEntityMap[faceIdx] === selection.entityIndex) {
            pyroomMethods.assignMaterialToFace(faceIdx, actualMaterialId);
          }
        });
      } else if (selection.type === 'layer' && geometryData) {
        // Assign to all faces in this layer
        // Note: Layer implementation depends on how layers map to entities
        // For now, we'll skip this as it requires entity-to-layer mapping
        console.warn('Layer-level material assignment not yet implemented for Pyroomacoustics');
      } else if (selection.type === 'global' && geometryData) {
        // Assign to all faces
        geometryData.faces.forEach((_, faceIdx) => {
          pyroomMethods.assignMaterialToFace(faceIdx, actualMaterialId);
        });
      }
    }
  }, [onAssignMaterial, precisionMode, pyroomMethods, geometryData]);

  // Get current simulation results based on mode
  const currentSimulationResults = precisionMode === 'choras' 
    ? chorasState.simulationResults 
    : pyroomState.simulationResults;
  return (
    <div className="flex flex-col gap-6">

      {/* Audio Rendering Mode Selector */}
      {onAudioRenderingModeChange && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <label className="text-xs" style={{ color: UI_COLORS.NEUTRAL_500 }}>Mode:</label>
            <AudioRenderingModeSelector
              currentMode={audioRenderingMode}
              onModeChange={onAudioRenderingModeChange}
            />
          </div>
        </div>
      )}

      {/* Resonance Audio Controls - Only show in ShoeBox Acoustics mode */}
      {audioRenderingMode === 'resonance' && (
        <ResonanceAudioControls
          config={resonanceAudioConfig}
          onToggle={onToggleResonanceAudio}
          onUpdateRoomMaterials={onUpdateRoomMaterials}
          hasGeometry={hasGeometry}
          showBoundingBox={showBoundingBox}
          onToggleBoundingBox={onToggleBoundingBox}
          onRefreshBoundingBox={onRefreshBoundingBox}
        />
      )}

      {/* Precise Acoustics Mode Content */}
      {audioRenderingMode === 'precise' && (
        <>
          {/* Precision Simulation Mode Selector */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <label className="text-xs" style={{ color: UI_COLORS.NEUTRAL_500 }}>Simulation Software:</label>
              <select
                value={precisionMode}
                onChange={(e) => setPrecisionMode(e.target.value as PrecisionSimulationMode)}
                className="px-3 py-2 rounded text-xs"
                style={{
                  backgroundColor: UI_COLORS.NEUTRAL_100,
                  color: UI_COLORS.NEUTRAL_800,
                  border: `1px solid ${UI_COLORS.NEUTRAL_300}`,
                  borderRadius: '8px'
                }}
              >
                <option value="choras">Choras </option>
                <option value="pyroomacoustics">Pyroomacoustics </option>
              </select>
            </div>
          </div>

          {/* Surface Material Assignment */}
          {onSelectGeometry && onAssignMaterial && (
            <div className="flex flex-col gap-3">
              <h4 className="text-xs font-semibold" style={{ color: UI_COLORS.NEUTRAL_700 }}>
                Surface Materials
              </h4>
              <MaterialAssignmentUI
                modelEntities={modelEntities}
                modelType={modelType}
                geometryData={geometryData}
                selectedGeometry={selectedGeometry || null}
                onSelectGeometry={onSelectGeometry!}
                onAssignMaterial={handleMaterialAssignment}
                availableMaterials={availableMaterials}
              />
            </div>
          )}

          {/* Conditional Simulation Section based on selected mode */}
          {precisionMode === 'choras' ? (
            <ChorasSimulationSection
              geometryData={geometryData}
              modelFile={modelFile}
              receivers={receivers}
              soundscapeData={soundscapeData}
              onIRImported={onIRImported}
            />
          ) : (
            <PyroomAcousticsSimulationSection
              geometryData={geometryData}
              modelFile={modelFile}
              receivers={receivers}
              soundscapeData={soundscapeData}
              onIRImported={onIRImported}
              state={pyroomState}
              methods={pyroomMethods}
            />
          )}

          {/* IR Library Management */}
          <div className="flex flex-col gap-3">
            <h4 className="text-xs font-semibold" style={{ color: UI_COLORS.NEUTRAL_700 }}>
              Impulse Response Library
            </h4>
            <ImpulseResponseUpload
              onSelectIR={onSelectIRFromLibrary}
              onClearIR={onClearIR}
              selectedIRId={selectedIRId}
              auralizationConfig={auralizationConfig}
              simulationResults={currentSimulationResults}
              refreshTrigger={irRefreshTrigger}
            />
          </div>
        </>
      )}

      {/* Receivers Section */}
      <ReceiversSection
        receivers={receivers}
        isPlacingReceiver={isPlacingReceiver}
        onStartPlacingReceiver={onStartPlacingReceiver}
        onDeleteReceiver={onDeleteReceiver}
        onUpdateReceiverName={onUpdateReceiverName}
      />

    </div>
  );
}
