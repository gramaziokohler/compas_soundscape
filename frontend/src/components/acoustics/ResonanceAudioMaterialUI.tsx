/**
 * ResonanceAudioMaterialUI Component
 *
 * Material assignment UI for Resonance Audio (ShoeBox acoustics).
 * Allows assigning materials to the 6 faces of the room with cascading inheritance.
 */

'use client';

import { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { MaterialSelect, type MaterialOption } from '@/components/ui/MaterialSelect';
import { RESONANCE_AUDIO } from '@/utils/constants';
import { getMaterialColorByAbsorption } from '@/utils/utils';
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
  up: 'Ceiling',
};

const FACE_ORDER: RoomFace[] = ['left', 'right', 'front', 'back', 'down', 'up'];

const MATERIAL_LABELS: Record<string, string> = {
  transparent: 'Open (No Reflection)',
  'acoustic-ceiling-tiles': 'Acoustic Tiles',
  'brick-bare': 'Brick (Bare)',
  'brick-painted': 'Brick (Painted)',
  'concrete-block-coarse': 'Concrete (Coarse)',
  'concrete-block-painted': 'Concrete (Painted)',
  'curtain-heavy': 'Curtain (Heavy)',
  'fiber-glass-insulation': 'Fiberglass Insulation',
  'glass-thin': 'Glass (Thin)',
  'glass-thick': 'Glass (Thick)',
  grass: 'Grass',
  'linoleum-on-concrete': 'Linoleum on Concrete',
  marble: 'Marble',
  metal: 'Metal',
  'parquet-on-concrete': 'Parquet on Concrete',
  'plaster-rough': 'Plaster (Rough)',
  'plaster-smooth': 'Plaster (Smooth)',
  'plywood-panel': 'Plywood Panel',
  'polished-concrete-or-tile': 'Polished Concrete/Tile',
  'sheet-rock': 'Sheet Rock',
  'water-or-ice-surface': 'Water/Ice Surface',
  'wood-ceiling': 'Wood Ceiling',
  'wood-panel': 'Wood Panel',
  uniform: 'Uniform (0.5)',
};

function buildResonanceMaterialOptions(): MaterialOption[] {
  return Object.entries(RESONANCE_AUDIO.MATERIAL_ABSORPTION)
    .map(([id, absorption]) => ({
      id,
      name: MATERIAL_LABELS[id] ?? id,
      absorption,
    }))
    .sort((a, b) => a.absorption - b.absorption);
}

export function ResonanceAudioMaterialUI({
  materials,
  onUpdateMaterials,
}: ResonanceAudioMaterialUIProps) {
  const [expandedAll, setExpandedAll] = useState(true);

  const sortedMaterials = useMemo(() => buildResonanceMaterialOptions(), []);

  const materialColors = useMemo(() => {
    const colors = new Map<string, string>();
    sortedMaterials.forEach((m) => {
      colors.set(m.id, getMaterialColorByAbsorption(m.absorption));
    });
    return colors;
  }, [sortedMaterials]);

  const allFacesMaterial = useMemo(() => {
    const firstMaterial = materials.left;
    const allSame = FACE_ORDER.every((face) => materials[face] === firstMaterial);
    return allSame ? firstMaterial : null;
  }, [materials]);

  const handleAllFacesChange = (value: string) => {
    if (!value) return;
    onUpdateMaterials({
      left: value,
      right: value,
      front: value,
      back: value,
      down: value,
      up: value,
    });
  };

  const handleFaceChange = (face: RoomFace, value: string) => {
    if (!value) return;
    onUpdateMaterials({
      ...materials,
      [face]: value,
    });
  };

  const isAllFacesMixed = allFacesMaterial === null;

  return (
    <div className="flex flex-col w-full min-w-0 text-xs overflow-hidden">
      <div className="flex items-center gap-1 w-full min-w-0">
        <button
          onClick={() => setExpandedAll(!expandedAll)}
          className="flex items-center justify-center h-4 w-4 shrink-0 text-secondary-hover hover:text-foreground"
          title={expandedAll ? 'Collapse surfaces' : 'Expand surfaces'}
        >
          <ChevronRight
            size={12}
            className={`shrink-0 transition-transform duration-150 ${expandedAll ? 'rotate-90' : ''}`}
          />
        </button>
        <span className="font-medium text-foreground shrink-0 whitespace-nowrap">Materials</span>
        <div className="ml-auto shrink-0">
          <MaterialSelect
            value={allFacesMaterial ?? ''}
            onChange={handleAllFacesChange}
            materials={sortedMaterials}
            materialColors={materialColors}
            placeholder={isAllFacesMixed ? '(mixed)' : undefined}
            isMixed={isAllFacesMixed}
            variant="resonance"
            allowClear={false}
          />
        </div>
      </div>

      {expandedAll && (
        <div className="card-collapse-body card-stack--tight w-full min-w-0">
          {FACE_ORDER.map((face) => {
            const faceLabel = FACE_LABELS[face];
            const faceMaterial = materials[face];

            return (
              <div
                key={face}
                className="flex items-center gap-1 w-full min-w-0 pl-5"
              >
                <span className="shrink-0 w-12 text-xxs text-secondary-hover whitespace-nowrap">{faceLabel}</span>
                <div className="ml-auto shrink-0">
                  <MaterialSelect
                    value={faceMaterial}
                    onChange={(v) => handleFaceChange(face, v)}
                    materials={sortedMaterials}
                    materialColors={materialColors}
                    variant="resonance"
                    allowClear={false}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
