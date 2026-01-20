'use client';

import { useState, useEffect } from 'react';
import { UI_RIGHT_SIDEBAR, UI_COLORS, MODEL_FILE_EXTENSIONS } from '@/lib/constants';
import { ObjectExplorer } from '@/components/layout/ObjectExplorer';
import { FileUploadArea } from '@/components/controls/FileUploadArea';
import { EntityInfoPanel } from '@/components/layout/sidebar/EntityInfoPanel';
import { Icon } from '@/components/ui/Icon';

/**
 * RightSidebar Component
 *
 * Fixed sidebar on the right side of the screen.
 * Split into two sections:
 * - Top half: 3D model import UI or Object Explorer (when model is loaded)
 * - Bottom half: Entity Information Panel (shows selected object details)
 */

interface RightSidebarProps {
  isVisible: boolean;
  hasModelLoaded?: boolean;
  modelFile?: File | null;
  onModelFileChange?: (file: File) => void;
  onExpandedChange?: (isExpanded: boolean) => void;
}

export function RightSidebar({
  isVisible,
  hasModelLoaded = false,
  modelFile = null,
  onModelFileChange,
  onExpandedChange
}: RightSidebarProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);

  // Notify parent when expanded state changes
  useEffect(() => {
    onExpandedChange?.(isExpanded);
  }, [isExpanded, onExpandedChange]);

  if (!isVisible) return null;

  const toggleExpanded = () => {
    setIsExpanded(prev => !prev);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    const file = files[0];
    onModelFileChange?.(file);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    onModelFileChange?.(file);
    
    // Reset input
    e.target.value = "";
  };

  // Collapsed width - just enough for the toggle button
  const collapsedWidth = 40;

  return (
    <aside
      className="fixed top-0 right-0 h-screen flex flex-col transition-all duration-300 ease-in-out"
      style={{
        width: isExpanded ? `${UI_RIGHT_SIDEBAR.WIDTH}px` : `${collapsedWidth}px`,
        backgroundColor: UI_RIGHT_SIDEBAR.BACKGROUND,
        borderLeft: `${UI_RIGHT_SIDEBAR.BORDER_WIDTH}px solid ${UI_RIGHT_SIDEBAR.BORDER_COLOR}`,
        zIndex: 10,
      }}
    >
      {/* ===== TOP SECTION: Object Explorer / Import ===== */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* Header */}
        <div
          className="flex-shrink-0 flex items-center px-2 gap-2"
          style={{
            height: `${UI_RIGHT_SIDEBAR.HEADER_HEIGHT}px`,
            backgroundColor: UI_RIGHT_SIDEBAR.BACKGROUND,
            borderBottom: `${UI_RIGHT_SIDEBAR.BORDER_WIDTH}px solid ${UI_RIGHT_SIDEBAR.BORDER_COLOR}`,
          }}
        >
          {/* Toggle Button */}
          <button
            onClick={toggleExpanded}
            className="flex items-center justify-center rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            style={{
              width: '24px',
              height: '24px',
              flexShrink: 0,
            }}
            title={isExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
          >
            <Icon size="16px" color={UI_COLORS.NEUTRAL_600}>
              {isExpanded ? (
                // Chevron Right (collapse)
                <polyline points="9 18 15 12 9 6" />
              ) : (
                // Chevron Left (expand)
                <polyline points="15 18 9 12 15 6" />
              )}
            </Icon>
          </button>

          {/* Title - hidden when collapsed */}
          {isExpanded && (
            <h2 className="text-sm font-semibold whitespace-nowrap" style={{ color: UI_COLORS.NEUTRAL_700 }}>
              {hasModelLoaded ? 'Object Explorer' : 'Import 3D Model'}
            </h2>
          )}
        </div>

        {/* Content - hidden when collapsed */}
        {isExpanded && (
          <div
            className="flex-1 overflow-y-auto transition-opacity duration-300"
            style={{
              padding: `${UI_RIGHT_SIDEBAR.PADDING}px`,
              opacity: isExpanded ? 1 : 0,
            }}
          >
            {hasModelLoaded ? (
              <ObjectExplorer />
            ) : (
              <div className="flex flex-col gap-4">
                {/* File Upload Area */}
                <FileUploadArea
                  file={modelFile}
                  isDragging={isDragging}
                  acceptedFormats={MODEL_FILE_EXTENSIONS.join(',')}
                  acceptedExtensions={MODEL_FILE_EXTENSIONS.join(', ')}
                  onFileChange={handleFileChange}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  inputId="right-sidebar-model-upload"
                  multiple={false}
                />

                {/* Instructions */}
                <div className="text-xs space-y-2" style={{ color: UI_COLORS.NEUTRAL_600 }}>
                  <p className="font-medium">Supported Formats:</p>
                  <ul className="list-disc list-inside space-y-1 ml-2">
                    <li>.3dm (Rhino)</li>
                    <li>.ifc (Industry Foundation Classes)</li>
                    <li>.obj (Wavefront)</li>
                  </ul>
                  <p className="mt-4 text-xs" style={{ color: UI_COLORS.NEUTRAL_500 }}>
                    After upload, the model will be processed and displayed in the viewer.
                    You can then analyze it to generate sound ideas.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ===== BOTTOM SECTION: Entity Information Panel - hidden when collapsed ===== */}
      {isExpanded && (
        <div
          className="flex-shrink-0 transition-opacity duration-300"
          style={{
            height: '220px',
            borderTop: `${UI_RIGHT_SIDEBAR.BORDER_WIDTH}px solid ${UI_RIGHT_SIDEBAR.BORDER_COLOR}`,
            backgroundColor: UI_RIGHT_SIDEBAR.BACKGROUND,
            opacity: isExpanded ? 1 : 0,
          }}
        >
          {/* Header */}
          <div
            className="flex items-center px-4"
            style={{
              height: `${UI_RIGHT_SIDEBAR.HEADER_HEIGHT}px`,
              borderBottom: `${UI_RIGHT_SIDEBAR.BORDER_WIDTH}px solid ${UI_RIGHT_SIDEBAR.BORDER_COLOR}`,
            }}
          >
            <h2 className="text-sm font-semibold" style={{ color: UI_COLORS.NEUTRAL_700 }}>
              Selected Object
            </h2>
          </div>

          {/* Entity Panel Content */}
          <div
            style={{
              padding: `${UI_RIGHT_SIDEBAR.PADDING}px`,
              height: `calc(100% - ${UI_RIGHT_SIDEBAR.HEADER_HEIGHT}px)`,
            }}
          >
            <EntityInfoPanel />
          </div>
        </div>
      )}
    </aside>
  );
}
