import { useState, useRef, useCallback, useEffect } from 'react';
import type { UIOverlay, SoundState } from '@/types';
import { UI_VOLUME_SLIDER, UI_INTERVAL_SLIDER } from '@/lib/constants';

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

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (onVolumeChange && selectedSound) {
      onVolumeChange(selectedSound.id, parseFloat(e.target.value));
    }
  };

  const handleIntervalChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (onIntervalChange && selectedSound) {
      onIntervalChange(selectedSound.id, parseFloat(e.target.value));
    }
  };

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
      <div className="bg-black/80 backdrop-blur-sm rounded-lg p-3 shadow-xl border border-white/20 min-w-[200px]">
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
                className="text-red-400 hover:text-red-300 transition-colors text-lg leading-none px-1"
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
                      ? 'bg-primary text-white'
                      : 'bg-gray-600 text-gray-300 hover:bg-gray-500'
                  }`}
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
          <div className="mb-2">
            <div className="flex items-center justify-between text-xs text-gray-300 mb-1">
              <span>{UI_VOLUME_SLIDER.LABEL}</span>
              <span className="font-mono text-primary">{currentVolumeDb.toFixed(0)}</span>
            </div>
            <input
              type="range"
              min={UI_VOLUME_SLIDER.MIN}
              max={UI_VOLUME_SLIDER.MAX}
              step={UI_VOLUME_SLIDER.STEP}
              value={currentVolumeDb}
              onChange={handleVolumeChange}
              className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-primary"
            />
            <div className="flex justify-between text-xs text-gray-400 mt-1">
              <span>{UI_VOLUME_SLIDER.MIN_LABEL}</span>
              <span>{UI_VOLUME_SLIDER.MAX_LABEL}</span>
            </div>
          </div>
        )}

        {/* Interval slider */}
        {onIntervalChange && (
          <div className="mb-2">
            <div className="flex items-center justify-between text-xs text-gray-300 mb-1">
              <span>{UI_INTERVAL_SLIDER.LABEL}</span>
              <span className="font-mono text-primary">{currentIntervalSeconds === 0 ? UI_INTERVAL_SLIDER.LOOP_TEXT : currentIntervalSeconds.toFixed(0)}</span>
            </div>
            <input
              type="range"
              min={UI_INTERVAL_SLIDER.MIN}
              max={UI_INTERVAL_SLIDER.MAX}
              step={UI_INTERVAL_SLIDER.STEP}
              value={currentIntervalSeconds}
              onChange={handleIntervalChange}
              className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-primary"
            />
            <div className="flex justify-between text-xs text-gray-400 mt-1">
              <span>{UI_INTERVAL_SLIDER.MIN_LABEL}</span>
              <span>{UI_INTERVAL_SLIDER.MAX_LABEL}</span>
            </div>
          </div>
        )}

        {/* Mute and Solo buttons */}
        <div className="flex gap-2">
          {onMute && (
            <button
              onClick={() => onMute(overlay.soundId)}
              className={`flex-1 py-2 rounded-md font-medium text-sm transition-colors ${
                isMuted
                  ? 'bg-yellow-600 hover:bg-yellow-700 text-white'
                  : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
              }`}
              title={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted ? '🔇 Muted' : '🔊 Mute'}
            </button>
          )}
          {onSolo && (
            <button
              onClick={() => onSolo(overlay.soundId)}
              className={`flex-1 py-2 rounded-md font-medium text-sm transition-colors ${
                isSoloed
                  ? 'bg-primary hover:bg-primary-hover text-white'
                  : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
              }`}
              title={isSoloed ? 'Unsolo' : 'Solo'}
            >
              {isSoloed ? '⭐ Solo' : 'Solo'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
