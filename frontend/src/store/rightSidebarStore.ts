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
  /** True while the right-click context menu is open — prevents sidebar from auto-expanding. */
  rightClickActive: boolean;
  /**
   * Fraction (0–1) of the right sidebar height taken by the Acoustics
   * (simulation) section; the Listeners section fills the remainder.
   */
  simulationAreaRatio: number;
  requestExpand: () => void;
  requestCollapse: () => void;
  setRightClickActive: (active: boolean) => void;
  setSimulationAreaRatio: (ratio: number) => void;
}

export const useRightSidebarStore = create<RightSidebarStoreState>()(
  persist(
    devtools(
      (set) => ({
        isExpanded: false,
        rightClickActive: false,
        simulationAreaRatio: UI_SIDEBAR_RESIZE.RIGHT_SPLIT_DEFAULT_RATIO,
        requestExpand: () => set({ isExpanded: true }, false, 'rightSidebar/expand'),
        requestCollapse: () => set({ isExpanded: false }, false, 'rightSidebar/collapse'),
        setRightClickActive: (active) =>
          set({ rightClickActive: active }, false, 'rightSidebar/setRightClickActive'),
        setSimulationAreaRatio: (ratio) =>
          set({ simulationAreaRatio: ratio }, false, 'rightSidebar/setSimulationAreaRatio'),
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
