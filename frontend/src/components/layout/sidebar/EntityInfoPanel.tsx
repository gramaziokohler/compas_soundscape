'use client';

import {
  useSpeckleStore,
  useAudioControlsStore,
  useSoundscapeStore,
  useUIStore,
} from '@/store';
import { SoundResultContent } from '@/components/layout/sidebar/sound/SoundResultContent';
import { SoundPreContent } from '@/components/layout/sidebar/sound/SoundPreContent';
import { VariantsBar } from '@/components/ui/VariantsBar';
import { createTtsSpeechLines } from '@/hooks/useTtsSpeechLines';
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
 * - Sound: the SAME content as the sound card in SoundGenerationSection — the
 *   generated (blue) card shell with waveform/volume/position/variants, or the
 *   pending config card body (so upload/sample previews work before generation).
 * - Default: entity information (Type, Name, Parent, Object ID)
 *
 * Preview playback shares the global `audioControlsStore` state with the sound
 * card, so playing here synchronizes with the Sounds step. When the matching
 * sound card is mounted in the Sounds step it owns the audible output and this
 * panel mirrors it silently (no double playback).
 *
 * NOTE: Acoustic material/scattering assignment has moved to the Object Explorer
 * (two extra columns shown while a Pyroom/Choras card is active).
 */

interface EntityInfoPanelProps {
  onGoToReceiver?: (receiverId: string) => void;
}

/** Speech-line TTS sounds encode the card index as `prompt_index / 10000`. */
function toCardIndex(promptIndex: number): number {
  return promptIndex >= 10000 ? Math.floor(promptIndex / 10000) : promptIndex;
}

/**
 * Match a generated event to a sound card index (handles TTS speech-line encoding).
 * Pending placeholders and iteration clones are never "generated" variants.
 */
function matchesCard(sound: SoundEvent, cardIndex: number): boolean {
  if (sound.isPending) return false;
  if (String(sound.id).includes('_iter_')) return false;
  const pi = sound.prompt_index;
  if (pi === undefined) return false;
  if (pi === cardIndex) return true;
  if (pi >= 10000 && Math.floor(pi / 10000) === cardIndex) return true;
  return false;
}

