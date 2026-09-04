'use client';

import React from 'react';
import { ResonanceAudioMaterialUI } from '@/components/acoustics/ResonanceAudioMaterialUI';
import { ToggleField } from '@/components/ui/ToggleField';
import { RefreshIcon } from '@/components/ui/Icon';
import type { ResonanceAudioConfig, ResonanceRoomMaterial } from '@/types/audio';

export interface RoomScale {
  x: number;
  y: number;
  z: number;
}

interface ResonanceAudioControlsProps {
  config: ResonanceAudioConfig | null;
  onToggle: (enabled: boolean) => void;
  onUpdateRoomMaterials: (materials: ResonanceRoomMaterial) => void;
  hasGeometry: boolean; // Whether a 3D model is loaded
  showBoundingBox: boolean;
  onToggleBoundingBox: (show: boolean) => void;
  onRefreshBoundingBox?: () => void; // Refresh bounding box from sound sources
  roomScale?: RoomScale;
  onRoomScaleChange?: (scale: RoomScale) => void;
  className?: string;
}

/**
 * ShoeBox Acoustics Controls
 *
 * UI for controlling Google Resonance Audio spatial audio engine (ShoeBox Acoustics).
 *
 * Features:
 * - Enable/disable toggle
 * - Room material selection per surface (6 walls)
 * - Bounding box visualization toggle with refresh
 */
export function ResonanceAudioControls({
  config,
  onToggle,
  onUpdateRoomMaterials,
  hasGeometry,
  showBoundingBox,
  onToggleBoundingBox,
  onRefreshBoundingBox,
  roomScale = { x: 1, y: 1, z: 1 },
  onRoomScaleChange,
  className = ''
}: ResonanceAudioControlsProps) {
  const enabled = config?.enabled ?? false;
  const materials = config?.roomMaterials ?? {
    left: 'transparent',
    right: 'transparent',
    front: 'transparent',
    back: 'transparent',
    down: 'transparent',
    up: 'transparent'
  };

  return (
    <div className={`card-stack min-w-0 ${className}`}>
      {/* Bounding Box Visualization Toggle */}
      {enabled && (
        <div className="flex items-center justify-between gap-1">
          <ToggleField
            className="flex-1 min-w-0"
            checked={showBoundingBox}
            onChange={onToggleBoundingBox}
            label="Show Bounding Box"
          />
          {!hasGeometry && onRefreshBoundingBox && (
            <button
              onClick={onRefreshBoundingBox}
              className="w-6 h-6 flex-shrink-0 flex items-center justify-center rounded-md text-secondary-hover hover:text-foreground hover:bg-secondary-light transition-all cursor-pointer"
              title="Reset bounding box to original size"
            >
              <RefreshIcon size="0.8rem" />
            </button>
          )}
        </div>
      )}

      {/* Surface Materials */}
      {enabled && (
        <ResonanceAudioMaterialUI
          materials={materials}
          onUpdateMaterials={onUpdateRoomMaterials}
        />
      )}
    </div>
  );
}
