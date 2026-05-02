'use client';

import React, { useMemo, useState } from 'react';
import { ResonanceAudioMaterialUI } from '@/components/acoustics/ResonanceAudioMaterialUI';
import { CheckboxField } from '@/components/ui/CheckboxField';

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
  showBoundingBox ,
  onToggleBoundingBox,
  onRefreshBoundingBox,
  roomScale = { x: 1, y: 1, z: 1 },
  onRoomScaleChange,
  className = ''
}: ResonanceAudioControlsProps) {
  const enabled = config?.enabled ?? false;
  const [isRoomScaleExpanded, setIsRoomScaleExpanded] = useState(false);
  const materials = config?.roomMaterials ?? {
    left: 'transparent',
    right: 'transparent',
    front: 'transparent',
    back: 'transparent',
    down: 'transparent',
    up: 'transparent'
  };

      
  const handleToggle = () => {
    onToggle(!enabled);
  };

  return (
    <div className={`flex flex-col gap-3 ${className}`}>

      {/* Bounding Box Visualization Toggle */}
      {enabled && (
        <div className="flex items-center justify-between gap-2">
           <CheckboxField
              checked={showBoundingBox}
              onChange={onToggleBoundingBox}
              label="Show Room Bounding Box"
            />
          {!hasGeometry && onRefreshBoundingBox && (
            <button
              onClick={onRefreshBoundingBox}
              className="h-5 px-1 rounded hover:bg-secondary-light transition-colors text-neutral-600 flex items-center justify-center"
              title="Reset bounding box to original size"
            >
              <svg 
                width="16" 
                height="16" 
                viewBox="0 0 24 24" 
                fill="none" 
                stroke="currentColor" 
                strokeWidth="2"
                strokeLinecap="round" 
                strokeLinejoin="round"
              >
                <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
              </svg>
            </button>
          )}
        </div>
      )}


      {/* Surface Materials */}
      {enabled && (
        <div className="flex flex-col gap-2">
          {/* <h4 className="text-xs font-semibold" style={{ color: UI_COLORS.NEUTRAL_700 }}>
            Surface Materials
          </h4> */}
          <ResonanceAudioMaterialUI
            materials={materials}
            onUpdateMaterials={onUpdateRoomMaterials}
          />
        </div>
      )}


      {/* {enabled && (
        <div 
          className="text-xs p-2 rounded" 
          style={{ 
            backgroundColor: UI_COLORS.NEUTRAL_100,
            color: UI_COLORS.NEUTRAL_600 
          }}
        >
          💡 Room dimensions are automatically calculated from your 3D model's bounding box.
        </div>
      )} */}
    </div>
  );
}
