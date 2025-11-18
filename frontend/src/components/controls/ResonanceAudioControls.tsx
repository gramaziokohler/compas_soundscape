'use client';

import React, { useMemo, useState } from 'react';
import type { ResonanceAudioConfig, ResonanceRoomMaterial } from '@/types/audio';
import { RESONANCE_AUDIO, UI_COLORS } from '@/lib/constants';

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
 * Get color based on absorption coefficient
 * 0 = transparent (white), 1 = primary color (cyan/blue)
 */
const getAbsorptionColor = (absorption: number): string => {
  // Interpolate from white (low absorption) to cyan (high absorption)
  const r = Math.round(255 * (1 - absorption));
  const g = Math.round(255 * (1 - absorption * 0.3));
  const b = 255;
  return `rgb(${r}, ${g}, ${b})`;
};

/**
 * Custom Material Dropdown Component
 * Native <select> doesn't support gradient backgrounds, so we build a custom one
 */
interface MaterialDropdownProps {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}

function MaterialDropdown({ value, options, onChange }: MaterialDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const selectedOption = options.find(opt => opt.value === value);
  const selectedAbsorption = RESONANCE_AUDIO.MATERIAL_ABSORPTION[value] || 0;
  const selectedColor = getAbsorptionColor(selectedAbsorption);

  return (
    <div className="relative">
      {/* Selected value display */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full border rounded px-2 py-1.5 text-xs text-left flex items-center justify-between"
        style={{
          borderColor: UI_COLORS.NEUTRAL_300,
          background: `linear-gradient(to right, ${selectedColor} 0%, ${selectedColor} ${selectedAbsorption * 100}%, white ${selectedAbsorption * 100}%)`,
          color: UI_COLORS.NEUTRAL_900
        }}
      >
        <span>{selectedOption?.label} ({(selectedAbsorption * 100).toFixed(0)}% abs)</span>
        <svg 
          width="12" 
          height="12" 
          viewBox="0 0 12 12" 
          fill="none" 
          style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}
        >
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <>
          {/* Backdrop to close dropdown */}
          <div 
            className="fixed inset-0 z-10" 
            onClick={() => setIsOpen(false)}
          />
          
          {/* Options list */}
          <div 
            className="absolute z-20 w-full mt-1 border rounded shadow-lg max-h-60 overflow-y-auto"
            style={{
              backgroundColor: 'white',
              borderColor: UI_COLORS.NEUTRAL_300
            }}
          >
            {options.map(option => {
              const absorption = RESONANCE_AUDIO.MATERIAL_ABSORPTION[option.value] || 0;
              const color = getAbsorptionColor(absorption);
              const isSelected = option.value === value;
              
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    onChange(option.value);
                    setIsOpen(false);
                  }}
                  className="w-full px-2 py-1.5 text-xs text-left hover:opacity-80 transition-opacity"
                  style={{
                    background: `linear-gradient(to right, ${color} 0%, ${color} ${absorption * 100}%, white ${absorption * 100}%)`,
                    color: UI_COLORS.NEUTRAL_900,
                    fontWeight: isSelected ? 'bold' : 'normal'
                  }}
                >
                  {option.label} ({(absorption * 100).toFixed(0)}% abs)
                  {isSelected && ' ✓'}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
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
  const materials = config?.roomMaterials ?? RESONANCE_AUDIO.DEFAULT_ROOM_MATERIALS;

  // Sort materials by absorption coefficient (low to high)
  const materialOptions = useMemo(() => {
    const options = [
      { value: 'transparent', label: 'Open (No Reflection)' },
      { value: 'acoustic-ceiling-tiles', label: 'Acoustic Tiles' },
      { value: 'brick-bare', label: 'Brick (Bare)' },
      { value: 'brick-painted', label: 'Brick (Painted)' },
      { value: 'concrete-block-coarse', label: 'Concrete (Coarse)' },
      { value: 'concrete-block-painted', label: 'Concrete (Painted)' },
      { value: 'curtain-heavy', label: 'Curtain (Heavy)' },
      { value: 'fiber-glass-insulation', label: 'Fiberglass Insulation' },
      { value: 'glass-thin', label: 'Glass (Thin)' },
      { value: 'glass-thick', label: 'Glass (Thick)' },
      { value: 'grass', label: 'Grass' },
      { value: 'linoleum-on-concrete', label: 'Linoleum on Concrete' },
      { value: 'marble', label: 'Marble' },
      { value: 'metal', label: 'Metal' },
      { value: 'parquet-on-concrete', label: 'Parquet on Concrete' },
      { value: 'plaster-rough', label: 'Plaster (Rough)' },
      { value: 'plaster-smooth', label: 'Plaster (Smooth)' },
      { value: 'plywood-panel', label: 'Plywood Panel' },
      { value: 'polished-concrete-or-tile', label: 'Polished Concrete/Tile' },
      { value: 'sheet-rock', label: 'Sheet Rock' },
      { value: 'water-or-ice-surface', label: 'Water/Ice Surface' },
      { value: 'wood-ceiling', label: 'Wood Ceiling' },
      { value: 'wood-panel', label: 'Wood Panel' },
      { value: 'uniform', label: 'Uniform (0.5)' },
    ];

    // Sort by absorption coefficient (low to high)
    return options.sort((a, b) => {
      const absA = RESONANCE_AUDIO.MATERIAL_ABSORPTION[a.value] || 0;
      const absB = RESONANCE_AUDIO.MATERIAL_ABSORPTION[b.value] || 0;
      return absA - absB;
    });
  }, []);

  const handleMaterialChange = (surface: keyof ResonanceRoomMaterial, value: string) => {
    onUpdateRoomMaterials({
      ...materials,
      [surface]: value
    });
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
        <div className="space-y-2">
          <label className="block text-xs font-medium" style={{ color: UI_COLORS.NEUTRAL_700 }}>
            Surface Materials
          </label>
          <div className="space-y-2">
            {(['left', 'right', 'front', 'back', 'down', 'up'] as const).map(surface => (
              <div key={surface}>
                <label 
                  className="block text-xs mb-1 capitalize" 
                  style={{ color: UI_COLORS.NEUTRAL_600 }}
                >
                  {surface === 'down' ? 'Floor' : surface === 'up' ? 'Ceiling' : surface}
                </label>
                <MaterialDropdown
                  value={materials[surface]}
                  options={materialOptions}
                  onChange={(value) => handleMaterialChange(surface, value)}
                />
              </div>
            ))}
          </div>
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
