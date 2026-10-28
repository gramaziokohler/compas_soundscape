'use client';

import React, { useMemo } from 'react';
import { ResonanceAudioMaterialUI } from '@/components/acoustics/ResonanceAudioMaterialUI';
import { ToggleField } from '@/components/ui/ToggleField';
import { PositionWidget } from '@/components/ui/PositionWidget';
import { Notice } from '@/components/ui/Notice';
import { RefreshIcon } from '@/components/ui/Icon';
import { useCanEdit } from '@/hooks/useCanEdit';
import { useAcousticsSimulationStore, useUIStore } from '@/store';
import { aabbsOverlap } from '@/lib/audio/utils/resonance-rooms';
import { RESONANCE_AUDIO } from '@/utils/constants';
import type { ResonanceSimulationConfig, ResonanceRoom } from '@/types/acoustics';
import type { ResonanceRoomMaterial } from '@/types/audio';

interface ResonanceAudioControlsProps {
  config: ResonanceSimulationConfig;
  className?: string;
}

function centerOf(room: ResonanceRoom): [number, number, number] {
  const b = room.bounds;
  if (!b) return [0, 0, 0];
  return [
    (b.min[0] + b.max[0]) / 2,
    (b.min[1] + b.max[1]) / 2,
    (b.min[2] + b.max[2]) / 2,
  ];
}

function sizeOf(room: ResonanceRoom): [number, number, number] {
  const b = room.bounds;
  if (!b) return [RESONANCE_AUDIO.DEFAULT_ROOM_DIMENSIONS.width, RESONANCE_AUDIO.DEFAULT_ROOM_DIMENSIONS.depth, RESONANCE_AUDIO.DEFAULT_ROOM_DIMENSIONS.height];
  return [
    b.max[0] - b.min[0],
    b.max[1] - b.min[1],
    b.max[2] - b.min[2],
  ];
}

/**
 * ShoeBox Acoustics Controls
 *
 * Per-card room: position, size, materials, and bounding-box visibility.
 */
export function ResonanceAudioControls({
  config,
  className = '',
}: ResonanceAudioControlsProps) {
  const canEdit = useCanEdit();
  const hiddenResonanceBoxIds = useAcousticsSimulationStore((s) => s.hiddenResonanceBoxIds);
  const activeResonanceIds = useAcousticsSimulationStore((s) => s.activeResonanceIds);
  const simulationConfigs = useAcousticsSimulationStore((s) => s.simulationConfigs);
  const showBox = !hiddenResonanceBoxIds.includes(config.id);

  const materials = config.room.materials;
  const position = centerOf(config.room);
  const size = sizeOf(config.room);

  const overlappingNames = useMemo(() => {
    const bounds = config.room.bounds;
    if (!bounds) return [];
    return simulationConfigs
      .filter((c) =>
        c.type === 'resonance'
        && c.id !== config.id
        && activeResonanceIds.includes(c.id)
        && c.room.bounds
        && aabbsOverlap(bounds, c.room.bounds),
      )
      .map((c) => c.display_name || 'ShoeBox');
  }, [config.id, config.room.bounds, simulationConfigs, activeResonanceIds]);

  const applyCenter = (center: [number, number, number]) => {
    const [w, d, h] = size;
    const half: [number, number, number] = [w / 2, d / 2, h / 2];
    useAcousticsSimulationStore.getState().setResonanceRoomBounds(config.id, {
      min: [center[0] - half[0], center[1] - half[1], center[2] - half[2]],
      max: [center[0] + half[0], center[1] + half[1], center[2] + half[2]],
    });
  };

  const applySize = (next: [number, number, number]) => {
    const minExtent = RESONANCE_AUDIO.MIN_ROOM_EXTENT;
    const [cx, cy, cz] = position;
    const w = Math.max(next[0], minExtent);
    const d = Math.max(next[1], minExtent);
    const h = Math.max(next[2], minExtent);
    useAcousticsSimulationStore.getState().setResonanceRoomBounds(config.id, {
      min: [cx - w / 2, cy - d / 2, cz - h / 2],
      max: [cx + w / 2, cy + d / 2, cz + h / 2],
    });
  };

  const handleMaterials = (next: ResonanceRoomMaterial) => {
    useAcousticsSimulationStore.getState().setResonanceRoomMaterials(config.id, next);
  };

  const handleReset = () => {
    const modelBounds = useUIStore.getState().speckleBounds;
    if (!modelBounds) return;
    useAcousticsSimulationStore.getState().resetResonanceRoom(config.id, modelBounds);
  };

  return (
    <div className={`card-stack min-w-0 ${className}`}>
      <div className="flex items-center justify-between gap-1">
        <ToggleField
          className="flex-1 min-w-0"
          checked={showBox}
          onChange={() => useAcousticsSimulationStore.getState().toggleResonanceBoxHidden(config.id)}
          label="Show Bounding Box"
          disabled={!canEdit}
        />
        <button
          onClick={handleReset}
          disabled={!canEdit}
          className="w-6 h-6 flex-shrink-0 flex items-center justify-center rounded-md text-secondary-hover hover:text-foreground hover:bg-secondary-light transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          title="Reset bounding box to model bounds"
        >
          <RefreshIcon size="0.8rem" />
        </button>
      </div>

      <PositionWidget
        label="Position"
        position={position}
        onUpdatePosition={applyCenter}
        disabled={!canEdit}
      />
      <PositionWidget
        label="Size"
        axisLabels={['W', 'D', 'H']}
        position={size}
        onUpdatePosition={applySize}
        disabled={!canEdit}
      />

      {overlappingNames.length > 0 && (
        <Notice
          type="info"
          variant="tag"
          message={`Overlaps ${overlappingNames.join(', ')}`}
        />
      )}

      <ResonanceAudioMaterialUI
        materials={materials}
        onUpdateMaterials={canEdit ? handleMaterials : () => {}}
      />
    </div>
  );
}
