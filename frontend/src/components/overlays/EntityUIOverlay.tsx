"use client";

import type { EntityOverlay } from "@/types";
import type { SoundState } from "@/types";
import { RangeSlider } from "@/components/ui/RangeSlider";
import { ButtonGroup } from "@/components/ui/ButtonGroup";
import { UI_VOLUME_SLIDER, UI_INTERVAL_SLIDER, UI_OVERLAY, UI_COLORS } from "@/lib/constants";

interface EntityUIOverlayProps {
  overlay: EntityOverlay;
  soundState?: SoundState;
  onToggleSound?: (soundId: string) => void;
  onVariantChange?: (promptIdx: number, variantIdx: number) => void;
  onVolumeChange?: (soundId: string, volumeDb: number) => void;
  onIntervalChange?: (soundId: string, intervalSeconds: number) => void;
  onDelete?: (soundId: string, promptIdx: number) => void;
  onMute?: (soundId: string) => void;
  onSolo?: (soundId: string) => void;
  isMuted?: boolean;
  isSoloed?: boolean;
  onModalImpact?: () => void;  // NEW: Callback for modal impact button
}

export function EntityUIOverlay({ 
  overlay, 
  soundState = 'stopped',
  onToggleSound,
  onVariantChange,
  onVolumeChange,
  onIntervalChange,
  onDelete,
  onMute,
  onSolo,
  isMuted = false,
  isSoloed = false,
  onModalImpact  // NEW
}: EntityUIOverlayProps) {
  if (!overlay.visible) return null;

  const { entity, soundOverlay, x, y } = overlay;
  const hasSound = soundOverlay !== undefined;
  const selectedSound = soundOverlay?.variants[soundOverlay.selectedVariantIdx];
  const currentVolumeDb = selectedSound?.current_volume_db ?? selectedSound?.volume_db ?? 70;
  const currentIntervalSeconds = selectedSound?.current_interval_seconds ?? selectedSound?.interval_seconds ?? 30;

  const handleDelete = () => {
    if (onDelete && selectedSound && soundOverlay) {
      onDelete(selectedSound.id, soundOverlay.promptIdx);
    }
  };

  const handleToggleSound = () => {
    if (onToggleSound && selectedSound) {
      onToggleSound(selectedSound.id);
    }
  };

  return (
    <div
      className="absolute pointer-events-none"
      style={{
        left: `${x}px`,
        top: `${y}px`,
        transform: 'translate(-50%, -100%)',
      }}
    >
      {/* Entity Information Box */}
      <div 
        className="backdrop-blur-sm shadow-lg mb-2"
        style={{
          background: UI_OVERLAY.BACKGROUND,
          borderRadius: `${UI_OVERLAY.BORDER_RADIUS}px`,
          borderColor: UI_OVERLAY.BORDER_COLOR,
          borderWidth: `${UI_OVERLAY.BORDER_WIDTH}px`,
          borderStyle: 'solid',
          padding: `${UI_OVERLAY.PADDING}px`,
          minWidth: '240px'
        }}
      >
        {/* Modal Impact Button - Top Right */}
        {onModalImpact && (
          <div className="flex justify-end mb-2">
            <button
              onClick={onModalImpact}
              className="pointer-events-auto px-3 py-1.5 text-sm font-medium rounded transition-all"
              style={{
                backgroundColor: UI_COLORS.PRIMARY,
                color: 'white',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = UI_COLORS.PRIMARY_HOVER;
                e.currentTarget.style.transform = 'scale(1.05)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = UI_COLORS.PRIMARY;
                e.currentTarget.style.transform = 'scale(1)';
              }}
              title="Analyze vibration modes and enable impact sounds"
            >
              🔊 Impact Sound
            </button>
          </div>
        )}

        <div className="text-sm space-y-1">
          <div className="font-semibold border-b pb-1 mb-2" style={{ color: 'white', borderColor: `${UI_OVERLAY.BORDER_COLOR}` }}>
            Entity Information
          </div>

          {entity.name && (
            <div className="flex justify-between">
              <span style={{ color: UI_COLORS.NEUTRAL_400 }}>Name:</span>
              <span className="font-medium" style={{ color: 'white' }}>{entity.name}</span>
            </div>
          )}

          <div className="flex justify-between">
            <span style={{ color: UI_COLORS.NEUTRAL_400 }}>Type:</span>
            <span className="font-medium" style={{ color: 'white' }}>{entity.type}</span>
          </div>

          {entity.layer && (
            <div className="flex justify-between">
              <span style={{ color: UI_COLORS.NEUTRAL_400 }}>Layer:</span>
              <span className="font-medium" style={{ color: 'white' }}>{entity.layer}</span>
            </div>
          )}

          {entity.material && (
            <div className="flex justify-between">
              <span style={{ color: UI_COLORS.NEUTRAL_400 }}>Material:</span>
              <span className="font-medium" style={{ color: 'white' }}>{entity.material}</span>
            </div>
          )}

          <div className="flex justify-between">
            <span style={{ color: UI_COLORS.NEUTRAL_400 }}>Index:</span>
            <span className="font-medium" style={{ color: 'white' }}>{entity.index}</span>
          </div>

          <div className="text-xs mt-2 pt-2" style={{ color: UI_COLORS.NEUTRAL_400, borderTop: `1px solid ${UI_OVERLAY.BORDER_COLOR}` }}>
            Position: ({entity.position[0].toFixed(2)}, {entity.position[1].toFixed(2)}, {entity.position[2].toFixed(2)})
          </div>
        </div>
      </div>

      {/* Sound Controls Box (if entity has linked sound) */}
      {hasSound && soundOverlay && selectedSound && (
        <div 
          className="backdrop-blur-sm shadow-lg pointer-events-auto"
          style={{
            background: UI_OVERLAY.BACKGROUND,
            borderRadius: `${UI_OVERLAY.BORDER_RADIUS}px`,
            borderColor: UI_OVERLAY.BORDER_COLOR,
            borderWidth: `${UI_OVERLAY.BORDER_WIDTH}px`,
            borderStyle: 'solid',
            padding: `${UI_OVERLAY.PADDING}px`,
            minWidth: '240px'
          }}
        >
          <div className="text-sm space-y-2">
            {/* Sound Title */}
            <div className="flex items-center justify-between pb-2" style={{ borderBottom: `1px solid ${UI_OVERLAY.BORDER_COLOR}` }}>
              <div className="font-semibold truncate flex-1" style={{ color: 'white' }}>
                {soundOverlay.displayName}
              </div>
              <button
                onClick={handleDelete}
                className="ml-2 transition-colors flex-shrink-0 pointer-events-auto"
                style={{ color: UI_COLORS.NEUTRAL_400 }}
                onMouseEnter={(e) => e.currentTarget.style.color = UI_COLORS.ERROR}
                onMouseLeave={(e) => e.currentTarget.style.color = UI_COLORS.NEUTRAL_400}
                title="Delete sound"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Mute and Solo buttons */}
            {onMute && onSolo && selectedSound && (
              <ButtonGroup
                buttons={[
                  {
                    label: isMuted ? '🔇 Muted' : '🔊 Mute',
                    onClick: () => onMute(selectedSound.id),
                    isActive: isMuted,
                    activeColor: UI_COLORS.WARNING,
                    inactiveColor: UI_COLORS.NEUTRAL_200,
                    title: isMuted ? 'Unmute' : 'Mute'
                  },
                  {
                    label: isSoloed ? '⭐ Solo' : 'Solo',
                    onClick: () => onSolo(selectedSound.id),
                    isActive: isSoloed,
                    activeColor: UI_COLORS.PRIMARY,
                    inactiveColor: UI_COLORS.NEUTRAL_200,
                    title: isSoloed ? 'Unsolo' : 'Solo'
                  }
                ]}
              />
            )}

            {/* Variant Selector */}
            {soundOverlay.variants.length > 1 && (
              <div className="space-y-1">
                <label className="text-xs" style={{ color: UI_COLORS.NEUTRAL_400 }}>Variant:</label>
                <select
                  value={soundOverlay.selectedVariantIdx}
                  onChange={(e) => onVariantChange && onVariantChange(soundOverlay.promptIdx, parseInt(e.target.value))}
                  className="w-full px-2 py-1 text-xs rounded focus:outline-none focus:ring-1 pointer-events-auto"
                  style={{ 
                    borderColor: UI_COLORS.NEUTRAL_300,
                    borderWidth: '1px',
                    borderStyle: 'solid',
                    color: 'white',
                    backgroundColor: 'rgba(0, 0, 0, 0.3)'
                  }}
                  onFocus={(e) => e.currentTarget.style.boxShadow = `0 0 0 1px ${UI_COLORS.PRIMARY}`}
                  onBlur={(e) => e.currentTarget.style.boxShadow = 'none'}
                >
                  {soundOverlay.variants.map((_, idx) => (
                    <option key={idx} value={idx} style={{ backgroundColor: '#000', color: 'white' }}>
                      Variant {idx + 1}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Volume Control */}
            {onVolumeChange && selectedSound && (
              <RangeSlider
                label={UI_VOLUME_SLIDER.LABEL}
                value={currentVolumeDb}
                min={UI_VOLUME_SLIDER.MIN}
                max={UI_VOLUME_SLIDER.MAX}
                step={UI_VOLUME_SLIDER.STEP}
                onChange={(value) => onVolumeChange(selectedSound.id, value)}
                minLabel={UI_VOLUME_SLIDER.MIN_LABEL}
                maxLabel={UI_VOLUME_SLIDER.MAX_LABEL}
                formatValue={(v) => v.toFixed(0)}
                valueColor="white"
                className="space-y-1"
              />
            )}

            {/* Interval Control */}
            {onIntervalChange && selectedSound && (
              <RangeSlider
                label={UI_INTERVAL_SLIDER.LABEL}
                value={currentIntervalSeconds}
                min={UI_INTERVAL_SLIDER.MIN}
                max={UI_INTERVAL_SLIDER.MAX}
                step={UI_INTERVAL_SLIDER.STEP}
                onChange={(value) => onIntervalChange(selectedSound.id, value)}
                minLabel={UI_INTERVAL_SLIDER.MIN_LABEL}
                maxLabel={UI_INTERVAL_SLIDER.MAX_LABEL}
                formatValue={(v) => v === 0 ? UI_INTERVAL_SLIDER.LOOP_TEXT : v.toFixed(0)}
                valueColor="white"
                className="space-y-1"
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
