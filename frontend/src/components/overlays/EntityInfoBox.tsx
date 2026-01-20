"use client";

import type { EntityData } from "@/types";
import { UI_OVERLAY, UI_COLORS } from "@/lib/constants";
import { SPECKLE_FILTER_COLORS } from "@/lib/constants";
import { useSpeckleSelectionMode } from "@/contexts/SpeckleSelectionModeContext";

interface EntityInfoBoxProps {
  entity: EntityData;
  x: number;
  y: number;
  onModalImpact?: (entity: EntityData) => void;
  isAnalyzing?: boolean;
  isAnalyzed?: boolean;
  // Speckle-specific props
  speckleObjectId?: string; // Speckle object ID for linking
  speckleObjectName?: string;
  speckleParentName?: string;
}

/**
 * EntityInfoBox Component
 *
 * Displays entity information in a simple overlay box.
 *
 * Usage:
 * - Shows when user clicks on an entity in 3D scene
 * - Displays entity type, ID, and position
 * - Uses consistent overlay styling from design system
 * - Link button allows toggling diverse selection (pink) - no tab dependency
 */
export function EntityInfoBox({
  entity,
  x,
  y,
  onModalImpact,
  isAnalyzing = false,
  isAnalyzed = false,
  speckleObjectId,
  speckleObjectName,
  speckleParentName
}: EntityInfoBoxProps) {
  // Get selection mode context
  const {
    linkVersion, // Subscribe to version changes
    getObjectLinkState,
    addToDiverseSelection,
    removeFromDiverseSelection
  } = useSpeckleSelectionMode();

  // Get current state for this object
  const objectId = speckleObjectId || (entity as any).id || '';
  // Re-query state whenever linkVersion changes to get fresh data
  const { isLinked, isDiverse, linkedSoundIndex } = getObjectLinkState(objectId);

  // Link button config - simplified, no tab dependency
  // Green if linked to sound, Pink if in diverse selection, Grey otherwise
  const getLinkButtonConfig = () => {
    if (isLinked) {
      // Sound-linked objects show green (read-only - unlink from Sound tab)
      return {
        color: SPECKLE_FILTER_COLORS.SOUND_LINKED,
        hoverColor: SPECKLE_FILTER_COLORS.SOUND_LINKED,
        title: `Linked to Sound #${linkedSoundIndex! + 1} (unlink from Sound tab)`,
        action: () => {} // No action - unlinking is done from Sound tab
      };
    } else if (isDiverse) {
      // Diverse-selected objects show pink, click to remove
      return {
        color: SPECKLE_FILTER_COLORS.DIVERSE_SELECTION,
        hoverColor: UI_COLORS.PRIMARY_HOVER,
        title: 'Remove from diverse selection',
        action: () => removeFromDiverseSelection(objectId)
      };
    } else {
      // Not selected - grey, click to add to diverse selection
      return {
        color: UI_COLORS.NEUTRAL_500,
        hoverColor: UI_COLORS.NEUTRAL_600,
        title: 'Add to diverse selection',
        action: () => addToDiverseSelection(objectId)
      };
    }
  };

  const linkButtonConfig = getLinkButtonConfig();

  const handleLinkClick = () => {
    linkButtonConfig.action();
  };

  return (
    <div
      className="absolute pointer-events-none"
      style={{
        left: `${x}px`,
        top: `${y}px`,
        transform: 'translate(-50%, -120%)',
        zIndex: 1300  // Higher than SoundUIOverlay (1000) to appear on top
      }}
    >
      <div
        className="rounded-lg shadow-lg backdrop-blur-sm"
        style={{
          backgroundColor: UI_OVERLAY.BACKGROUND,
          borderColor: UI_OVERLAY.BORDER_COLOR,
          borderWidth: '1px',
          borderStyle: 'solid',
          padding: `${UI_OVERLAY.PADDING}px`,
          width: UI_OVERLAY.WIDTH  // Match SoundUIOverlay width
        }}
      >
        {/* Entity Title with action buttons */}
        <div
          className="pb-2 mb-2 text-sm font-semibold flex items-center justify-between"
          style={{
            borderBottom: `1px solid ${UI_OVERLAY.BORDER_COLOR}`,
            color: 'white'
          }}
        >
          <span>Entity Information</span>

          {/* Action buttons: Link and Impact Sound */}
          <div className="flex items-center gap-1">
            {/* Link button - always enabled, toggles diverse selection */}
            <button
              onClick={handleLinkClick}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = `${linkButtonConfig.hoverColor}20`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
              }}
              disabled={isLinked} // Disable if sound-linked (must unlink from Sound tab)
              className="pointer-events-auto w-6 h-6 flex items-center justify-center rounded-full transition-colors"
              style={{
                backgroundColor: 'transparent',
                color: linkButtonConfig.color,
                opacity: isLinked ? 0.6 : 1,
                cursor: isLinked ? 'not-allowed' : 'pointer'
              }}
              title={linkButtonConfig.title}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
            </button>

            {/* Impact Sound button - small icon version */}
            {onModalImpact && (
              <button
                onClick={() => !isAnalyzing && onModalImpact(entity)}
                disabled={isAnalyzing}
                className="pointer-events-auto w-6 h-6 flex items-center justify-center rounded-full transition-colors"
                style={{
                  backgroundColor: isAnalyzed
                    ? `${UI_COLORS.SUCCESS}20`
                    : isAnalyzing
                      ? `${UI_COLORS.NEUTRAL_500}20`
                      : `${UI_COLORS.PRIMARY}20`,
                  color: isAnalyzed
                    ? UI_COLORS.SUCCESS
                    : isAnalyzing
                      ? UI_COLORS.NEUTRAL_500
                      : UI_COLORS.PRIMARY,
                  opacity: isAnalyzing ? 0.4 : 1,
                  cursor: isAnalyzing ? 'not-allowed' : 'pointer',
                }}
                onMouseEnter={(e) => {
                  if (!isAnalyzing) {
                    e.currentTarget.style.transform = 'scale(1.1)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isAnalyzing) {
                    e.currentTarget.style.transform = 'scale(1)';
                  }
                }}
                title="Impact sound"
              >
              {isAnalyzing ? (
                <svg
                  className="animate-spin"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <circle
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeDasharray="60"
                    strokeDashoffset="40"
                  />
                </svg>
              ) : (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="m15 12-8.5 8.5c-.83.83-2.17.83-3 0 0 0 0 0 0 0a2.12 2.12 0 0 1 0-3L12 9" />
                  <path d="M17.64 15 22 10.64" />
                  <path d="m20.91 11.7-1.25-1.25c-.6-.6-.93-1.4-.93-2.25V3h-5.25c-.85 0-1.65.33-2.25.93L10 5.18" />
                </svg>
              )}
              </button>
            )}
          </div>
        </div>

        {/* Entity Details */}
        <div className="space-y-1 text-xs">
          <div className="flex justify-between">
            <span style={{ color: UI_COLORS.NEUTRAL_400 }}>Type:</span>
            <span style={{ color: 'white' }}>{entity.type}</span>
          </div>

          {/* Show Speckle object name if provided, otherwise entity name */}
          {(speckleObjectName || entity.name) && (
            <div className="flex justify-between">
              <span style={{ color: UI_COLORS.NEUTRAL_400 }}>Name:</span>
              <span style={{ color: 'white' }}>{speckleObjectName || entity.name}</span>
            </div>
          )}

          {/* Show parent name only for Speckle objects */}
          {speckleParentName && (
            <div className="flex justify-between">
              <span style={{ color: UI_COLORS.NEUTRAL_400 }}>Parent:</span>
              <span style={{ color: 'white' }}>{speckleParentName}</span>
            </div>
          )}

          {/* Show position only for non-Speckle objects (when speckleObjectName is not provided) */}
          {!speckleObjectName && (
            <div className="flex justify-between">
              <span style={{ color: UI_COLORS.NEUTRAL_400 }}>Position:</span>
              <span className="font-mono text-xs" style={{ color: 'white' }}>
                ({entity.position[0]?.toFixed(1) ?? '0'}, {entity.position[1]?.toFixed(1) ?? '0'}, {entity.position[2]?.toFixed(1) ?? '0'})
              </span>
            </div>
          )}

          {/* Linked Sound Information */}
          {isLinked && linkedSoundIndex !== undefined && (
            <div className="pt-2 mt-2" style={{ borderTop: `1px solid ${UI_OVERLAY.BORDER_COLOR}` }}>
              <div className="flex justify-between items-center">
                <span style={{ color: UI_COLORS.NEUTRAL_400 }}>Linked to:</span>
                <div className="flex items-center gap-1">
                  <span className="font-medium" style={{ color: SPECKLE_FILTER_COLORS.SOUND_LINKED }}>
                    Sound #{linkedSoundIndex + 1}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Diverse Selection Information */}
          {isDiverse && !isLinked && (
            <div className="pt-2 mt-2" style={{ borderTop: `1px solid ${UI_OVERLAY.BORDER_COLOR}` }}>
              <div className="flex justify-between items-center">
                <span style={{ color: UI_COLORS.NEUTRAL_400 }}>Status:</span>
                <span className="font-medium" style={{ color: SPECKLE_FILTER_COLORS.DIVERSE_SELECTION }}>
                  Diverse Selection
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
