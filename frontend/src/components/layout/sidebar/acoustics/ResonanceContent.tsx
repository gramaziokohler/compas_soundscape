/**
 * ResonanceContent Component
 * 
 * Renders Resonance Audio controls for a simulation card.
 */

'use client';

import { ResonanceAudioControls } from '@/components/layout/sidebar/acoustics/ResonanceAudioControls';
import type { RoomScale } from '@/components/layout/sidebar/acoustics/ResonanceAudioControls';
import type { ResonanceSimulationConfig } from '@/types/acoustics';
import type { ResonanceAudioConfig } from '@/types/audio';

interface ResonanceContentProps {
  config: ResonanceSimulationConfig;
  resonanceAudioConfig: ResonanceAudioConfig;
  onToggleResonanceAudio: (enabled: boolean) => void;
  onUpdateRoomMaterials: (materials: any) => void;
  hasGeometry?: boolean;
  showBoundingBox?: boolean;
  onToggleBoundingBox?: (show: boolean) => void;
  onRefreshBoundingBox?: () => void;
  roomScale?: RoomScale;
  onRoomScaleChange?: (scale: RoomScale) => void;
}

export function ResonanceContent({
  config,
  resonanceAudioConfig,
  onToggleResonanceAudio,
  onUpdateRoomMaterials,
  hasGeometry,
  showBoundingBox ,
  onToggleBoundingBox,
  onRefreshBoundingBox,
  roomScale,
  onRoomScaleChange
}: ResonanceContentProps) {
  return (
    <ResonanceAudioControls
      config={resonanceAudioConfig}
      onToggle={onToggleResonanceAudio}
      onUpdateRoomMaterials={onUpdateRoomMaterials}
      hasGeometry={hasGeometry}
      showBoundingBox={showBoundingBox}
      onToggleBoundingBox={onToggleBoundingBox!}
      onRefreshBoundingBox={onRefreshBoundingBox}
      roomScale={roomScale}
      onRoomScaleChange={onRoomScaleChange}
    />
  );
}
