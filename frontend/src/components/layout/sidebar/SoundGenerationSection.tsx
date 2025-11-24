import { useState, useRef, useEffect, useMemo } from "react";
import type { SoundGenerationSectionProps } from "@/types/components";
import { SoundTab } from "./SoundTab";
import { UI_COLORS, UI_BUTTON } from "@/lib/constants";

export function SoundGenerationSection({
  soundConfigs,
  activeSoundConfigTab,
  isSoundGenerating,
  soundGenError,
  onAddConfig,
  onBatchAddConfigs,
  onRemoveConfig,
  onUpdateConfig,
  onModeChange,
  onSetActiveTab,
  onGenerate,
  onStopGeneration,
  generatedSounds,
  onUploadAudio,
  onClearUploadedAudio,
  onLibrarySearch,
  onLibrarySoundSelect,
  modelEntities = [],
  onStartLinkingEntity,
  onCancelLinkingEntity,
  isLinkingEntity = false,
  linkingConfigIndex = null,
  individualSoundStates = {},
  onToggleSound,
  onVolumeChange,
  onIntervalChange,
  onMute,
  onSolo,
  onVariantChange,
  mutedSounds = new Set(),
  soloedSound = null,
  onResetSound,
  onSelectSoundCard,
  selectedCardIndex = null,
  soundVolumes = {},
  soundIntervals = {},
  selectedVariants = {},
  // Preview playback props
  previewingSoundId = null,
  onPreviewPlayPause,
  onPreviewStop
}: SoundGenerationSectionProps) {
  // Track which sound tabs are expanded
  const [expandedTabs, setExpandedTabs] = useState<Set<number>>(new Set([0]));
  
  // Refs for scrolling
  const soundListRef = useRef<HTMLDivElement>(null);
  const soundTabRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Helper to check if a sound is generated
  const isSoundGenerated = (index: number): boolean => {
    return generatedSounds.some(s => s.prompt_index === index);
  };

  // Helper to get generated sound for a config index (returns selected variant)
  const getGeneratedSound = (index: number) => {
    const variants = generatedSounds.filter(s => s.prompt_index === index);
    if (variants.length === 0) return undefined;
    const selectedIdx = selectedVariants[index] ?? 0;
    return variants[selectedIdx] || variants[0];
  };

  // Helper to get all variants for a prompt index
  const getVariantsForPrompt = (index: number) => {
    return generatedSounds.filter(s => s.prompt_index === index);
  };

  // Helper to get selected variant index for a prompt
  const getSelectedVariantIdx = (index: number): number => {
    return selectedVariants[index] ?? 0;
  };

  // Toggle expansion of a sound tab (only one can be expanded at a time)
  const handleToggleExpand = (index: number) => {
    // CRITICAL: Stop preview BEFORE setting state
    // Calling onPreviewStop inside the setState callback causes React error:
    // "Cannot update a component while rendering a different component"
    if (previewingSoundId) {
      onPreviewStop?.(previewingSoundId);
    }

    setExpandedTabs(prev => {
      const wasExpanded = prev.has(index);

      if (wasExpanded) {
        return new Set(); // Collapse if already expanded
      }

      // Expand this tab and scroll to it
      setTimeout(() => {
        const tabElement = soundTabRefs.current.get(index);
        tabElement?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 100);

      return new Set([index]); // Expand only this tab
    });
  };

  // Handle reset (convert generated sound back to generation UI)
  const handleReset = (index: number) => {

    const sound = getGeneratedSound(index);

    if (sound && onResetSound) {
      // Remove the generated sound but keep the config
      onResetSound(sound.id, index);
    } else {
      console.warn('[SoundGenerationSection.handleReset] NOT calling onResetSound. Reason:', !sound ? 'No sound found' : 'No onResetSound handler');
    }
  };

  // Calculate sound status - count actual generated sounds, not cards
  const soundStatus = useMemo(() => {
    const totalSounds = generatedSounds.length;
    const totalCards = soundConfigs.length;
    const pendingCount = totalCards - totalSounds;
    return { totalSounds, totalCards, pendingCount };
  }, [soundConfigs.length, generatedSounds.length]);

  // When adding a new sound, expand it and collapse others
  useEffect(() => {
    // Expand the last added sound card
    const lastIndex = soundConfigs.length - 1;
    if (lastIndex >= 0) {
      setExpandedTabs(new Set([lastIndex]));
    }
  }, [soundConfigs.length]);

  // When a card is selected externally (from ThreeScene), expand it
  useEffect(() => {
    if (selectedCardIndex !== null && selectedCardIndex >= 0 && selectedCardIndex < soundConfigs.length) {
      setExpandedTabs(new Set([selectedCardIndex]));
      
      // Scroll to the selected card
      setTimeout(() => {
        const tabElement = soundTabRefs.current.get(selectedCardIndex);
        tabElement?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    }
  }, [selectedCardIndex, soundConfigs.length]);

  return (
    <div className="flex flex-col gap-3">

      {/* Sound status */}
      <div className="flex items-center text-xs w-full gap-1" style={{ color: UI_COLORS.NEUTRAL_600 }}>
        {soundStatus.totalSounds} sound{soundStatus.totalSounds !== 1 ? 's' : ''}
        {soundStatus.pendingCount > 0 && (
          <span> ({soundStatus.pendingCount} pending)</span>
        )}

        {/* Add Sound button - small icon button */}
          <button
            onClick={onAddConfig}
            className="w-8 h-8 rounded text-white font-bold transition-colors flex items-center justify-center ml-auto"
            style={{
              backgroundColor: UI_COLORS.PRIMARY,
              borderRadius: '8px'
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = UI_COLORS.NEUTRAL_400}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = UI_COLORS.PRIMARY}
            title="Add sound"
            aria-label="Add sound"
          >
            <span className="text-lg leading-none">+</span>
          </button>

      </div>

      {/* Vertical list of sound tabs */}
      <div ref={soundListRef} className="flex flex-col gap-2">
        {soundConfigs.map((config, index) => {
          const generatedSound = getGeneratedSound(index);
          const variants = getVariantsForPrompt(index);
          const selectedVariantIdx = getSelectedVariantIdx(index);
          return (
          <div
            key={index}
            ref={(el) => {
              if (el) {
                soundTabRefs.current.set(index, el);
              } else {
                soundTabRefs.current.delete(index);
              }
            }}
          >
            <SoundTab
              config={config}
              index={index}
              isExpanded={expandedTabs.has(index)}
              isGenerated={isSoundGenerated(index)}
              generatedSound={generatedSound}
              soundState={generatedSound ? individualSoundStates[generatedSound.id] : undefined}
              isSoundGenerating={isSoundGenerating}
              modelEntities={modelEntities}
              isLinkingEntity={isLinkingEntity}
              linkingConfigIndex={linkingConfigIndex}
              isMuted={generatedSound ? mutedSounds.has(generatedSound.id) : false}
              isSoloed={generatedSound ? soloedSound === generatedSound.id : false}
              variants={variants}
              selectedVariantIdx={selectedVariantIdx}
              onToggleExpand={handleToggleExpand}
              onUpdateConfig={onUpdateConfig}
              onModeChange={onModeChange}
              onRemove={onRemoveConfig}
              onReset={handleReset}
              onStartLinkingEntity={onStartLinkingEntity}
              onCancelLinkingEntity={onCancelLinkingEntity}
              onUploadAudio={onUploadAudio}
              onClearUploadedAudio={onClearUploadedAudio}
              onLibrarySearch={onLibrarySearch}
              onLibrarySoundSelect={onLibrarySoundSelect}
              onToggleSound={onToggleSound}
              onVolumeChange={onVolumeChange}
              onIntervalChange={onIntervalChange}
              onMute={onMute}
              onSolo={onSolo}
              onVariantChange={onVariantChange}
              soundVolumes={soundVolumes}
              soundIntervals={soundIntervals}
              onSelectCard={() => {
                // Just notify parent about selection, don't toggle again
                // (onToggleExpand is already called in SoundTab title button)
                onSelectSoundCard?.(index);
              }}
              isPreviewPlaying={generatedSound ? previewingSoundId === generatedSound.id : false}
              onPreviewPlayPause={onPreviewPlayPause}
              onPreviewStop={onPreviewStop}
            />
          </div>
        )})}
      </div>


      {/* Generate all sounds button */}
      <div className="flex gap-2">
        <button
          onClick={onGenerate}
          disabled={isSoundGenerating}
          className="w-8 h-8 flex-1 text-white transition-colors"
          style={{
            borderRadius: UI_BUTTON.BORDER_RADIUS_MD,
            padding: UI_BUTTON.PADDING_MD,
            fontSize: UI_BUTTON.FONT_SIZE,
            fontWeight: UI_BUTTON.FONT_WEIGHT,
            backgroundColor: isSoundGenerating ? UI_COLORS.NEUTRAL_400 : UI_COLORS.PRIMARY,
            opacity: isSoundGenerating ? 0.4 : 1,
            cursor: isSoundGenerating ? 'not-allowed' : 'pointer'
          }}
          onMouseEnter={(e) => {
            if (!isSoundGenerating) {
              e.currentTarget.style.opacity = '0.8';
            }
          }}
          onMouseLeave={(e) => {
            if (!isSoundGenerating) {
              e.currentTarget.style.opacity = '1';
            }
          }}
        >
          {isSoundGenerating ? 'Generating Sounds...' : 'Generate Sounds'}
        </button>


        {/* Stop button - only visible when generating */}
        {isSoundGenerating && (
          <button
            onClick={onStopGeneration}
            className="w-8 h-8 rounded text-white font-bold transition-colors flex items-center justify-center"
            style={{
              backgroundColor: UI_COLORS.ERROR,
              borderRadius: '8px'
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#dc2626'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = UI_COLORS.ERROR}
            title="Stop generation"
            aria-label="Stop generation"
          >
            <span className="text-lg leading-none">■</span>
          </button>
        )}
      </div>

      {/* Error display */}
      {soundGenError && (
        <div
          className="p-3 text-sm rounded"
          style={{
            backgroundColor: UI_COLORS.ERROR_LIGHT,
            borderColor: UI_COLORS.ERROR,
            borderWidth: '1px',
            borderStyle: 'solid',
            borderRadius: '8px',
            color: UI_COLORS.ERROR
          }}
        >
          {soundGenError}
        </div>
      )}
    </div>
  );
}
