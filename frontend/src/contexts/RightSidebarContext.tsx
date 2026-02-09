/**
 * RightSidebarContext
 *
 * Manages right sidebar expanded/collapsed state.
 * Any component can call `requestExpand()` to open the sidebar.
 * The sidebar starts collapsed (completely hidden) and auto-expands on:
 * - Object selection in the 3D viewer (selectedEntity)
 * - Acoustic simulation tab expansion (AcousticMaterialContext.isActive)
 * - Any future feature calling `requestExpand()`
 */

'use client';

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

interface RightSidebarContextValue {
  /** Whether the sidebar is currently expanded */
  isExpanded: boolean;
  /** Expand the sidebar (no-op if already expanded) */
  requestExpand: () => void;
  /** Collapse the sidebar */
  requestCollapse: () => void;
}

const RightSidebarContext = createContext<RightSidebarContextValue | null>(null);

export function RightSidebarProvider({ children }: { children: ReactNode }) {
  const [isExpanded, setIsExpanded] = useState(false);

  const requestExpand = useCallback(() => {
    setIsExpanded(true);
  }, []);

  const requestCollapse = useCallback(() => {
    setIsExpanded(false);
  }, []);

  return (
    <RightSidebarContext.Provider
      value={{ isExpanded, requestExpand, requestCollapse }}
    >
      {children}
    </RightSidebarContext.Provider>
  );
}

export function useRightSidebar() {
  const ctx = useContext(RightSidebarContext);
  if (!ctx) {
    throw new Error('useRightSidebar must be used within RightSidebarProvider');
  }
  return ctx;
}
