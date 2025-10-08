import type { UIOverlay, SoundState } from '@/types';

interface SoundUIOverlayProps {
  overlay: UIOverlay;
  soundState: SoundState;
  onToggleSound: (soundId: string) => void;
  onVariantChange: (promptIdx: number, variantIdx: number) => void;
}

export function SoundUIOverlay({
  overlay,
  soundState,
  onToggleSound,
  onVariantChange
}: SoundUIOverlayProps) {
  const hasMultipleVariants = overlay.variants.length > 1;

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
        {/* Title */}
        <div className="text-white font-semibold text-sm mb-2 text-center">
          {overlay.displayName}
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
                      ? 'bg-[#F500B8] text-white'
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

        {/* Play/Pause button */}
        <button
          onClick={() => onToggleSound(overlay.soundId)}
          className={`w-full py-2 rounded-md text-white font-medium text-sm transition-colors ${
            soundState === 'playing'
              ? 'bg-gray-600 hover:bg-gray-700'
              : 'bg-[#F500B8] hover:bg-[#d600a0]'
          }`}
        >
          {soundState === 'playing' ? '⏸ Pause' : '▶ Play'}
        </button>
      </div>
    </div>
  );
}
