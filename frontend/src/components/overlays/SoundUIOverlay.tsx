import { useState, useRef, useCallback, useEffect } from 'react';
import type { UIOverlay, SoundState } from '@/types';
import { RangeSlider } from '@/components/ui/RangeSlider';
import { ButtonGroup } from '@/components/ui/ButtonGroup';
import { UI_VOLUME_SLIDER, UI_INTERVAL_SLIDER, UI_OVERLAY, UI_COLORS } from '@/lib/constants';

interface SoundUIOverlayProps {
  overlay: UIOverlay;
  soundState: SoundState;
  onToggleSound: (soundId: string) => void;
  onVariantChange: (promptIdx: number, variantIdx: number) => void;
  onVolumeChange?: (soundId: string, volumeDb: number) => void;
  onIntervalChange?: (soundId: string, intervalSeconds: number) => void;
  onDelete?: (soundId: string, promptIdx: number) => void;
  onHideToggle?: (promptKey: string) => void;
  onDragUpdate?: (promptKey: string, deltaX: number, deltaY: number) => void;
  onMute?: (soundId: string) => void;
  onSolo?: (soundId: string) => void;
  isMuted?: boolean;
  isSoloed?: boolean;
}

export function SoundUIOverlay({
  overlay,
  soundState,
  onToggleSound,
  onVariantChange,
  onVolumeChange,
  onIntervalChange,
  onDelete,
  onHideToggle,
  onDragUpdate,
  onMute,
  onSolo,
  isMuted = false,
  isSoloed = false
}: SoundUIOverlayProps) {
  const hasMultipleVariants = overlay.variants.length > 1;
  const selectedSound = overlay.variants[overlay.selectedVariantIdx];
  const currentVolumeDb = selectedSound?.current_volume_db ?? selectedSound?.volume_db ?? 70;
  const currentIntervalSeconds = selectedSound?.current_interval_seconds ?? selectedSound?.interval_seconds ?? 30;

  // Dragging state
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const onDragUpdateRef = useRef(onDragUpdate);
  const promptKeyRef = useRef(overlay.promptKey);

  // Update refs when props change
  useEffect(() => {
    onDragUpdateRef.current = onDragUpdate;
    promptKeyRef.current = overlay.promptKey;
  }, [onDragUpdate, overlay.promptKey]);

  const handleDelete = () => {
    if (onDelete && selectedSound) {
      onDelete(selectedSound.id, overlay.promptIdx);
    }
  };

  const handleHideToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onHideToggle) {
      onHideToggle(overlay.promptKey);
    }
  };

  // Drag handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Only drag when clicking on the header/title area, not on buttons or controls
    if (
      e.target instanceof HTMLElement &&
      (e.target.tagName === 'BUTTON' || 
       e.target.tagName === 'INPUT' ||
       e.target.closest('button') ||
       e.target.closest('input'))
    ) {
      return;
    }

    setIsDragging(true);
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    e.preventDefault();
    e.stopPropagation();
  }, []);

  // Add/remove global mouse event listeners for dragging
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStartRef.current || !onDragUpdateRef.current) return;

      const deltaX = e.clientX - dragStartRef.current.x;
      const deltaY = e.clientY - dragStartRef.current.y;

      onDragUpdateRef.current(promptKeyRef.current, deltaX, deltaY);
      dragStartRef.current = { x: e.clientX, y: e.clientY };
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      dragStartRef.current = null;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  return (
    <div
      className="absolute pointer-events-auto"
      style={{
        left: `${overlay.x}px`,
        top: `${overlay.y}px`,
        transform: 'translate(-50%, -100%)',
        display: overlay.visible && !overlay.userHidden ? 'block' : 'none',
        zIndex: 1000,
        cursor: isDragging ? 'grabbing' : 'grab'
      }}
      onMouseDown={handleMouseDown}
    >
      {/* Distance indicator - positioned above the close button, outside the overlay box */}
      {overlay.distance !== undefined && (
        <div
          className="absolute top-0 right-0 primary-color text-opacity-60 pointer-events-none"
          style={{
            fontSize: '9px',
            transform: 'translateY(-100%)',
            paddingBottom: '2px',
            fontFamily: 'monospace'

          }}
        >
          {overlay.distance.toFixed(1)}m
        </div>
      )}
      <div
        className="backdrop-blur-sm rounded-lg shadow-xl border"
        style={{
          background: UI_OVERLAY.BACKGROUND,
          borderRadius: `${UI_OVERLAY.BORDER_RADIUS}px`,
          borderColor: UI_OVERLAY.BORDER_COLOR,
          borderWidth: `${UI_OVERLAY.BORDER_WIDTH}px`,
          padding: `${UI_OVERLAY.PADDING}px`,
          width: UI_OVERLAY.WIDTH  // Match EntityInfoBox width
        }}
      >
        {/* Header with title and buttons */}
        <div className="flex items-center justify-between mb-2">
          <div className="text-white font-semibold text-sm flex-1 text-center">
            {overlay.displayName}
          </div>
          <div className="flex items-center gap-1 ml-2">
            {onHideToggle && (
              <button
                onClick={handleHideToggle}
                className="text-yellow-400 hover:text-yellow-300 transition-colors text-lg leading-none px-1"
                title="Hide overlay"
              >
                −
              </button>
            )}
            {onDelete && (
              <button
                onClick={handleDelete}
                className="hover:text-red-400 transition-colors text-lg leading-none px-1"
                style={{ color: UI_COLORS.ERROR }}
                title="Delete sound"
              >
                ×
              </button>
            )}
          </div>
        </div>

        {/* Variant selector if multiple variants */}
        {hasMultipleVariants && (
          <div className="mb-2">
            <div className="flex gap-1 justify-center">
              {overlay.variants.map((_, idx) => (
                <button
                  key={idx}
                  onClick={() => onVariantChange(overlay.promptIdx, idx)}
                  className={`px-2 py-1 text-xs rounded transition-colors ${
                    idx === overlay.selectedVariantIdx
                      ? 'text-white'
                      : 'text-gray-300 hover:bg-gray-700'
                  }`}
                  style={{
                    backgroundColor: idx === overlay.selectedVariantIdx ? UI_COLORS.PRIMARY : UI_COLORS.NEUTRAL_700
                  }}
                >
                  {idx + 1}
                </button>
              ))}
            </div>
            <div className="text-gray-400 text-xs text-center mt-1">
              Variant {overlay.selectedVariantIdx + 1}/{overlay.variants.length}
            </div>
          </div>
        )}

        {/* Volume slider */}
        {onVolumeChange && (
          <RangeSlider
            label={UI_VOLUME_SLIDER.LABEL}
            value={currentVolumeDb}
            min={UI_VOLUME_SLIDER.MIN}
            max={UI_VOLUME_SLIDER.MAX}
            step={UI_VOLUME_SLIDER.STEP}
            onChange={(value) => selectedSound && onVolumeChange(selectedSound.id, value)}
            minLabel={UI_VOLUME_SLIDER.MIN_LABEL}
            maxLabel={UI_VOLUME_SLIDER.MAX_LABEL}
            formatValue={(v) => v.toFixed(0)}
            className="mb-2"
          />
        )}

        {/* Interval slider */}
        {onIntervalChange && (
          <RangeSlider
            label={UI_INTERVAL_SLIDER.LABEL}
            value={currentIntervalSeconds}
            min={UI_INTERVAL_SLIDER.MIN}
            max={UI_INTERVAL_SLIDER.MAX}
            step={UI_INTERVAL_SLIDER.STEP}
            onChange={(value) => selectedSound && onIntervalChange(selectedSound.id, value)}
            minLabel={UI_INTERVAL_SLIDER.MIN_LABEL}
            maxLabel={UI_INTERVAL_SLIDER.MAX_LABEL}
            formatValue={(v) => v === 0 ? UI_INTERVAL_SLIDER.LOOP_TEXT : v.toFixed(0)}
            className="mb-2"
          />
        )}

        {/* Mute and Solo buttons */}
        {onMute && onSolo && (
          <ButtonGroup
            buttons={[
              {
                label: isMuted ? '🔇 Muted' : '🔊 Mute',
                onClick: () => onMute(overlay.soundId),
                isActive: isMuted,
                activeColor: UI_COLORS.WARNING,
                inactiveColor: UI_COLORS.NEUTRAL_700,
                title: isMuted ? 'Unmute' : 'Mute'
              },
              {
                label: isSoloed ? '⭐ Solo' : 'Solo',
                onClick: () => onSolo(overlay.soundId),
                isActive: isSoloed,
                activeColor: UI_COLORS.PRIMARY,
                inactiveColor: UI_COLORS.NEUTRAL_700,
                title: isSoloed ? 'Unsolo' : 'Solo'
              }
            ]}
          />
        )}
      </div>
    </div>
  );
}
