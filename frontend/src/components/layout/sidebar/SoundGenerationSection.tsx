'use client';

import { useMemo, useCallback, useEffect, useState, useRef } from "react";
import type { SoundGenerationSectionProps } from "@/types/components";
import type { SoundGenerationConfig, SoundEvent, CardType, CardBaseConfig } from "@/types";
import { CARD_TYPE_LABELS } from "@/types";
import type { CardTypeOption } from "@/components/ui/CardSection";
import { CardSection } from "@/components/ui/CardSection";
import { Card } from "@/components/ui/Card";
import { SoundConfigContent, SoundResultContent } from "./sound";
import { CardTypeSwitcher } from "./sound/CardTypeSwitcher";
import { apiService } from "@/services/api";

/**
 * SoundGenerationSection Component
 *
 * Manages multiple sound generation cards (text-to-audio, upload, library, sample-audio).
 * Each card can be configured and generates audio files.
 *
 * **Architecture:**
 * - Uses CardSection for expand/collapse and add button logic
 * - Uses Card component for each sound item
 * - Content components passed as beforeContent/afterContent props
 */

// ============================================================================
// Helpers
// ============================================================================

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'and', 'or',
  'is', 'are', 'was', 'were', 'be', 'been', 'by', 'from', 'that', 'this',
  'it', 'its', 'as', 'but', 'not', 'no', 'so', 'if', 'up', 'out',
]);

