/**
 * Right Sidebar Store
 *
 * Replaces RightSidebarContext. Manages expanded/collapsed state of the right
 * sidebar. Any component can call requestExpand() to open it.
 */

import { create } from 'zustand';
import { devtools, persist, createJSONStorage } from 'zustand/middleware';
import { UI_SIDEBAR_RESIZE } from '@/utils/constants';

export interface RightSidebarStoreState {
  isExpanded: boolean;
  /** Current resized width in px (updates live while dragging). */
  width: number;
  /**
   * Fraction (0–1) of the right sidebar height taken by the Acoustics
   * (simulation) section; the Listeners section fills the remainder.
   */
  simulationAreaRatio: number;
  /**
   * Monotonic nonce bumped to flash a transient hint on the collapsed expand
   * handle (e.g. "sounds are being convolved"). Transient — never persisted.
   */
  convolutionHintNonce: number;
  requestExpand: () => void;
  requestCollapse: () => void;
  setSimulationAreaRatio: (ratio: number) => void;
  setSidebarWidth: (width: number) => void;
  requestConvolutionHint: () => void;
}

export const useRightSidebarStore = create<RightSidebarStoreState>()(
  persist(
    devtools(
      (set) => ({
        isExpanded: false,
        width: UI_SIDEBAR_RESIZE.RIGHT_DEFAULT_WIDTH,
        simulationAreaRatio: UI_SIDEBAR_RESIZE.RIGHT_SPLIT_DEFAULT_RATIO,
        convolutionHintNonce: 0,
        requestExpand: () => set({ isExpanded: true }, false, 'rightSidebar/expand'),
        requestCollapse: () => set({ isExpanded: false }, false, 'rightSidebar/collapse'),
        requestConvolutionHint: () =>
          set(
            (state) => ({ convolutionHintNonce: state.convolutionHintNonce + 1 }),
            false,
            'rightSidebar/requestConvolutionHint',
          ),
        setSimulationAreaRatio: (ratio) =>
          set({ simulationAreaRatio: ratio }, false, 'rightSidebar/setSimulationAreaRatio'),
        setSidebarWidth: (width) => set({ width }, false, 'rightSidebar/setWidth'),
      }),
      { name: 'rightSidebarStore' },
    ),
    {
      name: 'compas-right-sidebar',
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      partialize: (state: RightSidebarStoreState) => ({
        isExpanded: state.isExpanded,
        simulationAreaRatio: state.simulationAreaRatio,
      }),
    },
  ),
);
