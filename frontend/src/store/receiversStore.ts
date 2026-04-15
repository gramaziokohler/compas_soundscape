/**
 * Receivers Store
 *
 * Replaces useReceivers. Manages acoustic receiver sphere positions,
 * selection state, and naming. Participates in global undo/redo via zundo
 * (receivers array is the undo target — adding/removing/moving receivers).
 */

import { create } from 'zustand';
import { temporal } from 'zundo';
import { devtools } from 'zustand/middleware';
import { RECEIVER } from '@/utils/constants';
import type { ReceiverData } from '@/types';

// ─── Partialize ───────────────────────────────────────────────────────────────

export const receiversPartialize = (state: ReceiversStoreState) => ({
  receivers: state.receivers.map((r) => ({
    id: r.id,
    name: r.name,
    position: r.position,
    // mesh is not serializable → omit from history
  })),
  selectedReceiverId: state.selectedReceiverId,
});

// ─── State ────────────────────────────────────────────────────────────────────

export interface ReceiversStoreState {
  receivers: ReceiverData[];
  selectedReceiverId: string | null;

  addReceiver: (type?: string, position?: [number, number, number]) => void;
  removeReceiver: (id: string) => void;
  updateReceiverPosition: (id: string, position: [number, number, number]) => void;
  updateReceiverName: (id: string, name: string) => void;
  selectReceiver: (id: string | null) => void;
  clearReceivers: () => void;
  restoreReceivers: (savedReceivers: ReceiverData[], savedSelectedId?: string | null) => void;
}

// ─── Store ────────────────────────────────────────────────────────────────────

function calculateDefaultPosition(index: number): [number, number, number] {
  const offsetX = (index % 3) * 2;
  const offsetZ = Math.floor(index / 3) * 2;
  return [
    RECEIVER.DEFAULT_POSITION[0] + offsetX,
    RECEIVER.DEFAULT_POSITION[1],
    RECEIVER.DEFAULT_POSITION[2] + offsetZ,
  ];
}

export const useReceiversStore = create<ReceiversStoreState>()(
  temporal(
    devtools(
      (set, get) => ({
        receivers: [],
        selectedReceiverId: null,

        addReceiver: (type = 'single', position) => {
          const { receivers } = get();
          const newPosition: [number, number, number] =
            position ?? calculateDefaultPosition(receivers.length);
          const newReceiver: ReceiverData = {
            id: `receiver-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            name: `Receiver ${receivers.length + 1}`,
            position: newPosition,
          };
          set(
            { receivers: [...receivers, newReceiver] },
            false,
            'receivers/addReceiver',
          );
        },

        removeReceiver: (id) =>
          set(
            (s) => ({ receivers: s.receivers.filter((r) => r.id !== id) }),
            false,
            'receivers/removeReceiver',
          ),

        updateReceiverPosition: (id, position) =>
          set(
            (s) => ({
              receivers: s.receivers.map((r) =>
                r.id === id ? { ...r, position } : r,
              ),
            }),
            false,
            'receivers/updateReceiverPosition',
          ),

        updateReceiverName: (id, name) =>
          set(
            (s) => ({
              receivers: s.receivers.map((r) =>
                r.id === id ? { ...r, name } : r,
              ),
            }),
            false,
            'receivers/updateReceiverName',
          ),

        selectReceiver: (id) =>
          set({ selectedReceiverId: id }, false, 'receivers/selectReceiver'),

        clearReceivers: () =>
          set({ receivers: [], selectedReceiverId: null }, false, 'receivers/clearReceivers'),

        restoreReceivers: (savedReceivers, savedSelectedId) =>
          set(
            {
              receivers: savedReceivers,
              ...(savedSelectedId != null ? { selectedReceiverId: savedSelectedId } : {}),
            },
            false,
            'receivers/restoreReceivers',
          ),
      }),
      { name: 'receiversStore' },
    ),
    { partialize: receiversPartialize },
  ),
);
