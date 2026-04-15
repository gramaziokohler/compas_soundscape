/**
 * Right Sidebar Store
 *
 * Replaces RightSidebarContext. Manages expanded/collapsed state of the right
 * sidebar. Any component can call requestExpand() to open it.
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

export interface RightSidebarStoreState {
  isExpanded: boolean;
  requestExpand: () => void;
  requestCollapse: () => void;
}

export const useRightSidebarStore = create<RightSidebarStoreState>()(
  devtools(
    (set) => ({
      isExpanded: false,
      requestExpand: () => set({ isExpanded: true }, false, 'rightSidebar/expand'),
      requestCollapse: () => set({ isExpanded: false }, false, 'rightSidebar/collapse'),
    }),
    { name: 'rightSidebarStore' },
  ),
);
