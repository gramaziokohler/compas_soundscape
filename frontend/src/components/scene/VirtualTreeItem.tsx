/**
 * VirtualTreeItem Component
 *
 * Individual tree item for the Speckle object explorer with virtual scrolling.
 * Adapted from Vue VirtualTreeItem.vue component.
 *
 * Features:
 * - Expandable/collapsible hierarchy
 * - Hide/isolate buttons
 * - Hover highlighting
 * - Selection support
 * - Double-click zoom
 */

'use client';

import React, { CSSProperties, useMemo } from 'react';
import { VirtualTreeItem as TreeItem, getHeaderAndSubheader, getGeometryLeafIdsFromNode } from '@/hooks/useSpeckleTree';
import { useSpeckleStore } from '@/store';
import { TreeItemAcousticControls } from '@/components/scene/TreeItemAcousticControls';
import {
  OBJECT_EXPLORER_PANEL_ACTIONS_WIDTH_PX,
  objectExplorerAcousticGridStyle,
} from '@/components/scene/objectExplorerAcousticLayout';
import { AudioLines } from 'lucide-react';
import type { MaterialOption } from '@/components/ui/MaterialSelect';

interface VirtualTreeItemProps {
  item: TreeItem;
  style?: CSSProperties;
  isHidden: boolean;
  isIsolated: boolean;
  hasIsolatedObjectsInGeneral: boolean;
  onToggleExpansion: (itemId: string) => void;
  onItemClick: (item: TreeItem, event: React.MouseEvent) => void;
  onItemDoubleClick: (objectId: string) => void;
  onMouseEnter: (objectIds: string[]) => void;
  onMouseLeave: (objectIds: string[]) => void;
  onToggleVisibility: (objectIds: string[]) => void;
  onToggleIsolation?: (objectIds: string[]) => void;
  acousticActive?: boolean;
  showScattering?: boolean;
  sortedMaterials?: MaterialOption[];
  materialColors?: Map<string, string>;
  /** When true, do not render the isolate button (used in acoustic mode) */
  hideIsolateButton?: boolean;
  /** When true, render a "Select" button to designate this layer as the acoustic layer */
  isLayerSelectionMode?: boolean;
  onSelectAsAcousticLayer?: () => void;
  /** When true, this row IS the acoustic layer row — render a red reload button instead of hide */
  isAcousticLayerRow?: boolean;
  /** Handler for the red reload button (resets acoustic layer assignment) */
  onResetAcousticLayer?: () => void;
}

