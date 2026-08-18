/**
 * Position Clipboard Store
 *
 * Transient, in-app buffer for "Copy position" / "Paste position" across the
 * sidebar's right-click menus. Holds a single position so it can be pasted
 * between sound cards and single listener cards (and both directions).
 * Not undo-tracked (transient state) and not persisted (session-scoped).
 */

import { create } from 'zustand';

export interface PositionClipboardState {
  position: [number, number, number] | null;
  copyPosition: (position: [number, number, number]) => void;
  clearPosition: () => void;
}

export const usePositionClipboardStore = create<PositionClipboardState>((set) => ({
  position: null,
  copyPosition: (position) => set({ position }),
  clearPosition: () => set({ position: null }),
}));