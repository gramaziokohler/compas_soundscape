/**
 * Right Sidebar Store
 *
 * Replaces RightSidebarContext. Manages expanded/collapsed state of the right
 * sidebar. Any component can call requestExpand() to open it.
 */

import { create } from 'zustand';
import { devtools, persist, createJSONStorage } from 'zustand/middleware';

export interface RightSidebarStoreState {
  isExpanded: boolean;
  /** True while the right-click context menu is open — prevents sidebar from auto-expanding. */
  rightClickActive: boolean;
  requestExpand: () => void;
  requestCollapse: () => void;
  setRightClickActive: (active: boolean) => void;
}

export const useRightSidebarStore = create<RightSidebarStoreState>()(
  persist(
    devtools(
      (set) => ({
        isExpanded: false,
        rightClickActive: false,
        requestExpand: () => set({ isExpanded: true }, false, 'rightSidebar/expand'),
        requestCollapse: () => set({ isExpanded: false }, false, 'rightSidebar/collapse'),
        setRightClickActive: (active) =>
          set({ rightClickActive: active }, false, 'rightSidebar/setRightClickActive'),
      }),
      { name: 'rightSidebarStore' },
    ),
    {
      name: 'compas-right-sidebar',
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      partialize: (state: RightSidebarStoreState) => ({
        isExpanded: state.isExpanded,
      }),
    },
  ),
);
