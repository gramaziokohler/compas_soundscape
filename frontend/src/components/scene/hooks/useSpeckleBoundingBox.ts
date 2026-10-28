import { useEffect } from 'react';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import { useAcousticsSimulationStore, useUIStore } from '@/store';
import type { ResonanceSimulationConfig } from '@/types/acoustics';

interface ResonanceRoomsProps {
  isViewerReady: boolean;
}

/**
 * Draws one bounding box per visible Resonance (ShoeBox) card.
 * A box is visible while its card is powered or expanded, unless the card's
 * "Show box" toggle has hidden it.
 */
export function useSpeckleBoundingBox({ isViewerReady }: ResonanceRoomsProps) {
  const simulationConfigs = useAcousticsSimulationStore((s) => s.simulationConfigs);
  const activeResonanceIds = useAcousticsSimulationStore((s) => s.activeResonanceIds);
  const hiddenResonanceBoxIds = useAcousticsSimulationStore((s) => s.hiddenResonanceBoxIds);
  const expandedTabIndex = useUIStore((s) => s.expandedSimulationTabIndex);

  useEffect(() => {
    const { viewer, resonanceRoomBoxes } = useSpeckleEngineStore.getState();
    if (!resonanceRoomBoxes || !isViewerReady || !viewer) return;

    const expandedId = expandedTabIndex !== null
      ? simulationConfigs[expandedTabIndex]?.id ?? null
      : null;

    const visible = simulationConfigs.filter((c): c is ResonanceSimulationConfig => {
      if (c.type !== 'resonance' || !c.room.bounds) return false;
      if (hiddenResonanceBoxIds.includes(c.id)) return false;
      return activeResonanceIds.includes(c.id) || c.id === expandedId;
    });

    resonanceRoomBoxes.sync(visible.map((c) => c.id));

    for (const config of visible) {
      const manager = resonanceRoomBoxes.ensure(config.id);
      const isEdited = config.id === expandedId;
      manager.updateBoundingBox(config.room.bounds, {
        roomMaterials: config.room.materials,
        visible: true,
        label: config.display_name || 'ShoeBox',
        editable: isEdited,
        opacityScale: isEdited ? 1 : 0.45,
      });
    }

    viewer.requestRender(8);
    setTimeout(() => viewer.requestRender(), 0);
  }, [
    isViewerReady,
    simulationConfigs,
    activeResonanceIds,
    hiddenResonanceBoxIds,
    expandedTabIndex,
  ]);
}
