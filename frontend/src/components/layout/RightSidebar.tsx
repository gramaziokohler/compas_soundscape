'use client';

import { useEffect } from 'react';
import { UI_RIGHT_SIDEBAR, UI_COLORS } from '@/utils/constants';
import { ObjectExplorer } from '@/components/layout/ObjectExplorer';
import { EntityInfoPanel } from '@/components/layout/sidebar/EntityInfoPanel';
import { useRightSidebarStore, useSpeckleStore } from '@/store';
import { useAcousticMaterialStore } from '@/store';
import type { SoundEvent } from '@/types';

/**
 * RightSidebar Component
 *
 * Fixed sidebar on the right side of the screen.
 * Completely hidden by default. Auto-expands when an object is selected or
 * a simulation tab is expanded. Any component can call
 * `useRightSidebar().requestExpand()` to open it.
 *
 * Split into two sections:
 * - Top half: Object Explorer (tree view of loaded model)
 * - Bottom half: Entity Information Panel (shows selected object details)
 */

interface RightSidebarProps {
  isVisible: boolean;
  onGoToReceiver?: (receiverId: string) => void;
  /** Still passed from page.tsx — SoundEvent list owned by useSoundGeneration (not yet migrated). */
  generatedSounds?: SoundEvent[];
}

export function RightSidebar({
  isVisible,
  onGoToReceiver,
  generatedSounds,
}: RightSidebarProps) {
  const { isExpanded, requestExpand, requestCollapse } = useRightSidebarStore();
  const { selectedEntity } = useSpeckleStore();
  const isAcousticMaterialActive = useAcousticMaterialStore((s) => s.isActive);

  // Auto-expand/collapse based on active signals
  // Expand when any signal is active, collapse when all are inactive
  useEffect(() => {
    if (selectedEntity || isAcousticMaterialActive) {
      requestExpand();
    } else {
      requestCollapse();
    }
  }, [selectedEntity, isAcousticMaterialActive, requestExpand, requestCollapse]);

  if (!isVisible) return null;

  return (
    <aside
      className="fixed top-0 right-0 h-screen flex flex-col transition-all duration-300 ease-in-out overflow-hidden"
      style={{
        width: isExpanded ? `${UI_RIGHT_SIDEBAR.WIDTH}px` : '0px',
        backgroundColor: UI_RIGHT_SIDEBAR.BACKGROUND,
        borderLeft: isExpanded ? `${UI_RIGHT_SIDEBAR.BORDER_WIDTH}px solid ${UI_RIGHT_SIDEBAR.BORDER_COLOR}` : 'none',
        zIndex: 10,
      }}
    >
      {/* ===== TOP SECTION: Object Explorer / Import ===== */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* Header */}
        <div
          className="flex-shrink-0 flex items-center px-4 gap-2"
          style={{
            height: `${UI_RIGHT_SIDEBAR.HEADER_HEIGHT}px`,
            backgroundColor: UI_RIGHT_SIDEBAR.BACKGROUND,
            borderBottom: `${UI_RIGHT_SIDEBAR.BORDER_WIDTH}px solid ${UI_RIGHT_SIDEBAR.BORDER_COLOR}`,
          }}
        >
          <h2 className="text-sm font-semibold whitespace-nowrap" style={{ color: UI_COLORS.NEUTRAL_700 }}>
            Object Explorer
          </h2>
        </div>

        {/* Content */}
        <div
          className="flex-1 overflow-y-auto"
          style={{
            padding: `${UI_RIGHT_SIDEBAR.PADDING}px`,
          }}
        >
          <ObjectExplorer />
        </div>
      </div>

      {/* ===== BOTTOM SECTION: Entity Information Panel ===== */}
      <div
        className="flex-shrink-0"
        style={{
          height: '220px',
          borderTop: `${UI_RIGHT_SIDEBAR.BORDER_WIDTH}px solid ${UI_RIGHT_SIDEBAR.BORDER_COLOR}`,
          backgroundColor: UI_RIGHT_SIDEBAR.BACKGROUND,
        }}
      >
        {/* Header */}

        {/* Entity Panel Content */}
        <div
          style={{
            padding: `${UI_RIGHT_SIDEBAR.PADDING}px`,
            height: `calc(100% - ${UI_RIGHT_SIDEBAR.HEADER_HEIGHT}px)`,
          }}
        >
          <EntityInfoPanel
            onGoToReceiver={onGoToReceiver}
            generatedSounds={generatedSounds}
          />
        </div>
      </div>
    </aside>
  );
}
