/**
 * ResonanceAudioMaterialUI Component
 *
 * Material assignment UI for Resonance Audio (ShoeBox acoustics).
 * Allows assigning materials to the 6 faces of the room with cascading inheritance.
 *
 * Hierarchy:
 * - All faces (global)
 *   - Left
 *   - Right
 *   - Front
 *   - Back
 *   - Floor (down)
 *   - Ceiling (up)
 */

'use client';

import { useState, useMemo } from 'react';
import { UI_COLORS, RESONANCE_AUDIO } from '@/utils/constants';
import type { ResonanceRoomMaterial } from '@/types/audio';

interface ResonanceAudioMaterialUIProps {
  materials: ResonanceRoomMaterial;
  onUpdateMaterials: (materials: ResonanceRoomMaterial) => void;
}

type RoomFace = 'left' | 'right' | 'front' | 'back' | 'down' | 'up';

const FACE_LABELS: Record<RoomFace, string> = {
  left: 'Left',
  right: 'Right',
  front: 'Front',
  back: 'Back',
  down: 'Floor',
  up: 'Ceiling'
};

const FACE_ORDER: RoomFace[] = ['left', 'right', 'front', 'back', 'down', 'up'];

/**
 * Get color based on absorption coefficient using gradient from constants
 * 0 = teal (low absorption/reflective), 1 = orange (high absorption)
 */
const getAbsorptionColor = (absorption: number): string => {
  // Parse gradient colors from constants
  const startColor = UI_COLORS.MATERIAL_GRADIENT_START; // #14b8a6 (teal)
  const endColor = UI_COLORS.MATERIAL_GRADIENT_END; // #f97316 (orange)

  // Extract RGB components
  const start = {
    r: parseInt(startColor.substring(1, 3), 16),
    g: parseInt(startColor.substring(3, 5), 16),
    b: parseInt(startColor.substring(5, 7), 16)
  };

  const end = {
    r: parseInt(endColor.substring(1, 3), 16),
    g: parseInt(endColor.substring(3, 5), 16),
    b: parseInt(endColor.substring(5, 7), 16)
  };

  // Interpolate between start and end based on absorption
  const r = Math.round(start.r + (end.r - start.r) * absorption);
  const g = Math.round(start.g + (end.g - start.g) * absorption);
  const b = Math.round(start.b + (end.b - start.b) * absorption);

  return `rgb(${r}, ${g}, ${b})`;
};

export function ResonanceAudioMaterialUI({
  materials,
  onUpdateMaterials
}: ResonanceAudioMaterialUIProps) {
  const [expandedAll, setExpandedAll] = useState(true);

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

    return options.sort((a, b) => {
      const absA = RESONANCE_AUDIO.MATERIAL_ABSORPTION[a.value] || 0;
      const absB = RESONANCE_AUDIO.MATERIAL_ABSORPTION[b.value] || 0;
      return absA - absB;
    });
  }, []);

  // Check if all faces have the same material
  const allFacesMaterial = useMemo(() => {
    const firstMaterial = materials.left;
    const allSame = FACE_ORDER.every(face => materials[face] === firstMaterial);
    return allSame ? firstMaterial : null;
  }, [materials]);

  // Get display label and color for a material
  const getMaterialDisplay = (materialValue: string) => {
    const option = materialOptions.find(opt => opt.value === materialValue);
    const absorption = RESONANCE_AUDIO.MATERIAL_ABSORPTION[materialValue] || 0;
    const color = getAbsorptionColor(absorption);
    return {
      label: option?.label || materialValue,
      absorption,
      color
    };
  };

  // Handle "All faces" material change
  const handleAllFacesChange = (value: string) => {
    // Apply to all faces
    onUpdateMaterials({
      left: value,
      right: value,
      front: value,
      back: value,
      down: value,
      up: value
    });
  };

  // Handle individual face material change
  const handleFaceChange = (face: RoomFace, value: string) => {
    onUpdateMaterials({
      ...materials,
      [face]: value
    });
  };

  // Get background color for a select dropdown
  const getSelectBackgroundColor = (materialValue: string) => {
    const absorption = RESONANCE_AUDIO.MATERIAL_ABSORPTION[materialValue] || 0;
    return getAbsorptionColor(absorption);
  };

  // Render "All faces" display label
  const allFacesDisplay = allFacesMaterial
    ? getMaterialDisplay(allFacesMaterial).label
    : 'various';

  const allFacesColor = allFacesMaterial
    ? getSelectBackgroundColor(allFacesMaterial)
    : UI_COLORS.NEUTRAL_400;

  return (
    <div className="flex flex-col gap-1 text-xs w-full overflow-hidden">
      {/* All Faces Root */}
      <div className="flex flex-col w-full">
        <div className="flex items-center gap-1 p-0 rounded w-full min-w-0">
          <button
            onClick={() => setExpandedAll(!expandedAll)}
            className="flex items-center justify-center w-4 h-4 shrink-0"
          >
            {expandedAll ? '▼' : '▶'}
          </button>
          <span className="font-medium shrink-0 w-16">All faces</span>
          <select
            value={allFacesMaterial || 'various'}
            onChange={(e) => {
              if (e.target.value !== 'various') {
                handleAllFacesChange(e.target.value);
              }
            }}
            className="flex-1 min-w-0 text-xs px-2 py-1 text-white rounded focus:outline-none focus:ring-1 focus:ring-white"
            style={{
              backgroundColor: allFacesColor,
              borderRadius: '8px'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {!allFacesMaterial && (
              <option value="various" style={{ backgroundColor: UI_COLORS.NEUTRAL_400 }}>various</option>
            )}
            {materialOptions.map((opt) => {
              const display = getMaterialDisplay(opt.value);
              return (
                <option
                  key={opt.value}
                  value={opt.value}
                  style={{ backgroundColor: display.color }}
                >
                  {opt.label} ({(display.absorption * 100).toFixed(0)}% abs)
                </option>
              );
            })}
          </select>
        </div>

        {/* Individual Faces */}
        {expandedAll && (
          <div className="ml-0 flex flex-col gap-1 w-full">
            {FACE_ORDER.map((face) => {
              const faceLabel = FACE_LABELS[face];
              const faceMaterial = materials[face];
              const display = getMaterialDisplay(faceMaterial);

              return (
                <div
                  key={face}
                  className="flex items-center gap-2 p-2 rounded w-full min-w-0"
                >
                  <span className="shrink-0 w-16 ml-2">{faceLabel}</span>
                  <select
                    value={faceMaterial}
                    onChange={(e) => handleFaceChange(face, e.target.value)}
                    className="flex-1 min-w-0 text-xs px-2 py-1 text-white rounded focus:outline-none focus:ring-1 focus:ring-white"
                    style={{
                      backgroundColor: display.color,
                      borderRadius: '8px'
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {materialOptions.map((opt) => {
                      const optDisplay = getMaterialDisplay(opt.value);
                      return (
                        <option
                          key={opt.value}
                          value={opt.value}
                          style={{ backgroundColor: optDisplay.color }}
                        >
                          {opt.label} ({(optDisplay.absorption * 100).toFixed(0)}% abs)
                        </option>
                      );
                    })}
                  </select>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
