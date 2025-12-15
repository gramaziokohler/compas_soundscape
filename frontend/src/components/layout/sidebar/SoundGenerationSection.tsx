import { useState, useRef, useEffect, useMemo } from "react";
import type { SoundGenerationSectionProps } from "@/types/components";
import type { SoundGenerationMode, SoundGenerationConfig } from "@/types";
import { SoundTab } from "./SoundTab";
import { ReceiversSection } from "./ReceiversSection";
import { UI_COLORS, UI_BUTTON } from "@/lib/constants";
import { apiService } from "@/services/api";

export function SoundGenerationSection({
  soundConfigs,
  activeSoundConfigTab,
  isSoundGenerating,
  soundGenError,
  onAddConfig,
  onBatchAddConfigs,
  onRemoveConfig,
  onUpdateConfig,
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
  onPreviewStop,
  // Receiver props
  receivers = [],
  isPlacingReceiver = false,
  onStartPlacingReceiver,
  onDeleteReceiver,
  onUpdateReceiverName,
  onGoToReceiver
}: SoundGenerationSectionProps) {
  // Track which sound tabs are expanded
  const [expandedTabs, setExpandedTabs] = useState<Set<number>>(new Set());

  // Track mode selector dropdown visibility
  const [showModeSelector, setShowModeSelector] = useState(false);
  const modeSelectorRef = useRef<HTMLDivElement>(null);
  
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

  // Validate if a sound config has valid settings for generation
  const isConfigValid = (config: SoundGenerationConfig): boolean => {
    switch (config.mode) {
      case 'text-to-audio':
        return config.prompt.trim().length > 0;
      case 'upload':
        return !!(config.uploadedAudioBuffer || config.uploadedAudioInfo);
      case 'library':
        return !!config.selectedLibrarySound;
      case 'sample-audio':
        return !!(config.uploadedAudioBuffer || config.uploadedAudioInfo);
      default:
        // If no mode specified, treat as text-to-audio
        return config.prompt.trim().length > 0;
    }
  };

  // Check if all pending configs have valid settings
  const allPendingConfigsValid = useMemo(() => {
    // Get pending configs (those not yet generated)
    const pendingConfigs = soundConfigs.filter((_, index) => !isSoundGenerated(index));

    // If no pending configs, return true (nothing to validate)
    if (pendingConfigs.length === 0) return true;

    // Check if all pending configs are valid
    return pendingConfigs.every(isConfigValid);
  }, [soundConfigs, generatedSounds]);

  // Determine if generate button should be disabled
  const shouldDisableGenerateButton = isSoundGenerating || soundConfigs.length === 0 || !allPendingConfigsValid;

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

  // Close mode selector when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modeSelectorRef.current && !modeSelectorRef.current.contains(event.target as Node)) {
        setShowModeSelector(false);
      }
    };

    if (showModeSelector) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showModeSelector]);

  // Handle mode selection
  const handleModeSelect = async (mode: SoundGenerationMode) => {
    // Create the config first
    onAddConfig(mode);
    setShowModeSelector(false);

    // If sample-audio mode, auto-load the sample file
    if (mode === 'sample-audio') {
      try {
        // Get the index of the newly created config (will be last in array)
        const newIndex = soundConfigs.length;

        // Load sample audio from backend
        const sampleFile = await apiService.loadSampleAudio();

        // Upload it to the newly created config
        await onUploadAudio(newIndex, sampleFile);
      } catch (error) {
        console.error('[SoundGenerationSection] Failed to load sample audio:', error);
      }
    }
  };

  return (
    <div className="flex flex-col gap-3">

      {/* Sound status */}
      <div className="flex items-center text-xs w-full gap-1" style={{ color: UI_COLORS.NEUTRAL_600 }}>
        {soundStatus.totalSounds} sound{soundStatus.totalSounds !== 1 ? 's' : ''}
        {soundStatus.pendingCount > 0 && (
          <span> ({soundStatus.pendingCount} pending)</span>
        )}

        {/* Add Sound button with mode selector dropdown */}
        <div className="ml-auto relative" ref={modeSelectorRef}>
          <button
            onClick={() => setShowModeSelector(!showModeSelector)}
            className="w-8 h-8 rounded text-white font-bold transition-colors flex items-center justify-center"
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

          {/* Mode selector dropdown */}
          {showModeSelector && (
            <div
              className="absolute right-0 mt-1 z-10 rounded shadow-lg"
              style={{
                backgroundColor: 'white',
                borderRadius: '8px',
                borderWidth: '1px',
                borderStyle: 'solid',
                borderColor: UI_COLORS.NEUTRAL_300,
                minWidth: '200px'
              }}
            >
              <button
                onClick={() => handleModeSelect('text-to-audio')}
                className="w-full text-left px-3 py-2 text-xs transition-colors"
                style={{
                  borderRadius: '8px 8px 0 0',
                  color: UI_COLORS.NEUTRAL_900
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = UI_COLORS.PRIMARY;
                  e.currentTarget.style.color = 'white';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                  e.currentTarget.style.color = UI_COLORS.NEUTRAL_900;
                }}
              >
                Text-to-Audio Generation
              </button>
              <button
                onClick={() => handleModeSelect('upload')}
                className="w-full text-left px-3 py-2 text-xs transition-colors"
                style={{ color: UI_COLORS.NEUTRAL_900 }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = UI_COLORS.PRIMARY;
                  e.currentTarget.style.color = 'white';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                  e.currentTarget.style.color = UI_COLORS.NEUTRAL_900;
                }}
              >
                Upload File
              </button>
              <button
                onClick={() => handleModeSelect('library')}
                className="w-full text-left px-3 py-2 text-xs transition-colors"
                style={{ color: UI_COLORS.NEUTRAL_900 }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = UI_COLORS.PRIMARY;
                  e.currentTarget.style.color = 'white';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                  e.currentTarget.style.color = UI_COLORS.NEUTRAL_900;
                }}
              >
                Sound Library Search
              </button>
              <button
                onClick={() => handleModeSelect('sample-audio')}
                className="w-full text-left px-3 py-2 text-xs transition-colors"
                style={{
                  borderRadius: '0 0 8px 8px',
                  color: UI_COLORS.NEUTRAL_900
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = UI_COLORS.PRIMARY;
                  e.currentTarget.style.color = 'white';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                  e.currentTarget.style.color = UI_COLORS.NEUTRAL_900;
                }}
              >
                Sample Audio
              </button>
            </div>
          )}
        </div>

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
          disabled={shouldDisableGenerateButton}
          className="w-8 h-8 flex-1 text-white transition-colors"
          style={{
            borderRadius: UI_BUTTON.BORDER_RADIUS_MD,
            padding: UI_BUTTON.PADDING_MD,
            fontSize: UI_BUTTON.FONT_SIZE,
            fontWeight: UI_BUTTON.FONT_WEIGHT,
            backgroundColor: shouldDisableGenerateButton ? UI_COLORS.NEUTRAL_400 : UI_COLORS.PRIMARY,
            opacity: shouldDisableGenerateButton ? 0.4 : 1,
            cursor: shouldDisableGenerateButton ? 'not-allowed' : 'pointer'
          }}
          onMouseEnter={(e) => {
            if (!shouldDisableGenerateButton) {
              e.currentTarget.style.opacity = '0.8';
            }
          }}
          onMouseLeave={(e) => {
            if (!shouldDisableGenerateButton) {
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