export function EntityInfoPanel({
  onGoToReceiver,
}: EntityInfoPanelProps) {
  const { selectedEntity } = useSpeckleStore();

  // ── Shared preview/playback state (same store the sound card uses) ──
  const selectedVariants = useAudioControlsStore((s) => s.selectedVariants);
  const soundVolumes = useAudioControlsStore((s) => s.soundVolumes);
  const mutedSounds = useAudioControlsStore((s) => s.mutedSounds);
  const previewingSoundId = useAudioControlsStore((s) => s.previewingSoundId);
  const onVolumeChange = useAudioControlsStore((s) => s.handleVolumeChange);
  const onVariantChange = useAudioControlsStore((s) => s.handleVariantChange);
  const onMute = useAudioControlsStore((s) => s.handleMute);
  const onPreviewPlayPause = useAudioControlsStore((s) => s.handlePreviewPlayPause);
  const onPreviewStop = useAudioControlsStore((s) => s.handlePreviewStop);

  // ── Sound card config + handlers (so a pending card matches too) ──
  // The REAL generated events (same array the sound section uses) — never the
  // scene's unified list, which also contains pending placeholders and iteration
  // clones that would resolve to the wrong variant / an empty audio URL.
  const generatedSounds = useSoundscapeStore((s) => s.generatedSounds);
  const soundConfigs = useSoundscapeStore((s) => s.soundConfigs);
  const isSoundGenerating = useSoundscapeStore((s) => s.isSoundGenerating);
  const soundGenTargetIndices = useSoundscapeStore((s) => s.soundGenTargetIndices);
  const regeneratingIndices = useSoundscapeStore((s) => s.regeneratingIndices);
  const onUpdateConfig = useSoundscapeStore((s) => s.handleUpdateConfig);
  const onUploadAudio = useSoundscapeStore((s) => s.handleUploadAudio);
  const onClearUploadedAudio = useSoundscapeStore((s) => s.handleClearUploadedAudio);
  const onLibrarySearch = useSoundscapeStore((s) => s.handleLibrarySearch);
  const onLibrarySoundSelect = useSoundscapeStore((s) => s.handleLibrarySoundSelect);
  const onCatalogSoundSelect = useSoundscapeStore((s) => s.handleCatalogSoundSelect);
  const onRegenerateSingle = useSoundscapeStore((s) => s.handleRegenerateSingle);
  const onDeleteVariant = useSoundscapeStore((s) => s.handleDeleteVariant);
  const onUpdatePosition = useSoundscapeStore((s) => s.updateSoundPosition);
  const onDetachSoundFromEntity = useSoundscapeStore((s) => s.handleDetachSoundFromEntity);

  // Whether the matching sound card is mounted in the Sounds step. When it is,
  // that card owns the audible preview and this panel mirrors it silently so the
  // same sound never plays twice.
  const isInSoundsStep = useUIStore((s) => s.isInSoundsStep);
  const activeSoundParentIndex = useUIStore((s) => s.activeSoundParentIndex);

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
  if (selectedEntity?.objectType === 'Sound' && selectedEntity.soundData) {
    const cardIndex = toCardIndex(selectedEntity.soundData.promptIndex);
    const config = soundConfigs[cardIndex];
    const variants = generatedSounds.filter((s) => matchesCard(s, cardIndex));

    // The Sounds-step card handles audio whenever it is mounted for this card.
    const sectionWillPlay = isInSoundsStep
      && !!config
      && (activeSoundParentIndex === null
        || config.parentUsageOriginalIndex === activeSoundParentIndex);

    // ── Generated card — mirror the post-generation sound card ──
    if (variants.length > 0) {
      const selectedVariantIdx = selectedVariants?.[cardIndex] ?? 0;
      const generatedSound = variants[selectedVariantIdx] || variants[0];
      const isMuted = mutedSounds?.has(generatedSound.id) ?? false;
      const isRegenerating = regeneratingIndices.includes(cardIndex);

      const isTextToAudioType = !config?.type || config.type === 'text-to-audio';
      const isTtsType = config?.type === 'text-to-speech';
      const isSedExtractedCard =
        variants.length > 0 && variants.every((v) => String(v.id).startsWith('sed-'));
      const isUploadWithVariants = config?.type === 'upload' && variants.length > 1;
      const isSingleSedSegment = isSedExtractedCard && variants.length === 1;
      const showVariants =
        isTextToAudioType || isTtsType || isUploadWithVariants || isSingleSedSegment;
      const cardGenerating = isSoundGenerating
        && (soundGenTargetIndices === null || soundGenTargetIndices.includes(cardIndex));

      return (
        <div
          className="relative border rounded-xl card-generated border-border"
          style={{
            backgroundColor:
              'color-mix(in srgb, var(--color-primary) 72%, var(--color-surface))',
          }}
        >
          <div className="card-shell flex flex-col min-w-0" style={{ gap: 'var(--card-gap-header)' }}>
            <div className="card-stack max-h-[min(480px,55dvh)] overflow-y-auto relative z-[1]">
              <SoundResultContent
                generatedSound={generatedSound}
                index={cardIndex}
                variants={variants}
                selectedVariantIdx={selectedVariantIdx}
                isPreviewPlaying={previewingSoundId === generatedSound.id}
                isMuted={isMuted}
                silent={sectionWillPlay}
                soundVolumes={soundVolumes ?? {}}
                onPreviewPlayPause={onPreviewPlayPause}
                onPreviewStop={onPreviewStop}
                onVolumeChange={onVolumeChange}
                onMute={onMute}
                onUpdatePosition={onUpdatePosition}
                onUnlinkEntity={() => onDetachSoundFromEntity(cardIndex)}
                isRegenerating={isRegenerating}
                pendingVariantIdx={variants.length}
              />
              {showVariants && (
                <VariantsBar
                  items={variants.map((v, i) => ({ key: v.id, title: String.fromCharCode(65 + i) }))}
                  selectedIndex={selectedVariantIdx}
                  onSelect={(i) => onVariantChange(cardIndex, i)}
                  onDelete={(isTextToAudioType || isTtsType || isSedExtractedCard)
                    ? (i) => onDeleteVariant(cardIndex, i)
                    : undefined}
                  onAdd={(isTextToAudioType && !cardGenerating)
                    ? () => onRegenerateSingle(cardIndex)
                    : undefined}
                  isRegenerating={isRegenerating}
                  pendingIndex={variants.length}
                  onBlueBackground
                />
              )}
            </div>
          </div>
        </div>
      );
    }

    // ── Pending card — mirror the pre-generation sound card body ──
    if (config) {
      const preGenPreviewKey = `pregen:${cardIndex}`;
      // Pending TTS cards show their speech lines as the pre-gen variants bar.
      const ttsVariants = config.type === 'text-to-speech'
        ? createTtsSpeechLines(config, cardIndex, onUpdateConfig)
        : null;
      return (
        <div className="relative border rounded-xl bg-surface border-border">
          <div className="card-shell flex flex-col min-w-0" style={{ gap: 'var(--card-gap-header)' }}>
            <div className="card-stack max-h-[min(480px,55dvh)] overflow-y-auto relative z-[1]">
              <SoundPreContent
                config={config}
                index={cardIndex}
                isSoundGenerating={isSoundGenerating}
                isLinkingEntity={false}
                linkingConfigIndex={null}
                onUpdateConfig={onUpdateConfig}
                onUploadAudio={onUploadAudio}
                onClearUploadedAudio={onClearUploadedAudio}
                onLibrarySearch={onLibrarySearch}
                onLibrarySoundSelect={onLibrarySoundSelect}
                onCatalogSoundSelect={onCatalogSoundSelect}
                isPreviewPlaying={previewingSoundId === preGenPreviewKey}
                onPreviewPlayPause={() => onPreviewPlayPause(preGenPreviewKey)}
                onPreviewStop={() => onPreviewStop(preGenPreviewKey)}
                silent={sectionWillPlay}
              />
              {ttsVariants && (
                <VariantsBar
                  items={ttsVariants.speechLines.map((line, i) => ({ key: `line-${i}`, title: line }))}
                  selectedIndex={ttsVariants.selectedIndex}
                  onSelect={ttsVariants.onSelectLine}
                  onDelete={ttsVariants.onDeleteLine}
                  onAdd={ttsVariants.onAddLine}
                />
              )}
            </div>
          </div>
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
