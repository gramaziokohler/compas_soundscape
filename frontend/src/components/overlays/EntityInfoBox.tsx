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
  isAnalyzed = false
}: EntityInfoBoxProps) {
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
        {/* Modal Impact Button - Top Right */}
        {onModalImpact && (
          <div className="flex justify-end mb-2">
            <button
              onClick={() => !isAnalyzing && onModalImpact(entity)}
              disabled={isAnalyzing}
              className="pointer-events-auto px-3 py-1.5 text-sm font-medium rounded transition-all flex items-center gap-2"
              style={{
                backgroundColor: isAnalyzed 
                  ? UI_COLORS.SUCCESS 
                  : isAnalyzing 
                    ? UI_COLORS.NEUTRAL_700 
                    : UI_COLORS.PRIMARY,
                color: 'white',
                opacity: isAnalyzing ? UI_OPACITY.DISABLED : 1,
                cursor: isAnalyzing ? 'not-allowed' : 'pointer',
              }}
              onMouseEnter={(e) => {
                if (!isAnalyzing) {
                  e.currentTarget.style.backgroundColor = isAnalyzed ? UI_COLORS.SUCCESS_HOVER : UI_COLORS.PRIMARY_HOVER;
                  e.currentTarget.style.transform = 'scale(1.05)';
                }
              }}
              onMouseLeave={(e) => {
                if (!isAnalyzing) {
                  e.currentTarget.style.backgroundColor = isAnalyzed ? UI_COLORS.SUCCESS : UI_COLORS.PRIMARY;
                  e.currentTarget.style.transform = 'scale(1)';
                }
              }}
              title={
                isAnalyzed 
                  ? "Start impact sound mode - click object to generate sounds" 
                  : isAnalyzing 
                    ? "Analyzing vibration modes..." 
                    : "Analyze vibration modes and enable impact sounds"
              }
            >
              {isAnalyzing ? (
                <>
                  {/* Spinning loader */}
                  <svg 
                    className="animate-spin" 
                    width="16" 
                    height="16" 
                    viewBox="0 0 24 24" 
                    fill="none"
                    style={{ opacity: UI_OPACITY.HOVER }}
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
                  <span>Analyzing...</span>
                </>
              ) : isAnalyzed ? (
                <>
                  🔊 Impact Sound
                </>
              ) : (
                <>
                  🔊 Impact Sound
                </>
              )}
            </button>
          </div>
        )}

        {/* Entity Title */}
        <div 
          className="pb-2 mb-2 text-sm font-semibold"
          style={{ 
            borderBottom: `1px solid ${UI_OVERLAY.BORDER_COLOR}`,
            color: 'white'
          }}
        >
          Entity Information
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
