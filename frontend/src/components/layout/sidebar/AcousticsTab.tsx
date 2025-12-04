/**
 * AcousticsTab Component
 *
 * Combines Receivers, IR Library, Spatial Mode Selection, and Choras Simulation sections.
 *
 * Modes:
 * - No Acoustics: Dry signal only (no room acoustics)
 * - ShoeBox Acoustics: Real-time HRTF-based spatial audio with room acoustics
 * - Precise Acoustics: Choras simulation with material assignment
 */

import { ReceiversSection } from './ReceiversSection';
import { ImpulseResponseUpload } from '@/components/audio/ImpulseResponseUpload';
import { ResonanceAudioControls } from '@/components/controls/ResonanceAudioControls';
import { AudioRenderingModeSelector, type AudioRenderingMode } from '@/components/audio/AudioRenderingModeSelector';
import { MaterialAssignmentUI } from '@/components/acoustics/MaterialAssignmentUI';
import { ChorasSimulationSection } from '@/components/acoustics/ChorasSimulationSection';
import { useChorasSimulation } from '@/hooks/useChorasSimulation';
import type { ReceiverData, CompasGeometry, EntityData, SoundEvent } from '@/types';
import type { ImpulseResponseMetadata, ResonanceAudioConfig, ResonanceRoomMaterial, AuralizationConfig } from '@/types/audio';
import type { SelectedGeometry, AcousticMaterial } from '@/types/materials';
import { UI_COLORS } from '@/lib/constants';

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
  // Load Choras materials and simulation results for Material Assignment UI
  const { state: chorasState } = useChorasSimulation(onIRImported);

  // Convert Choras materials to AcousticMaterial format
  const availableMaterials: AcousticMaterial[] = chorasState.materials.map(mat => ({
    id: mat.id.toString(),
    name: mat.name
  }));
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
                onAssignMaterial={onAssignMaterial!}
                availableMaterials={availableMaterials}
              />
            </div>
          )}

          {/* Choras Acoustic Simulation Settings */}
          <ChorasSimulationSection
            geometryData={geometryData}
            modelFile={modelFile}
            receivers={receivers}
            soundscapeData={soundscapeData}
            onIRImported={onIRImported}
          />

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
              simulationResults={chorasState.simulationResults}
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
