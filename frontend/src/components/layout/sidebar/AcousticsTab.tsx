/**
 * AcousticsTab Component
 *
 * Combines Receivers, IR Library, Spatial Mode Selection, and Output Decoder sections.
 * This component organizes acoustic-related features in the sidebar.
 *
 * Sections:
 * - Receivers: Create and manage receiver spheres
 * - IR Library: Upload, browse, and select impulse responses
 * - Spatial Mode Selector: Toggle between Flat Anechoic and ShoeBox Acoustics (No IR only)
 * - ShoeBox Acoustics: Real-time HRTF-based spatial audio with room acoustics
 * - Output Decoder: Choose between Binaural (HRTF) and Stereo Speakers
 *
 * Architecture:
 * - Follows modular component pattern
 * - Delegates to specialized section components
 * - Maintains consistent styling with other tabs
 */

import { ReceiversSection } from './ReceiversSection';
import { ImpulseResponseUpload } from '@/components/audio/ImpulseResponseUpload';
import { ResonanceAudioControls } from '@/components/controls/ResonanceAudioControls';
import { AudioRenderingModeSelector, type AudioRenderingMode } from '@/components/audio/AudioRenderingModeSelector';
import type { ReceiverData } from '@/types';
import type { ImpulseResponseMetadata, ResonanceAudioConfig, ResonanceRoomMaterial, AuralizationConfig } from '@/types/audio';
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

  // Audio Orchestrator props (NEW)
  audioRenderingMode?: AudioRenderingMode;
  onAudioRenderingModeChange?: (mode: AudioRenderingMode) => void;
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
  audioRenderingMode = 'basic_mixer',
  onAudioRenderingModeChange
}: AcousticsTabProps) {
  const hasIR = auralizationConfig.impulseResponseBuffer !== null;

  return (
    <div className="flex flex-col gap-6">
      {/* Receivers Section */}
      <ReceiversSection
        receivers={receivers}
        isPlacingReceiver={isPlacingReceiver}
        onStartPlacingReceiver={onStartPlacingReceiver}
        onDeleteReceiver={onDeleteReceiver}
        onUpdateReceiverName={onUpdateReceiverName}
      />

      {/* IR Library Management */}
      <div className="flex flex-col gap-3">
        <h4 className="text-xs font-semibold" style={{ color: UI_COLORS.NEUTRAL_700 }}>
          IMPULSE RESPONSE LIBRARY
        </h4>
        <ImpulseResponseUpload
          onSelectIR={onSelectIRFromLibrary}
          onClearIR={onClearIR}
          selectedIRId={selectedIRId}
          auralizationConfig={auralizationConfig}
        />
      </div>

      {/* Audio Rendering Mode Selector - Only show when no IR is loaded */}
      {!hasIR && onAudioRenderingModeChange && (
        <div className="flex flex-col gap-3">
          <AudioRenderingModeSelector
            currentMode={audioRenderingMode}
            onModeChange={onAudioRenderingModeChange}
          />
        </div>
      )}

      {/* Resonance Audio Controls - Only show when no IR is loaded AND Resonance mode is selected */}
      {!hasIR && audioRenderingMode === 'resonance' && (
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
    </div>
  );
}
