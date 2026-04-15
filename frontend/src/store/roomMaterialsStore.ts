/**
 * Room Materials Store
 *
 * Replaces useRoomMaterials. Manages ShoeBox Acoustics room material and
 * dimension settings. Undo/redo targets both roomMaterials and roomDimensions.
 *
 * Note: The AudioOrchestrator sync effects (updateResonanceRoomMaterials /
 * updateResonanceRoomDimensions) remain in the components/hooks that subscribe
 * to this store — the store itself is pure state with no side-effects.
 */

import { create } from 'zustand';
import { temporal } from 'zundo';
import { devtools } from 'zustand/middleware';
import { RESONANCE_AUDIO } from '@/utils/constants';
import type { ResonanceRoomMaterial, ResonanceRoomDimensions } from '@/types/audio';

// ─── Partialize ───────────────────────────────────────────────────────────────

export const roomMaterialsPartialize = (state: RoomMaterialsStoreState) => ({
  roomMaterials: { ...state.roomMaterials },
  roomDimensions: { ...state.roomDimensions },
});

// ─── State ────────────────────────────────────────────────────────────────────

export interface RoomMaterialsStoreState {
  roomMaterials: ResonanceRoomMaterial;
  roomDimensions: ResonanceRoomDimensions;

  updateRoomMaterials: (materials: ResonanceRoomMaterial) => void;
  updateRoomDimensions: (dimensions: ResonanceRoomDimensions) => void;
  reset: () => void;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useRoomMaterialsStore = create<RoomMaterialsStoreState>()(
  temporal(
    devtools(
      (set) => ({
        roomMaterials: RESONANCE_AUDIO.DEFAULT_ROOM_MATERIALS,
        roomDimensions: RESONANCE_AUDIO.DEFAULT_ROOM_DIMENSIONS,

        updateRoomMaterials: (materials) =>
          set({ roomMaterials: materials }, false, 'roomMaterials/updateRoomMaterials'),

        updateRoomDimensions: (dimensions) =>
          set({ roomDimensions: dimensions }, false, 'roomMaterials/updateRoomDimensions'),

        reset: () =>
          set(
            {
              roomMaterials: RESONANCE_AUDIO.DEFAULT_ROOM_MATERIALS,
              roomDimensions: RESONANCE_AUDIO.DEFAULT_ROOM_DIMENSIONS,
            },
            false,
            'roomMaterials/reset',
          ),
      }),
      { name: 'roomMaterialsStore' },
    ),
    { partialize: roomMaterialsPartialize },
  ),
);
