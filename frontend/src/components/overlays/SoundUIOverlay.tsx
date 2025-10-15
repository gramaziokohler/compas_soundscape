import type { UIOverlay, SoundState } from '@/types';

interface SoundUIOverlayProps {
  overlay: UIOverlay;
  soundState: SoundState;
  onToggleSound: (soundId: string) => void;
  onVariantChange: (promptIdx: number, variantIdx: number) => void;
  onVolumeChange?: (soundId: string, volumeDb: number) => void;
  onIntervalChange?: (soundId: string, intervalSeconds: number) => void;
  onDelete?: (soundId: string, promptIdx: number) => void;
}

export function SoundUIOverlay({
  overlay,
  soundState,
  onToggleSound,
  onVariantChange,
  onVolumeChange,
  onIntervalChange,
  onDelete
}: SoundUIOverlayProps) {
  const hasMultipleVariants = overlay.variants.length > 1;
  const selectedSound = overlay.variants[overlay.selectedVariantIdx];
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
    if (onDelete && selectedSound) {
      onDelete(selectedSound.id, overlay.promptIdx);
    }
  };

  return (
    <div
      className="absolute pointer-events-auto"
      style={{
        left: `${overlay.x}px`,
        top: `${overlay.y}px`,
        transform: 'translate(-50%, -100%)',
        display: overlay.visible ? 'block' : 'none',
        zIndex: 1000
      }}
    >
      <div className="bg-black/80 backdrop-blur-sm rounded-lg p-3 shadow-xl border border-white/20 min-w-[200px]">
        {/* Header with title and delete button */}
        <div className="flex items-center justify-between mb-2">
          <div className="text-white font-semibold text-sm flex-1 text-center">
            {overlay.displayName}
          </div>
          {onDelete && (
            <button
              onClick={handleDelete}
              className="ml-2 text-red-400 hover:text-red-300 transition-colors text-lg leading-none"
              title="Delete sound"
            >
              ×
            </button>
          )}
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
              <span>Volume (dB)</span>
              <span className="font-mono text-primary">{currentVolumeDb.toFixed(0)}</span>
            </div>
            <input
              type="range"
              min="30"
              max="120"
              step="1"
              value={currentVolumeDb}
              onChange={handleVolumeChange}
              className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-primary"
            />
            <div className="flex justify-between text-xs text-gray-400 mt-1">
              <span>30</span>
              <span>120</span>
            </div>
          </div>
        )}

        {/* Interval slider */}
        {onIntervalChange && (
          <div className="mb-2">
            <div className="flex items-center justify-between text-xs text-gray-300 mb-1">
              <span>Playback Interval (s)</span>
              <span className="font-mono text-primary">{currentIntervalSeconds === 0 ? 'Loop' : currentIntervalSeconds.toFixed(0)}</span>
            </div>
            <input
              type="range"
              min="0"
              max="300"
              step="5"
              value={currentIntervalSeconds}
              onChange={handleIntervalChange}
              className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-primary"
            />
            <div className="flex justify-between text-xs text-gray-400 mt-1">
              <span>0 (Loop)</span>
              <span>300</span>
            </div>
          </div>
        )}

        {/* Play/Pause button */}
        <button
          onClick={() => onToggleSound(overlay.soundId)}
          className={`w-full py-2 rounded-md text-white font-medium text-sm transition-colors ${
            soundState === 'playing'
              ? 'bg-gray-600 hover:bg-gray-700'
              : 'bg-primary hover:bg-primary-hover'
          }`}
        >
          {soundState === 'playing' ? '⏸ Pause' : '▶ Play'}
        </button>
      </div>
    </div>
  );
}