export function VirtualTreeItem({
  item,
  style,
  isHidden,
  isIsolated,
  hasIsolatedObjectsInGeneral,
  onToggleExpansion,
  onItemClick,
  onItemDoubleClick,
  onMouseEnter,
  onMouseLeave,
  onToggleVisibility,
  onToggleIsolation,
  acousticActive = false,
  showScattering = false,
  sortedMaterials,
  materialColors,
  hideIsolateButton,
  isLayerSelectionMode,
  onSelectAsAcousticLayer,
  isAcousticLayerRow,
  onResetAcousticLayer,
}: VirtualTreeItemProps) {
  const { modelFileName } = useSpeckleStore();
  const rawSpeckleData = item.data.raw;
  const geometryIds = useMemo(() => getGeometryLeafIdsFromNode(item.data), [item.data]);
  // Hide/isolate/hover must key off the actual renderable geometry leaf ids
  // (same ids the ObjectExplorer uses for isHidden/isIsolated state and the
  // acoustic-mode explorer-hide tracking). A group/layer row's own raw id is
  // NOT a renderable object id, so using it here would silently no-op.
  const objectIds = geometryIds;
  const isRootNode = item.indent === 0;
  const { header, subheader } = getHeaderAndSubheader(rawSpeckleData, modelFileName, isRootNode);
  const displaySubheader = item.hasChildren ? 'Layer' : subheader;
  
  // Replace "Unknown" with model filename for display
  const displayHeader = (header === 'Unknown' && modelFileName) ? modelFileName : header;

  const shouldShowDimmed = !isIsolated && hasIsolatedObjectsInGeneral;
  const opacity = isHidden || shouldShowDimmed ? 0.6 : 1;

  // Check if this specific item is selected based on its ID
  const isSelected = item.isSelected;

  const getItemBackgroundClass = (): string => {
    if (isSelected) {
      return 'bg-primary-hover/80 hover:bg-primary-hover/20 rounded-sm';
    }
    return 'bg-background hover:bg-primary-hover/50 hover:rounded-sm';
  };

  const handleClick = (e: React.MouseEvent) => {
    onItemClick(item, e);
  };

  const handleDoubleClick = () => {
    if (rawSpeckleData?.id) {
      onItemDoubleClick(rawSpeckleData.id);
    }
  };

  const handleMouseEnter = () => {
    onMouseEnter(objectIds);
  };

  const handleMouseLeave = () => {
    onMouseLeave(objectIds);
  };

  const handleToggleExpansion = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleExpansion(item.id);
  };

  const handleToggleVisibility = (e: React.MouseEvent) => {
    e.stopPropagation();
    console.log('[VirtualTreeItem] Toggle visibility clicked for:', { header: displayHeader, objectIds, isHidden });
    onToggleVisibility(objectIds);
  };

  const handleToggleIsolation = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onToggleIsolation) return;
    console.log('[VirtualTreeItem] Toggle isolation clicked for:', { header: displayHeader, objectIds, isIsolated });
    onToggleIsolation(objectIds);
  };

  const nameContent = (
    <div className="flex items-center gap-0.5 min-w-0">
      <div
        className="shrink-0"
        style={{ width: `${(item.indent || 0) * 0.375}rem` }}
      />
      {item.hasChildren ? (
        <button
          className="h-8 w-4 flex items-center justify-center shrink-0 text-neutral-600 hover:text-neutral-800"
          onClick={handleToggleExpansion}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="w-3 h-3 transition-transform"
            style={{
              transform: item.isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
            }}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
      ) : (
        <div className="w-4 shrink-0" />
      )}
      <div className="flex min-w-0 flex-col">
        <div className="flex items-center gap-1 min-w-0">
          <div
            className="truncate text-xs"
            style={{
              color: isHidden || shouldShowDimmed ? 'var(--color-secondary-hover)' : 'var(--foreground)',
            }}
          >
            {displayHeader}
          </div>
          {isAcousticLayerRow && onResetAcousticLayer && (
            <button
              type="button"
              className="shrink-0 text-blue-text hover:opacity-70 transition-opacity"
              onClick={(e) => {
                e.stopPropagation();
                onResetAcousticLayer();
              }}
              title="Re-assign acoustic layer"
              aria-label="Re-assign acoustic layer"
            >
              <AudioLines size={12} strokeWidth={2} />
            </button>
          )}
        </div>
        {displaySubheader && (
          <div className="truncate text-[10px] text-neutral-500">
            {displaySubheader}
          </div>
        )}
      </div>
    </div>
  );

  const actionButtons = (
    <>
      {!isAcousticLayerRow && (!isRootNode || isLayerSelectionMode) && (
        <>
          <button
            className={`p-1 hover:bg-neutral-200 rounded transition-colors ${
              isHidden ? 'text-primary' : 'text-neutral-700'
            }`}
            onClick={handleToggleVisibility}
            title={isHidden ? 'Show' : 'Hide'}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="w-4 h-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="none"
            >
              <path
                d="M12 5c-7.633 0-9.927 6.617-9.948 6.684L1.946 12l.105.316C2.073 12.383 4.367 19 12 19s9.927-6.617 9.948-6.684l.106-.316-.105-.316C21.927 11.617 19.633 5 12 5zm0 11c-2.206 0-4-1.794-4-4s1.794-4 4-4 4 1.794 4 4-1.794 4-4 4z"
                fill="currentColor"
              />
              <circle cx="12" cy="12" r="2" fill="currentColor" />
            </svg>
          </button>
          {!hideIsolateButton && onToggleIsolation && (
            <button
              className={`p-1 hover:bg-neutral-200 rounded transition-colors ${
                isIsolated ? 'text-primary' : 'text-neutral-600'
              }`}
              onClick={handleToggleIsolation}
              title={isIsolated ? 'Un-isolate' : 'Isolate'}
            >
              {isIsolated ? (
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="none">
                  <rect x="4" y="4" width="16" height="16" rx="2" fill="currentColor" opacity="0.3" />
                  <rect x="8" y="8" width="8" height="8" rx="1" fill="currentColor" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="4" y="4" width="16" height="16" rx="2" />
                  <rect x="8" y="8" width="8" height="8" rx="1" />
                </svg>
              )}
            </button>
          )}
          {isLayerSelectionMode && onSelectAsAcousticLayer && (
            <button
              className="ml-1 px-2 py-0.5 text-xs font-medium rounded transition-colors border"
              style={{
                backgroundColor: 'var(--color-primary)',
                color: 'white',
                borderColor: 'var(--color-primary)',
              }}
              onClick={(e) => {
                e.stopPropagation();
                onSelectAsAcousticLayer();
              }}
              title="Select as acoustic layer"
            >
              Select
            </button>
          )}
        </>
      )}
    </>
  );

  const useAcousticGrid = acousticActive && !!sortedMaterials && !!materialColors;

  return (
    <div style={style}>
      <div
        className={`group w-full p-1 cursor-pointer text-left rounded-sm transition-colors ${getItemBackgroundClass()} ${
          useAcousticGrid ? '' : 'flex items-center justify-between'
        }`}
        style={{
          opacity,
          ...(useAcousticGrid ? objectExplorerAcousticGridStyle(showScattering) : {}),
        }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <div className={useAcousticGrid ? 'min-w-0' : 'flex flex-1 items-center gap-0.5 min-w-0'}>
          {nameContent}
        </div>

        {useAcousticGrid && (
          <TreeItemAcousticControls
            geometryIds={geometryIds}
            sortedMaterials={sortedMaterials}
            materialColors={materialColors}
            showScattering={showScattering}
          />
        )}

        <div
          className={`flex items-center shrink-0 ${
            useAcousticGrid
              ? 'justify-end overflow-hidden'
              : `overflow-hidden group-hover:w-auto transition-all ${
                  isHidden || isIsolated || isLayerSelectionMode ? 'w-auto' : 'w-0'
                }`
          }`}
          style={useAcousticGrid ? { width: `${OBJECT_EXPLORER_PANEL_ACTIONS_WIDTH_PX}px` } : undefined}
        >
          {actionButtons}
        </div>
      </div>
    </div>
  );
}
