'use client';

import { useState, useCallback } from 'react';
import { useSpeckleStore, useAudioControlsStore } from '@/store';
import { SoundResultContent } from '@/components/layout/sidebar/sound/SoundResultContent';
import { VariantsBar } from '@/components/ui/VariantsBar';
import type { SoundEvent } from '@/types';

// ============================================================================
// Component
// ============================================================================

/**
 * EntityInfoPanel Component
 *
 * Embedded version of EntityInfoBox for display in RightSidebar / right-click menu.
 * Modes:
 * - Receiver: receiver details with go-to button
 * - Sound: sound result/preview controls
 * - Default: entity information (Type, Name, Parent, Object ID)
 *
 * NOTE: Acoustic material/scattering assignment has moved to the Object Explorer
 * (two extra columns shown while a Pyroom/Choras card is active).
 */

interface EntityInfoPanelProps {
  onGoToReceiver?: (receiverId: string) => void;
  /** Still passed from parent — SoundEvent list owned by useSoundGeneration (not yet migrated). */
  generatedSounds?: SoundEvent[];
}

export function EntityInfoPanel({
  onGoToReceiver,
  generatedSounds,
}: EntityInfoPanelProps) {
  const { selectedEntity } = useSpeckleStore();

  // ── Audio controls store ──
  const selectedVariants = useAudioControlsStore((s) => s.selectedVariants);
  const soundVolumes = useAudioControlsStore((s) => s.soundVolumes);
  const soundIntervals = useAudioControlsStore((s) => s.soundIntervals);
  const soundIntervalJitter = useAudioControlsStore((s) => s.soundIntervalJitter);
  const mutedSounds = useAudioControlsStore((s) => s.mutedSounds);
  const onVolumeChange = useAudioControlsStore((s) => s.handleVolumeChange);
  const onIntervalChange = useAudioControlsStore((s) => s.handleIntervalChange);
  const onVariantChange = useAudioControlsStore((s) => s.handleVariantChange);

  // Local independent playback state for the EntityInfoPanel sound player
  const [localPreviewId, setLocalPreviewId] = useState<string | null>(null);

  const handleLocalPlayPause = useCallback((soundId: string) => {
    setLocalPreviewId(prev => prev === soundId ? null : soundId);
  }, []);

  const handleLocalStop = useCallback((soundId: string) => {
    setLocalPreviewId(prev => prev === soundId ? null : prev);
  }, []);

  // ===== RECEIVER INFORMATION MODE =====
  if (selectedEntity?.objectType === 'Receiver' && selectedEntity.receiverData) {
    const receiverColor = 'var(--color-receiver)';
    return (
      <div className="flex flex-col gap-2 text-xs">
        {/* ID row + go-to button */}
        <div className="flex items-center justify-between text-foreground">
          <div className="flex items-center gap-1 min-w-0">
            <span className="flex-shrink-0">ID:</span>
            <span className="mx-1 truncate" title={selectedEntity.objectId}>
              {selectedEntity.objectId}
            </span>
          </div>
          {onGoToReceiver && (
            <button
              onClick={() => onGoToReceiver(selectedEntity.objectId)}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'white';
                e.currentTarget.style.backgroundColor = receiverColor;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = receiverColor;
                e.currentTarget.style.backgroundColor = 'transparent';
              }}
              className="w-7 h-7 flex-shrink-0 flex items-center justify-center rounded transition-colors"
              style={{ color: receiverColor, borderRadius: '6px' }}
              title="Go to receiver (first-person view)"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>
          )}
        </div>
      </div>
    );
  }

  // ===== SOUND INFORMATION MODE =====
  if (selectedEntity?.objectType === 'Sound' && selectedEntity.soundData && generatedSounds) {
    const { promptIndex } = selectedEntity.soundData;
    const variants = generatedSounds.filter(s => s.prompt_index === promptIndex);

    if (variants.length > 0) {
      const selectedVariantIdx = selectedVariants?.[promptIndex] ?? 0;
      const generatedSound = variants[selectedVariantIdx] || variants[0];
      const isMuted = mutedSounds?.has(generatedSound.id) ?? false;

      return (
        <div className="flex flex-col gap-2 min-w-0">
          <SoundResultContent
            generatedSound={generatedSound}
            index={promptIndex}
            variants={variants}
            selectedVariantIdx={selectedVariantIdx}
            isPreviewPlaying={localPreviewId === generatedSound.id}
            isMuted={isMuted}
            soundVolumes={soundVolumes ?? {}}
            soundIntervals={soundIntervals ?? {}}
            soundIntervalJitter={soundIntervalJitter ?? {}}
            onPreviewPlayPause={handleLocalPlayPause}
            onPreviewStop={handleLocalStop}
            onVolumeChange={onVolumeChange}
            onIntervalChange={onIntervalChange}
          />
          <VariantsBar
            items={variants.map((v, i) => ({ key: v.id, title: String.fromCharCode(65 + i) }))}
            selectedIndex={selectedVariantIdx}
            onSelect={onVariantChange ? (i) => onVariantChange(promptIndex, i) : undefined}
          />
        </div>
      );
    }
  }

  // ===== DEFAULT: ENTITY INFORMATION MODE =====

  // If no entity selected, show placeholder
  if (!selectedEntity) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-4">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-12 w-12 mb-3"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          style={{ color: 'var(--color-secondary-hover)' }}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122"
          />
        </svg>
        <p className="text-sm" style={{ color: 'var(--color-secondary-hover)' }}>
          Click on an object in the 3D view to see its details
        </p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">

      {/* Entity Details */}
      <div className="space-y-1 text-xs flex-1 overflow-y-auto">
        <div className="flex text-foreground">
          <span>Type:</span>
          <span className="mx-2">{selectedEntity.objectType}</span>
        </div>

        {selectedEntity.objectName && (
          <div className="flex text-foreground">
            <span>Name:</span>
            <span
              className="text-right mx-2 max-w-[180px] truncate"
              title={selectedEntity.objectName}
            >
              {selectedEntity.objectName}
            </span>
          </div>
        )}

        {selectedEntity.parentName && (
          <div className="flex text-foreground">
            <span>Parent:</span>
            <span
              className="text mx-2 max-w-[180px] truncate"
              title={selectedEntity.parentName}
            >
              {selectedEntity.parentName}
            </span>
          </div>
        )}

        {selectedEntity.objectId && (
          <div className="flex text-foreground">
            <span>Object ID:</span>
            <span
              className="text-right mx-2 max-w-[160px] truncate"
              title={selectedEntity.objectId}
            >
              {selectedEntity.objectId}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

