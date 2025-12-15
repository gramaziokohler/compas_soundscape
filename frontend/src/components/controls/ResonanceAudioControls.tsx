'use client';

import React, { useMemo } from 'react';
import type { ResonanceAudioConfig, ResonanceRoomMaterial } from '@/types/audio';
import { UI_COLORS } from '@/lib/constants';
import { ResonanceAudioMaterialUI } from '@/components/acoustics/ResonanceAudioMaterialUI';

interface ResonanceAudioControlsProps {
  config: ResonanceAudioConfig | null;
  onToggle: (enabled: boolean) => void;
  onUpdateRoomMaterials: (materials: ResonanceRoomMaterial) => void;
  hasGeometry: boolean; // Whether a 3D model is loaded
  showBoundingBox: boolean;
  onToggleBoundingBox: (show: boolean) => void;
  onRefreshBoundingBox?: () => void; // Refresh bounding box from sound sources
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

  const handleToggle = () => {
    onToggle(!enabled);
  };

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      {/* Header with Title */}
      <h4 className="text-xs font-semibold" style={{ color: UI_COLORS.NEUTRAL_700 }}>
        SHOEBOX ACOUSTICS SETTINGS
      </h4>

      {/* Info when no geometry */}
      {!hasGeometry && (
        <div className="text-xs p-2 rounded" style={{
          backgroundColor: '#EFF6FF',
          color: '#1E40AF',
          border: '1px solid #BFDBFE'
        }}>
          ℹ️ No 3D model loaded. Room will be auto-calculated from sound source positions.
        </div>
      )}

      {/* Bounding Box Visualization Toggle */}
      {enabled && (
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="show-bbox"
            checked={showBoundingBox}
            onChange={(e) => onToggleBoundingBox(e.target.checked)}
            className="w-4 h-4 rounded border-gray-300"
            style={{ accentColor: UI_COLORS.PRIMARY }}
          />
          <label 
            htmlFor="show-bbox" 
            className="text-xs cursor-pointer flex-1"
            style={{ color: UI_COLORS.NEUTRAL_700 }}
          >
            Show Room Bounding Box
          </label>
          {!hasGeometry && onRefreshBoundingBox && (
            <button
              onClick={onRefreshBoundingBox}
              className="p-1 rounded hover:bg-gray-200 transition-colors"
              title="Refresh bounding box from sound sources"
              style={{ color: UI_COLORS.NEUTRAL_600 }}
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
          <h4 className="text-xs font-semibold" style={{ color: UI_COLORS.NEUTRAL_700 }}>
            Surface Materials
          </h4>
          <ResonanceAudioMaterialUI
            materials={materials}
            onUpdateMaterials={onUpdateRoomMaterials}
          />
        </div>
      )}

      {/* Info Note */}
      {enabled && (
        <div 
          className="text-xs p-2 rounded" 
          style={{ 
            backgroundColor: UI_COLORS.NEUTRAL_100,
            color: UI_COLORS.NEUTRAL_600 
          }}
        >
          💡 Room dimensions are automatically calculated from your 3D model's bounding box.
        </div>
      )}
    </div>
  );
}
