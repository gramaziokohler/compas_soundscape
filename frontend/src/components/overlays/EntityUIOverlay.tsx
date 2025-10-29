"use client";

import type { EntityOverlay } from "@/types";
import type { SoundState } from "@/types";
import { UI_VOLUME_SLIDER, UI_INTERVAL_SLIDER } from "@/lib/constants";

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
  isSoloed = false
}: EntityUIOverlayProps) {
  if (!overlay.visible) return null;

  const { entity, soundOverlay, x, y } = overlay;
  const hasSound = soundOverlay !== undefined;
  const selectedSound = soundOverlay?.variants[soundOverlay.selectedVariantIdx];
  const currentVolumeDb = selectedSound?.current_volume_db ?? selectedSound?.volume_db ?? 70;
  const currentIntervalSeconds = selectedSound?.current_interval_seconds ?? selectedSound?.interval_seconds ?? 30;

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
      <div className="bg-white/95 backdrop-blur-sm border border-gray-300 rounded-lg shadow-lg p-3 mb-2 min-w-[200px]">
        <div className="text-sm space-y-1">
          <div className="font-semibold text-gray-900 border-b border-gray-200 pb-1 mb-2">
            Entity Information
          </div>

          {entity.name && (
            <div className="flex justify-between">
              <span className="text-gray-600">Name:</span>
              <span className="text-gray-900 font-medium">{entity.name}</span>
            </div>
          )}

          <div className="flex justify-between">
            <span className="text-gray-600">Type:</span>
            <span className="text-gray-900 font-medium">{entity.type}</span>
          </div>

          {entity.layer && (
            <div className="flex justify-between">
              <span className="text-gray-600">Layer:</span>
              <span className="text-gray-900 font-medium">{entity.layer}</span>
            </div>
          )}

          {entity.material && (
            <div className="flex justify-between">
              <span className="text-gray-600">Material:</span>
              <span className="text-gray-900 font-medium">{entity.material}</span>
            </div>
          )}

          <div className="flex justify-between">
            <span className="text-gray-600">Index:</span>
            <span className="text-gray-900 font-medium">{entity.index}</span>
          </div>

          <div className="text-xs text-gray-500 mt-2 pt-2 border-t border-gray-200">
            Position: ({entity.position[0].toFixed(2)}, {entity.position[1].toFixed(2)}, {entity.position[2].toFixed(2)})
          </div>
        </div>
      </div>

      {/* Sound Controls Box (if entity has linked sound) */}
      {hasSound && soundOverlay && selectedSound && (
        <div className="bg-white/95 backdrop-blur-sm border border-gray-300 rounded-lg shadow-lg p-3 min-w-[200px] pointer-events-auto">
          <div className="text-sm space-y-2">
            {/* Sound Title */}
            <div className="flex items-center justify-between border-b border-gray-200 pb-2">
              <div className="font-semibold text-gray-900 truncate flex-1">
                {soundOverlay.displayName}
              </div>
              <button
                onClick={handleDelete}
                className="ml-2 text-gray-400 hover:text-red-500 transition-colors flex-shrink-0 pointer-events-auto"
                title="Delete sound"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Mute and Solo buttons */}
            <div className="flex gap-2">
              {onMute && selectedSound && (
                <button
                  onClick={() => onMute(selectedSound.id)}
                  className={`flex-1 py-2 px-4 rounded transition-colors flex items-center justify-center gap-2 pointer-events-auto ${
                    isMuted
                      ? 'bg-yellow-500 text-white hover:bg-yellow-600'
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  }`}
                  title={isMuted ? 'Unmute' : 'Mute'}
                >
                  {isMuted ? (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM12.293 7.293a1 1 0 011.414 0L15 8.586l1.293-1.293a1 1 0 111.414 1.414L16.414 10l1.293 1.293a1 1 0 01-1.414 1.414L15 11.414l-1.293 1.293a1 1 0 01-1.414-1.414L13.586 10l-1.293-1.293a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                      Muted
                    </>
                  ) : (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.983 0 0115 10a5.984 5.984 0 01-1.757 4.243 1 1 0 01-1.415-1.415A3.984 3.984 0 0013 10a3.983 3.983 0 00-1.172-2.828 1 1 0 010-1.415z" clipRule="evenodd" />
                      </svg>
                      Mute
                    </>
                  )}
                </button>
              )}
              {onSolo && selectedSound && (
                <button
                  onClick={() => onSolo(selectedSound.id)}
                  className={`flex-1 py-2 px-4 rounded transition-colors flex items-center justify-center gap-2 pointer-events-auto ${
                    isSoloed
                      ? 'bg-primary text-white hover:bg-primary/90'
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  }`}
                  title={isSoloed ? 'Unsolo' : 'Solo'}
                >
                  {isSoloed ? (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                      </svg>
                      Solo
                    </>
                  ) : (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                      </svg>
                      Solo
                    </>
                  )}
                </button>
              )}
            </div>

            {/* Variant Selector */}
            {soundOverlay.variants.length > 1 && (
              <div className="space-y-1">
                <label className="text-xs text-gray-600">Variant:</label>
                <select
                  value={soundOverlay.selectedVariantIdx}
                  onChange={(e) => onVariantChange && onVariantChange(soundOverlay.promptIdx, parseInt(e.target.value))}
                  className="w-full px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-primary pointer-events-auto"
                >
                  {soundOverlay.variants.map((_, idx) => (
                    <option key={idx} value={idx}>
                      Variant {idx + 1}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Volume Control */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs text-gray-600">
                <span>{UI_VOLUME_SLIDER.LABEL}:</span>
                <span className="font-mono text-gray-900 font-medium">{currentVolumeDb.toFixed(0)}</span>
              </div>
              <input
                type="range"
                min={UI_VOLUME_SLIDER.MIN}
                max={UI_VOLUME_SLIDER.MAX}
                step={UI_VOLUME_SLIDER.STEP}
                value={currentVolumeDb}
                onChange={handleVolumeChange}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-primary pointer-events-auto"
              />
              <div className="flex justify-between text-xs text-gray-400">
                <span>{UI_VOLUME_SLIDER.MIN_LABEL}</span>
                <span>{UI_VOLUME_SLIDER.MAX_LABEL}</span>
              </div>
            </div>

            {/* Interval Control */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs text-gray-600">
                <span>{UI_INTERVAL_SLIDER.LABEL}:</span>
                <span className="font-mono text-gray-900 font-medium">{currentIntervalSeconds === 0 ? UI_INTERVAL_SLIDER.LOOP_TEXT : currentIntervalSeconds.toFixed(0)}</span>
              </div>
              <input
                type="range"
                min={UI_INTERVAL_SLIDER.MIN}
                max={UI_INTERVAL_SLIDER.MAX}
                step={UI_INTERVAL_SLIDER.STEP}
                value={currentIntervalSeconds}
                onChange={handleIntervalChange}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-primary pointer-events-auto"
              />
              <div className="flex justify-between text-xs text-gray-400">
                <span>{UI_INTERVAL_SLIDER.MIN_LABEL}</span>
                <span>{UI_INTERVAL_SLIDER.MAX_LABEL}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