/** Extract 2-3 important words from a text string */
function shortenToKeyWords(text: string, maxWords = 3): string {
  // Remove file extension if present
  const withoutExt = text.replace(/\.[^.]+$/, '');
  // Split on whitespace, hyphens, underscores
  const words = withoutExt
    .split(/[\s_\-,]+/)
    .map(w => w.replace(/[^a-zA-Z0-9]/g, ''))
    .filter(w => w.length > 0);

  // Filter out stop words, keep important ones
  const important = words.filter(w => !STOP_WORDS.has(w.toLowerCase()));
  // Fall back to original words if all were stop words
  const selected = (important.length > 0 ? important : words).slice(0, maxWords);

  // Capitalize first letter of each word
  return selected
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/** Get the source name from a generated sound event or config fallback */
function getSoundSourceName(sound: SoundEvent | undefined, config: SoundGenerationConfig): string {
  // Prefer the resolved display_name from the SoundEvent (set by backend or event-factory)
  if (sound?.display_name) return sound.display_name;
  // Fallback: derive from config
  if (sound?.prompt) return sound.prompt;
  return config.prompt || config.uploadedAudioInfo?.filename || config.selectedLibrarySound?.description || '';
}

// Extend CardBaseConfig for sound configs
interface SoundCardConfig extends CardBaseConfig {
  type: CardType;
  originalConfig: SoundGenerationConfig;
}

export function SoundGenerationSection({
  soundConfigs,
  activeSoundConfigTab,
  isSoundGenerating,
  soundGenError,
  onAddConfig,
  onBatchAddConfigs,
  onRemoveConfig,
  onUpdateConfig,
  onTypeChange,
  onSetActiveTab,
  onGenerate,
  onStopGeneration,
  generatedSounds,
  onUploadAudio,
  onClearUploadedAudio,
  onLibrarySearch,
  onLibrarySoundSelect,
  onCatalogSoundSelect,
  modelEntities = [],
  onStartLinkingEntity,
  onCancelLinkingEntity,
  isLinkingEntity = false,
  linkingConfigIndex = null,
  useSpeckleViewer = false,
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
  previewingSoundId = null,
  onDuplicateConfig,
  onPreviewPlayPause,
  onPreviewStop,
}: SoundGenerationSectionProps) {
  // Track expanded index for controlled mode (CardSection)
  const [expandedIndex, setExpandedIndex] = useState<number | null>(
    soundConfigs.length > 0 ? 0 : null
  );

  // Helper to check if a sound is generated
  const isSoundGenerated = useCallback((index: number): boolean => {
    return generatedSounds.some(s => s.prompt_index === index);
  }, [generatedSounds]);

  // Helper to get generated sound for a config index (returns selected variant)
  const getGeneratedSound = useCallback((index: number): SoundEvent | undefined => {
    const variants = generatedSounds.filter(s => s.prompt_index === index);
    if (variants.length === 0) return undefined;
    const selectedIdx = selectedVariants[index] ?? 0;
    return variants[selectedIdx] || variants[0];
  }, [generatedSounds, selectedVariants]);

  // Helper to get all variants for a prompt index
  const getVariantsForPrompt = useCallback((index: number): SoundEvent[] => {
    return generatedSounds.filter(s => s.prompt_index === index);
  }, [generatedSounds]);

  // Helper to get selected variant index for a prompt
  const getSelectedVariantIdx = useCallback((index: number): number => {
    return selectedVariants[index] ?? 0;
  }, [selectedVariants]);

  // Handle reset (convert generated sound back to generation UI)
  const handleReset = useCallback((index: number) => {
    const sound = getGeneratedSound(index);
    if (sound && onResetSound) {
      onResetSound(sound.id, index);
    }
  }, [getGeneratedSound, onResetSound]);

  // Validate if a sound config has valid settings for generation
  const isConfigValid = useCallback((config: SoundGenerationConfig): boolean => {
    const cardType = config.type || 'text-to-audio';
    switch (cardType) {
      case 'text-to-audio':
        return config.prompt.trim().length > 0;
      case 'upload':
        return !!(config.uploadedAudioBuffer || config.uploadedAudioInfo);
      case 'library':
        return !!config.selectedLibrarySound;
      case 'catalog':
        return !!config.selectedCatalogSound;
      case 'sample-audio':
        return !!(config.uploadedAudioBuffer || config.uploadedAudioInfo);
      default:
        return config.prompt.trim().length > 0;
    }
  }, []);

  // Check if all pending configs have valid settings
  const allPendingConfigsValid = useMemo(() => {
    const pendingConfigs = soundConfigs.filter((_, index) => !isSoundGenerated(index));
    if (pendingConfigs.length === 0) return true;
    return pendingConfigs.every(isConfigValid);
  }, [soundConfigs, isSoundGenerated, isConfigValid]);

  // Determine if generate button should be disabled
  const shouldDisableGenerateButton = isSoundGenerating || soundConfigs.length === 0 || !allPendingConfigsValid;

  // Handle type selection from dropdown
  const handleTypeSelect = useCallback(async (type: CardType) => {
    onAddConfig(type);

    // If sample-audio type, auto-load the sample file
    if (type === 'sample-audio') {
      try {
        const newIndex = soundConfigs.length;
        const sampleFile = await apiService.loadSampleAudio();
        await onUploadAudio(newIndex, sampleFile);
      } catch (error) {
        console.error('[SoundGenerationSection] Failed to load sample audio:', error);
      }
    }
  }, [soundConfigs.length, onAddConfig, onUploadAudio]);

  // Handle card type switching - uses the hook's handleTypeChange for proper state management
  const handleSwitchCardType = useCallback(async (index: number, newType: CardType) => {
    const currentConfig = soundConfigs[index];
    if (!currentConfig || currentConfig.type === newType) return;

    // Use the hook's type change handler which properly manages state transitions
    if (onTypeChange) {
      await onTypeChange(index, newType);
    }
  }, [soundConfigs, onTypeChange]);

  // Auto-expand newly added items (controlled mode)
  const prevConfigsLength = useRef(soundConfigs.length);
  useEffect(() => {
    if (soundConfigs.length > prevConfigsLength.current) {
      // New item was added, expand it
      setExpandedIndex(soundConfigs.length - 1);
    }
    prevConfigsLength.current = soundConfigs.length;
  }, [soundConfigs.length]);

  // When a card is selected externally (from ThreeScene), expand it
  useEffect(() => {
    if (selectedCardIndex !== null && selectedCardIndex >= 0 && selectedCardIndex < soundConfigs.length) {
      setExpandedIndex(selectedCardIndex);
    }
  }, [selectedCardIndex, soundConfigs.length]);

  // Auto-name cards when sounds are generated (shorten source name to 2-3 key words)
  const autoNamedIndices = useRef<Set<number>>(new Set());
  useEffect(() => {
    soundConfigs.forEach((config, index) => {
      if (
        isSoundGenerated(index) &&
        !autoNamedIndices.current.has(index) &&
        !config.display_name // Only auto-name if user hasn't set a custom name
      ) {
        const generatedSound = getGeneratedSound(index);
        const sourceName = getSoundSourceName(generatedSound, config);
        if (sourceName) {
          const shortName = shortenToKeyWords(sourceName);
          if (shortName) {
            onUpdateConfig(index, 'display_name', shortName);
            autoNamedIndices.current.add(index);
          }
        }
      }
    });
  }, [soundConfigs, isSoundGenerated, getGeneratedSound, onUpdateConfig]);

  // Handle expansion change from CardSection (controlled mode callback)
  // Note: does NOT call onSelectSoundCard — that callback is only for scene-to-sidebar
  // communication (sound sphere / linked object click) and would trigger right sidebar expansion
  const handleExpandedIndexChange = useCallback((newIndex: number | null) => {
    // Stop preview when collapsing or switching cards
    if (previewingSoundId) {
      onPreviewStop?.(previewingSoundId);
    }
    setExpandedIndex(newIndex);
  }, [previewingSoundId, onPreviewStop]);

  // Available card types for add button dropdown (sound types only)
  const availableTypes: CardTypeOption[] = useMemo(() => [
    { type: 'text-to-audio', label: CARD_TYPE_LABELS['text-to-audio'], enabled: true },
    { type: 'upload', label: CARD_TYPE_LABELS['upload'], enabled: true },
    { type: 'library', label: CARD_TYPE_LABELS['library'], enabled: true },
    { type: 'catalog', label: CARD_TYPE_LABELS['catalog'], enabled: true },
    { type: 'sample-audio', label: CARD_TYPE_LABELS['sample-audio'], enabled: true },
  ], []);

  // Calculate pending count
  const getPendingCount = useCallback((items: SoundCardConfig[]) => {
    return items.filter((_, index) => !isSoundGenerated(index)).length;
  }, [isSoundGenerated]);

  // Get collapsed info for a config
  const getCollapsedInfo = useCallback((config: SoundGenerationConfig, index: number): string => {
    if (isSoundGenerated(index)) {
      const variants = getVariantsForPrompt(index);
      if (variants.length > 1) {
        return `(${variants.length} variants)`;
      }
      return '(generated)';
    }
    return '';
  }, [isSoundGenerated, getVariantsForPrompt]);

  // Convert SoundGenerationConfig to SoundCardConfig for CardSection
  const cardItems: SoundCardConfig[] = useMemo(() => {
    return soundConfigs.map((config) => ({
      type: config.type || 'text-to-audio',
      display_name: config.display_name,
      originalConfig: config,
    }));
  }, [soundConfigs]);

  // Handle config update (bridge between Card's partial update and original update signature)
  const handleUpdateConfig = useCallback((index: number, updates: Partial<SoundCardConfig>) => {
    if (updates.display_name !== undefined) {
      onUpdateConfig(index, 'display_name', updates.display_name);
    }
  }, [onUpdateConfig]);

  // Render card function
  const renderCard = useCallback((
    item: SoundCardConfig,
    index: number,
    isExpanded: boolean,
    onToggleExpandFn: (index: number) => void
  ) => {
    const config = item.originalConfig;
    const isGenerated = isSoundGenerated(index);
    const generatedSound = getGeneratedSound(index);
    const variants = getVariantsForPrompt(index);
    const selectedVariantIdx = getSelectedVariantIdx(index);
    const isMuted = generatedSound ? mutedSounds.has(generatedSound.id) : false;
    const isSoloed = generatedSound ? soloedSound === generatedSound.id : false;

    // Build custom buttons array
    const customButtons: React.ReactNode[] = [];

    // Card type switch button (only when not generated)
    if (!isGenerated) {
      customButtons.push(
        <CardTypeSwitcher
          key="switch"
          currentType={item.type}
          availableTypes={availableTypes}
          onSwitchType={(newType) => handleSwitchCardType(index, newType)}
        />
      );
    }

    // Link button (if entities available or Speckle viewer active)
    if (modelEntities.length > 0 || useSpeckleViewer) {
      const isCurrentlyLinking = isLinkingEntity && linkingConfigIndex === index;
      customButtons.push(
        <button
          key="link"
          onClick={(e) => {
            e.stopPropagation();
            if (isCurrentlyLinking) {
              onCancelLinkingEntity?.();
            } else {
              onStartLinkingEntity?.(index);
            }
          }}
          className={`w-5 h-5 flex items-center justify-center rounded-full transition-colors ${
            isCurrentlyLinking
              ? 'text-white'
              : config.entity
                ? 'text-success hover:bg-success-light'
                : 'text-secondary-hover hover:bg-secondary-light hover:text-foreground'
          }`}
          style={isCurrentlyLinking ? { backgroundColor: 'var(--card-color, var(--color-primary))' } : undefined}
          title={
            isCurrentlyLinking
              ? 'Cancel linking'
              : config.entity
                ? `Linked to entity ${config.entity.index}`
                : 'Link to entity'
          }
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
        </button>
      );
    }

    // Mute button (only if generated)
    if (isGenerated && onMute && generatedSound) {
      customButtons.push(
        <button
          key="mute"
          onClick={(e) => {
            e.stopPropagation();
            onMute(generatedSound.id);
          }}
          className={`w-5 h-5 flex items-center justify-center rounded-full transition-colors ${
            isMuted
              ? 'bg-warning-light text-warning'
              : 'text-secondary-hover hover:bg-secondary-light hover:text-foreground'
          }`}
          title={isMuted ? 'Unmute' : 'Mute'}
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            {isMuted ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" clipRule="evenodd" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
            )}
          </svg>
        </button>
      );
    }

    // Solo button (only if generated)
    if (isGenerated && onSolo && generatedSound) {
      customButtons.push(
        <button
          key="solo"
          onClick={(e) => {
            e.stopPropagation();
            onSolo(generatedSound.id);
          }}
          className={`w-5 h-5 flex items-center justify-center rounded-full transition-colors ${
            isSoloed
              ? ''
              : 'text-secondary-hover hover:bg-secondary-light hover:text-foreground'
          }`}
          style={isSoloed ? { backgroundColor: 'var(--card-color-light, var(--color-primary-light))', color: 'var(--card-color, var(--color-primary))' } : undefined}
          title={isSoloed ? 'Unsolo' : 'Solo'}
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill={isSoloed ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
          </svg>
        </button>
      );
    }

    // Duplicate button (only if generated)
    if (isGenerated && onDuplicateConfig) {
      customButtons.push(
        <button
          key="duplicate"
          onClick={(e) => {
            e.stopPropagation();
            onDuplicateConfig(index);
          }}
          className="w-5 h-5 flex items-center justify-center rounded-full transition-colors text-secondary-hover hover:bg-secondary-light hover:text-foreground"
          title="Duplicate sound"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        </button>
      );
    }

    return (
      <Card
        config={item}
        index={index}
        isExpanded={isExpanded}
        hasResult={isGenerated}
        result={generatedSound}
        isRunning={isSoundGenerating}
        defaultName={CARD_TYPE_LABELS[item.type]}
        collapsedInfo={getCollapsedInfo(config, index)}
        showIndex={true}
        canRemove={true}
        closeButtonTitle="Remove sound"
        resetButtonTitle="Reset to configuration UI"
        customButtons={customButtons.length > 0 ? customButtons : undefined}
        onToggleExpand={onToggleExpandFn}
        onUpdateConfig={handleUpdateConfig}
        onRemove={onRemoveConfig}
        onReset={handleReset}
        beforeContent={
          <SoundConfigContent
            config={config}
            index={index}
            isSoundGenerating={isSoundGenerating}
            isLinkingEntity={isLinkingEntity}
            linkingConfigIndex={linkingConfigIndex}
            onUpdateConfig={onUpdateConfig}
            onUploadAudio={onUploadAudio}
            onClearUploadedAudio={onClearUploadedAudio}
            onLibrarySearch={onLibrarySearch}
            onLibrarySoundSelect={onLibrarySoundSelect}
            onCatalogSoundSelect={onCatalogSoundSelect}
          />
        }
        afterContent={
          generatedSound ? (
            <SoundResultContent
              generatedSound={generatedSound}
              index={index}
              variants={variants}
              selectedVariantIdx={selectedVariantIdx}
              isPreviewPlaying={previewingSoundId === generatedSound.id}
              isMuted={isMuted}
              soundVolumes={soundVolumes}
              soundIntervals={soundIntervals}
              onPreviewPlayPause={onPreviewPlayPause}
              onPreviewStop={onPreviewStop}
              onVolumeChange={onVolumeChange}
              onIntervalChange={onIntervalChange}
              onVariantChange={onVariantChange}
            />
          ) : null
        }
      />
    );
  }, [
    isSoundGenerated,
    getGeneratedSound,
    getVariantsForPrompt,
    getSelectedVariantIdx,
    getCollapsedInfo,
    mutedSounds,
    soloedSound,
    modelEntities.length,
    useSpeckleViewer,
    isLinkingEntity,
    linkingConfigIndex,
    isSoundGenerating,
    soundVolumes,
    soundIntervals,
    previewingSoundId,
    availableTypes,
    handleUpdateConfig,
    onRemoveConfig,
    handleReset,
    handleSwitchCardType,
    onUpdateConfig,
    onUploadAudio,
    onClearUploadedAudio,
    onLibrarySearch,
    onLibrarySoundSelect,
    onCatalogSoundSelect,
    onStartLinkingEntity,
    onCancelLinkingEntity,
    onMute,
    onSolo,
    onDuplicateConfig,
    onPreviewPlayPause,
    onPreviewStop,
    onVolumeChange,
    onIntervalChange,
    onVariantChange,
  ]);

  // Footer with generate button
  const footer = (
    <div className="flex gap-2">
      <button
        onClick={onGenerate}
        disabled={shouldDisableGenerateButton}
        className={`flex-1 py-2 px-4 rounded-lg text-white text-xs font-medium transition-colors ${
          shouldDisableGenerateButton
            ? 'bg-secondary-hover opacity-40 cursor-not-allowed'
            : 'hover:opacity-80 cursor-pointer'
        }`}
        style={!shouldDisableGenerateButton ? { backgroundColor: 'var(--card-color, var(--color-primary))' } : undefined}
      >
        {isSoundGenerating ? 'Generating Sounds...' : 'Generate Sounds'}
      </button>

      {/* Stop button - only visible when generating */}
      {isSoundGenerating && (
        <button
          onClick={onStopGeneration}
          className="w-8 h-8 rounded-lg text-white font-bold bg-error hover:bg-error-hover transition-colors flex items-center justify-center"
          title="Stop generation"
          aria-label="Stop generation"
        >
          <span className="text-lg leading-none">&#9632;</span>
        </button>
      )}
    </div>
  );

    const header = (
    <div className="flex flex-col gap-2">
      <div className="text-xs font-medium text-primary">
        Sound cards
      </div>
    </div>
  );

  return (
    <CardSection
      items={cardItems}
      availableTypes={availableTypes}
      emptyMessage="No sounds yet. Click + to add a sound configuration."
      statusLabel="sound"
      addButtonTitle="Add sound"
      onAddItem={handleTypeSelect}
      renderCard={renderCard}
      footer={footer}
      header={header}
      getPendingCount={getPendingCount}
      isRunning={isSoundGenerating}
      error={soundGenError}
      expandedIndex={expandedIndex}
      onExpandedIndexChange={handleExpandedIndexChange}
    />
  );
}
