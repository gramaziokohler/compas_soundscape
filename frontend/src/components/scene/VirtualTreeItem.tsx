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

import React, { CSSProperties } from 'react';
import { VirtualTreeItem as TreeItem, getHeaderAndSubheader, getTargetObjectIds, containsAll } from '@/hooks/useSpeckleTree';
import { useSpeckleStore } from '@/store';
import { UI_COLORS } from '@/utils/constants';

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
  onToggleIsolation: (objectIds: string[]) => void;
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
  onToggleIsolation
}: VirtualTreeItemProps) {
  const { modelFileName } = useSpeckleStore();
  const rawSpeckleData = item.data.raw;
  const objectIds = getTargetObjectIds(rawSpeckleData);
  const isRootNode = item.indent === 0;
  const { header, subheader } = getHeaderAndSubheader(rawSpeckleData, modelFileName, isRootNode);
  
  // Replace "Unknown" with model filename for display
  const displayHeader = (header === 'Unknown' && modelFileName) ? modelFileName : header;

  const shouldShowDimmed = !isIsolated && hasIsolatedObjectsInGeneral;
  const opacity = isHidden || shouldShowDimmed ? 0.6 : 1;

  // Check if this specific item is selected based on its ID
  const isSelected = item.isSelected;

  const getItemBackgroundClass = (): string => {
    if (isSelected) {
      return 'bg-blue-100 hover:bg-blue-200 rounded-sm';
    }
    return 'bg-white hover:bg-gray-50 hover:rounded-sm';
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
    console.log('[VirtualTreeItem] Toggle isolation clicked for:', { header: displayHeader, objectIds, isIsolated });
    onToggleIsolation(objectIds);
  };

  return (
    <div style={style} className="px-1">
      <div
        className={`group flex items-center w-full p-1 pr-2 cursor-pointer text-left justify-between rounded-sm transition-colors ${getItemBackgroundClass()}`}
        style={{ opacity }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {/* Left side: indentation + expansion triangle + content */}
        <div className="flex items-center gap-0.5 min-w-0">
          {/* Indentation */}
          <div
            className="shrink-0"
            style={{ width: `${(item.indent || 0) * 0.375}rem` }}
          />

          {/* Expansion triangle */}
          {item.hasChildren ? (
            <button
              className="h-8 w-4 flex items-center justify-center shrink-0 text-gray-600 hover:text-gray-800"
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

          {/* Item content */}
          <div className="flex min-w-0 flex-col">
            <div
              className="truncate text-xs"
              style={{
                color: isHidden || shouldShowDimmed ? UI_COLORS.NEUTRAL_500 : UI_COLORS.NEUTRAL_700
              }}
            >
              {displayHeader}
            </div>
            {subheader && (
              <div className="truncate text-[10px]" style={{ color: UI_COLORS.NEUTRAL_500 }}>
                {subheader}
              </div>
            )}
          </div>
        </div>

        {/* Right side: hide/isolate buttons (hidden for root nodes) */}
        {!isRootNode && (
          <div
            className={`flex items-center overflow-hidden shrink-0 group-hover:w-auto transition-all ${
              isHidden || isIsolated ? 'w-auto' : 'w-0'
            }`}
          >
          {/* Hide/Show button */}
          <button
            className={`p-1 hover:bg-gray-200 rounded transition-colors ${
              isHidden ? 'text-gray-400' : 'text-gray-700'
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

          {/* Isolate button */}
          <button
            className={`p-1 hover:bg-gray-200 rounded transition-colors ${
              isIsolated ? 'text-gray-700' : 'text-gray-600'
            }`}
            onClick={handleToggleIsolation}
            title={isIsolated ? 'Un-isolate' : 'Isolate'}
          >
            {isIsolated ? (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="w-4 h-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="none"
              >
                <rect
                  x="4"
                  y="4"
                  width="16"
                  height="16"
                  rx="2"
                  fill="currentColor"
                  opacity="0.3"
                />
                <rect
                  x="8"
                  y="8"
                  width="8"
                  height="8"
                  rx="1"
                  fill="currentColor"
                />
              </svg>
            ) : (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="w-4 h-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect
                  x="4"
                  y="4"
                  width="16"
                  height="16"
                  rx="2"
                />
                <rect
                  x="8"
                  y="8"
                  width="8"
                  height="8"
                  rx="1"
                />
              </svg>
            )}
          </button>
        </div>        )}      </div>
    </div>
  );
}
