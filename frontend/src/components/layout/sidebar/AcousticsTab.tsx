/**
 * AcousticsTab Component
 *
 * Combines Receivers, IR Library, and Spatial Mode Selection sections.
 *
 * Modes:
 * - No Acoustics: Dry signal only (no room acoustics)
 * - ShoeBox Acoustics: Real-time HRTF-based spatial audio with room acoustics
 * - Precise Acoustics: User-uploaded impulse response convolution
 *
 * IR Library is only visible in Precise Acoustics mode.
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
  audioRenderingMode = 'anechoic',
  onAudioRenderingModeChange
}: AcousticsTabProps) {
  return (
    <div className="flex flex-col gap-6">

      {/* Audio Rendering Mode Selector */}
      {onAudioRenderingModeChange && (
        <div className="flex flex-col gap-3">
          <AudioRenderingModeSelector
            currentMode={audioRenderingMode}
            onModeChange={onAudioRenderingModeChange}
          />
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

      {/* IR Library Management - Only show in Precise Acoustics mode */}
      {audioRenderingMode === 'precise' && (
        <div className="flex flex-col gap-3">
          <h4 className="text-xs font-semibold" style={{ color: UI_COLORS.NEUTRAL_700 }}>
            Impulse Response Library
          </h4>
          <ImpulseResponseUpload
            onSelectIR={onSelectIRFromLibrary}
            onClearIR={onClearIR}
            selectedIRId={selectedIRId}
            auralizationConfig={auralizationConfig}
          />
        </div>
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
