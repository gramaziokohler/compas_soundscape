'use client';

import { useState, useEffect } from 'react';
import { UI_RIGHT_SIDEBAR, UI_SIDEBAR_RESIZE } from '@/utils/constants';
import { ObjectExplorer } from '@/components/layout/ObjectExplorer';
import { EntityInfoPanel } from '@/components/layout/sidebar/EntityInfoPanel';
import { useRightSidebarStore, useSpeckleStore } from '@/store';
import { useAcousticMaterialStore } from '@/store';
import { useSidebarResize } from '@/hooks/useSidebarResize';
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
  /** Fired during resize drag so parent can sync layout-sensitive children. */
  onWidthChange?: (width: number) => void;
}

export function RightSidebar({
  isVisible,
  onGoToReceiver,
  generatedSounds,
  onWidthChange,
}: RightSidebarProps) {
  const { isExpanded, requestExpand, requestCollapse } = useRightSidebarStore();
  const { selectedEntity } = useSpeckleStore();
  const isAcousticMaterialActive = useAcousticMaterialStore((s) => s.isActive);
  const [isHandleHovered, setIsHandleHovered] = useState(false);

  const { width: sidebarWidth, isResizing, handleMouseDown: handleResizeMouseDown } = useSidebarResize({
    initialWidth: UI_SIDEBAR_RESIZE.RIGHT_DEFAULT_WIDTH,
    minWidth: UI_SIDEBAR_RESIZE.RIGHT_MIN_WIDTH,
    maxWidth: UI_SIDEBAR_RESIZE.RIGHT_MAX_WIDTH,
    direction: 'left',
    onWidthChange,
  });

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
        width: isExpanded ? `${sidebarWidth}px` : '0px',
        backgroundColor: 'white',
        borderLeft: isExpanded ? `${UI_RIGHT_SIDEBAR.BORDER_WIDTH}px solid var(--color-secondary-light)` : 'none',
        zIndex: 10,
        userSelect: isResizing ? 'none' : undefined,
      }}
    >
      {/* Resize handle — left edge */}
      {isExpanded && (
        <div
          onMouseDown={handleResizeMouseDown}
          onMouseEnter={() => setIsHandleHovered(true)}
          onMouseLeave={() => setIsHandleHovered(false)}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: `${UI_SIDEBAR_RESIZE.HANDLE_HIT_AREA}px`,
            height: '100%',
            cursor: 'col-resize',
            zIndex: 20,
            display: 'flex',
            alignItems: 'stretch',
            justifyContent: 'flex-start',
          }}
        >
          <div
            style={{
              width: `${UI_SIDEBAR_RESIZE.HANDLE_WIDTH}px`,
              height: '100%',
              backgroundColor: (isHandleHovered || isResizing) ? 'var(--color-primary)' : 'transparent',
              transition: 'background-color 150ms ease',
              borderRadius: '2px',
            }}
          />
        </div>
      )}
      {/* ===== TOP SECTION: Object Explorer / Import ===== */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* Header */}
        <div
          className="flex-shrink-0 flex items-center px-4 gap-2"
          style={{
            height: `${UI_RIGHT_SIDEBAR.HEADER_HEIGHT}px`,
            backgroundColor: 'white',
            borderBottom: `${UI_RIGHT_SIDEBAR.BORDER_WIDTH}px solid var(--color-secondary-light)`,
          }}
        >
          <h2 className="text-sm font-semibold whitespace-nowrap text-neutral-700">
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
          borderTop: `${UI_RIGHT_SIDEBAR.BORDER_WIDTH}px solid var(--color-secondary-light)`,
          backgroundColor: 'white',
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
