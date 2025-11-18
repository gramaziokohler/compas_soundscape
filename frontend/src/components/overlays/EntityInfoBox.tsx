"use client";

import type { EntityData } from "@/types";
import { UI_OVERLAY, UI_COLORS, UI_OPACITY } from "@/lib/constants";

interface EntityInfoBoxProps {
  entity: EntityData;
  x: number;
  y: number;
  onModalImpact?: (entity: EntityData) => void;
  isAnalyzing?: boolean;
  isAnalyzed?: boolean;
  linkedPromptIndex?: number; // Optional prompt index for linked sounds
  isDiverseSelected?: boolean; // Is this entity selected for diverse LLM prompts
  onToggleDiverseSelection?: (entity: EntityData) => void; // Toggle diverse selection
  onDetachSound?: (entity: EntityData) => void; // Detach linked sound (green -> pink)
}

/**
 * EntityInfoBox Component
 * 
 * Displays entity information in a simple overlay box.
 * Does NOT include sound controls - those are handled by SoundUIOverlay.
 * 
 * Usage:
 * - Shows when user clicks on an entity in 3D scene
 * - Displays entity type, ID, and position
 * - Uses consistent overlay styling from design system
 */
export function EntityInfoBox({
  entity,
  x,
  y,
  onModalImpact,
  isAnalyzing = false,
  isAnalyzed = false,
  linkedPromptIndex,
  isDiverseSelected = false,
  onToggleDiverseSelection,
  onDetachSound
}: EntityInfoBoxProps) {
  // Determine link button state: green (linked) > pink (diverse) > grey (unlinked)
  const isLinked = linkedPromptIndex !== undefined;
  const linkButtonColor = isLinked
    ? UI_COLORS.SUCCESS
    : isDiverseSelected
    ? UI_COLORS.PRIMARY
    : UI_COLORS.NEUTRAL_500;

  const linkButtonHoverColor = isLinked
    ? UI_COLORS.SUCCESS_HOVER
    : isDiverseSelected
    ? UI_COLORS.PRIMARY_HOVER
    : UI_COLORS.NEUTRAL_600;

  const linkButtonTitle = isLinked
    ? 'Unlink sound (detach to sound sphere)'
    : isDiverseSelected
    ? 'Remove from diverse selection'
    : 'Add to diverse selection for LLM prompts';

  const handleLinkClick = () => {
    if (isLinked && onDetachSound) {
      // Green -> Pink: Detach sound from entity
      onDetachSound(entity);
    } else if (onToggleDiverseSelection) {
      // Grey <-> Pink: Toggle diverse selection
      onToggleDiverseSelection(entity);
    }
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
            {/* Link to entity button */}
            <button
              onClick={handleLinkClick}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = `${linkButtonHoverColor}20`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
              }}
              className="pointer-events-auto w-6 h-6 flex items-center justify-center rounded-full transition-colors"
              style={{
                backgroundColor: 'transparent',
                color: linkButtonColor
              }}
              title={linkButtonTitle}
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
                  opacity: isAnalyzing ? UI_OPACITY.DISABLED : 1,
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
                  strokeLinecap="round" // Added for consistency
                  strokeLinejoin="round" // Added for consistency
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
          {entity.name && (
            <div className="flex justify-between">
              <span style={{ color: UI_COLORS.NEUTRAL_400 }}>Name:</span>
              <span style={{ color: 'white' }}>{entity.name}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span style={{ color: UI_COLORS.NEUTRAL_400 }}>Position:</span>
            <span className="font-mono text-xs" style={{ color: 'white' }}>
              ({entity.position[0]?.toFixed(1) ?? '0'}, {entity.position[1]?.toFixed(1) ?? '0'}, {entity.position[2]?.toFixed(1) ?? '0'})
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
