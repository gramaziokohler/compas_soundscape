'use client';

import { useMemo, useCallback, useEffect, useState, useRef } from "react";
import type { SoundGenerationSectionProps } from "@/types/components";
import type { SoundGenerationConfig, SoundEvent, CardType, CardBaseConfig } from "@/types";
import { CARD_TYPE_LABELS } from "@/types";
import type { CardTypeOption } from "@/components/ui/CardSection";
import type { CustomMenuItem } from "@/types/card";
import { CardSection } from "@/components/ui/CardSection";
import { Card } from "@/components/ui/Card";import { CircularFAB } from '@/components/ui/CircularFAB';import { SoundPreContent, SoundResultContent } from "./sound";
import { apiService } from "@/services/api";
import { useAudioControlsStore, useErrorsStore, useSoundscapeStore } from "@/store";
import { useSpeckleEngineStore } from "@/store/speckleEngineStore";
import { useUIStore } from "@/store/uiStore";
import { useServiceVersions } from "@/hooks/useServiceVersions";
import {
  AUDIO_MODEL_TANGOFLUX,
  AUDIO_MODEL_AUDIOLDM2,
  AUDIO_MODEL_ELEVENLABS,
  ELEVENLABS_SERVICE_VERSION,
  GOOGLE_SOUND_LIBRARY_SERVICE_VERSION,
} from "@/utils/constants";

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
  /** Original index of this config in the full soundConfigs array (used for correct store access when filtering) */
  originalIndex: number;
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
  onGenerateSingle,
  onGenerateFiltered,
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
  onFinishLinkingEntity,
  onSelectLinkedEntity,
  onClearLinkedEntities,
  isLinkingEntity = false,
  linkingConfigIndex = null,
  useSpeckleViewer = false,
  onResetSound,
  onSelectSoundCard,
  selectedCardIndex = null,
  onDuplicateConfig,
  audioModel = AUDIO_MODEL_TANGOFLUX,
  visibleParentUsageIndex,
}: SoundGenerationSectionProps) {
  const serviceVersions = useServiceVersions();

  // ── UI store for sidebar→scene communication ──
  const setExpandedSoundCardIndex = useUIStore(s => s.setExpandedSoundCardIndex);
  const triggerZoomToSoundCard    = useUIStore(s => s.triggerZoomToSoundCard);

  // Clear entity highlight in 3D scene when Sounds section unmounts (user navigates away)
  useEffect(() => {
    return () => {
      setExpandedSoundCardIndex(null);
    };
  }, [setExpandedSoundCardIndex]);

  // ── Sound generation progress from store ──
  const soundGenProgress          = useSoundscapeStore((s) => s.soundGenProgress);
  const soundGenProgressValue     = useSoundscapeStore((s) => s.soundGenProgressValue);
  const soundGenTargetIndices     = useSoundscapeStore((s) => s.soundGenTargetIndices);
  const handleReorderSoundConfigs   = useSoundscapeStore((s) => s.handleReorderSoundConfigs);
  const duplicateConfigAt           = useSoundscapeStore((s) => s.duplicateConfigAt);
  const updateSoundPosition         = useSoundscapeStore((s) => s.updateSoundPosition);
  const handleDetachSoundFromEntity = useSoundscapeStore((s) => s.handleDetachSoundFromEntity);

  // Helper to check if a sound is generated (defined early for use in other callbacks)
  const isSoundGenerated = useCallback((index: number): boolean => {
    return generatedSounds.some(s => s.prompt_index === index);
  }, [generatedSounds]);

  // Snapshot the total number of pending configs (all types) when generation starts.
  // The backend only counts ML sounds in its denominator, so we replace it here.
  const pendingAtStartRef = useRef(0);
  // Snapshot of pending config object references in generation order (survives reordering)
  const pendingConfigOrderRef = useRef<SoundGenerationConfig[]>([]);

  useEffect(() => {
    if (isSoundGenerating) {
      // For single-card generation, only include the targeted card in the pending snapshot.
      // For global generation (soundGenTargetIndex === null), include all pending configs.
      const pendingConfigs = soundConfigs.filter((_, i) =>
        !isSoundGenerated(i) && (soundGenTargetIndices === null || soundGenTargetIndices.includes(i))
      );
      pendingAtStartRef.current = pendingConfigs.length;
      pendingConfigOrderRef.current = pendingConfigs;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSoundGenerating]); // intentionally snapshot once when generation starts

  // Find the current generating card index by matching config object references.
  // This is stable even if the user reorders cards, since the reference stays the same.
  const getCurrentGeneratingCardIndex = useCallback((): number | null => {
    if (!isSoundGenerating || pendingConfigOrderRef.current.length === 0) return null;
    const generatedIndices = new Set(generatedSounds.map(s => s.prompt_index));
    // Walk the original generation order; find the first not yet generated
    for (const pendingConfig of pendingConfigOrderRef.current) {
      // Find where this config object lives in the current soundConfigs array
      const currentIdx = soundConfigs.indexOf(pendingConfig);
      if (currentIdx === -1) continue; // config was removed
      if (!generatedIndices.has(currentIdx)) {
        return currentIdx;
      }
    }
    return null;
  }, [isSoundGenerating, soundConfigs, generatedSounds]);

  const currentGeneratingCardIndex = getCurrentGeneratingCardIndex();

  const displayProgress = (isSoundGenerating && soundGenProgress && pendingAtStartRef.current > 0)
    ? soundGenProgress.replace(/\/\d+/, `/${pendingAtStartRef.current}`)
    : (soundGenProgress || 'Generating Sounds...');

  // ── Audio controls from store ──
  const individualSoundStates = useAudioControlsStore((s) => s.individualSoundStates);
  const onToggleSound        = useAudioControlsStore((s) => s.toggleSound);
  const onVolumeChange       = useAudioControlsStore((s) => s.handleVolumeChange);
  const onIntervalChange     = useAudioControlsStore((s) => s.handleIntervalChange);
  const onMute               = useAudioControlsStore((s) => s.handleMute);
  const onSolo               = useAudioControlsStore((s) => s.handleSolo);
  const onVariantChange      = useAudioControlsStore((s) => s.handleVariantChange);
  const mutedSounds          = useAudioControlsStore((s) => s.mutedSounds);
  const soloedSound          = useAudioControlsStore((s) => s.soloedSound);
  const soundVolumes         = useAudioControlsStore((s) => s.soundVolumes);
  const soundIntervals       = useAudioControlsStore((s) => s.soundIntervals);
  const selectedVariants     = useAudioControlsStore((s) => s.selectedVariants);
  const previewingSoundId    = useAudioControlsStore((s) => s.previewingSoundId);
  const onPreviewPlayPause   = useAudioControlsStore((s) => s.handlePreviewPlayPause);
  const onPreviewStop        = useAudioControlsStore((s) => s.handlePreviewStop);
  const soundSchedulingModes = useAudioControlsStore((s) => s.soundSchedulingModes);
  const soundTimestamps      = useAudioControlsStore((s) => s.soundTimestamps);
  const onSchedulingModeChange = useAudioControlsStore((s) => s.handleSchedulingModeChange);
  const onTimestampsChange   = useAudioControlsStore((s) => s.handleTimestampsChange);
  const iterationLinks       = useAudioControlsStore((s) => s.iterationLinks);

  // Track active linked entity index per card via state (for reactive selector highlighting)
  const [activeLinkedEntityIdx, setActiveLinkedEntityIdx] = useState<Record<number, number>>({});

  // Track expanded index for controlled mode (CardSection)
  const [expandedIndex, setExpandedIndex] = useState<number | null>(
    soundConfigs.length > 0 ? 0 : null
  );

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
      case 'text-to-speech':
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

  // Handle type selection from dropdown
  const handleTypeSelect = useCallback(async (type: CardType) => {
    const newOriginalIndex = soundConfigs.length; // new config will be appended at this index
    onAddConfig(type);

    // Tag new sound with parent usage index if we have a filter active
    if (visibleParentUsageIndex !== null && visibleParentUsageIndex !== undefined) {
      onUpdateConfig(newOriginalIndex, 'parentUsageOriginalIndex', visibleParentUsageIndex);
    }

    // If sample-audio type, auto-load the sample file
    if (type === 'sample-audio') {
      try {
        const sampleFile = await apiService.loadSampleAudio();
        await onUploadAudio(newOriginalIndex, sampleFile);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load sample audio';
        useErrorsStore.getState().addError(message, 'error');
        console.error('[SoundGenerationSection] Failed to load sample audio:', error);
      }
    }
  }, [soundConfigs.length, onAddConfig, onUploadAudio, visibleParentUsageIndex, onUpdateConfig]);

  // Handle card type switching - uses the hook's handleTypeChange for proper state management
  const handleSwitchCardType = useCallback(async (index: number, newType: CardType) => {
    const currentConfig = soundConfigs[index];
    if (!currentConfig || currentConfig.type === newType) return;

    // Use the hook's type change handler which properly manages state transitions
    if (onTypeChange) {
      await onTypeChange(index, newType);
    }
  }, [soundConfigs, onTypeChange]);

  // Convert SoundGenerationConfig to SoundCardConfig for CardSection
  const cardItems: SoundCardConfig[] = useMemo(() => {
    return soundConfigs.map((config, i) => ({
      type: config.type || 'text-to-audio',
      display_name: config.display_name,
      originalConfig: config,
      originalIndex: i,
    }));
  }, [soundConfigs]);

  // Filter by active parent usage index when set
  const filteredCardItems: SoundCardConfig[] = useMemo(() => {
    if (visibleParentUsageIndex === null || visibleParentUsageIndex === undefined) return cardItems;
    return cardItems.filter(
      (item) => item.originalConfig.parentUsageOriginalIndex === visibleParentUsageIndex,
    );
  }, [cardItems, visibleParentUsageIndex]);

  // Check if all visible pending configs have valid settings
  const allPendingConfigsValid = useMemo(() => {
    const pendingConfigs = filteredCardItems
      .filter((item) => !isSoundGenerated(item.originalIndex))
      .map((item) => item.originalConfig);
    if (pendingConfigs.length === 0) return true;
    return pendingConfigs.every(isConfigValid);
  }, [filteredCardItems, isSoundGenerated, isConfigValid]);

  // Determine if generate button should be disabled
  const shouldDisableGenerateButton = isSoundGenerating || filteredCardItems.length === 0 || !allPendingConfigsValid;

  // Auto-expand newly added items (controlled mode) — track filteredCardItems length
  // Note: initialized as null so first render is treated as "baseline" (no auto-expand on mount)
  const prevConfigsLength = useRef<number | null>(null);
  useEffect(() => {
    if (prevConfigsLength.current === null) {
      // First render — record baseline, do not auto-expand existing items
      prevConfigsLength.current = filteredCardItems.length;
      return;
    }
    if (filteredCardItems.length > prevConfigsLength.current) {
      // New item was added that is visible in the current filter, expand it
      setExpandedIndex(filteredCardItems.length - 1);
    }
    prevConfigsLength.current = filteredCardItems.length;
  }, [filteredCardItems.length]);

  // Keep a ref to soundConfigs.length so the selection effect below can bounds-check
  // without listing soundConfigs.length as a dependency (which would cause the effect
  // to re-fire when a new card is added and override Effect A's auto-expand).
  const soundConfigsLengthRef = useRef(soundConfigs.length);
  soundConfigsLengthRef.current = soundConfigs.length;

  // Stable ref to the latest filteredCardItems — avoids re-running the selection
  // effect on every config update (e.g. slider moves that change the soundConfigs
  // reference and therefore regenerate cardItems / filteredCardItems).
  const filteredCardItemsRef = useRef(filteredCardItems);
  filteredCardItemsRef.current = filteredCardItems;

  // When a card is selected externally (from ThreeScene / sphere click), expand it.
  // Map original index → filtered position first.
  // Intentionally only depends on selectedCardIndex; filteredCardItems is accessed
  // via ref so that slider-driven config updates don't re-trigger this effect and
  // override the user's manually expanded card.
  useEffect(() => {
    if (selectedCardIndex !== null && selectedCardIndex >= 0) {
      const filteredIdx = filteredCardItemsRef.current.findIndex(item => item.originalIndex === selectedCardIndex);
      if (filteredIdx >= 0) setExpandedIndex(filteredIdx);
    }
  }, [selectedCardIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-name cards when sounds are generated
  const autoNamedIndices = useRef<Set<number>>(new Set());
  useEffect(() => {
    soundConfigs.forEach((config, index) => {
      if (
        isSoundGenerated(index) &&
        !autoNamedIndices.current.has(index)
        // !config.display_name // Only auto-name if user hasn't set a custom name
      ) {
        const generatedSound = getGeneratedSound(index);
        const sourceName = getSoundSourceName(generatedSound, config);
        if (sourceName) {
            onUpdateConfig(index, 'display_name', sourceName);
            autoNamedIndices.current.add(index);

        }
      }
    });
  }, [soundConfigs, isSoundGenerated, getGeneratedSound, onUpdateConfig]);

  const handleUpdateSoundPosition = useCallback((soundId: string, position: [number, number, number]) => {
    updateSoundPosition(soundId, position);
  }, [updateSoundPosition]);

  // Handle expansion change from CardSection (controlled mode callback)
  // Note: does NOT call onSelectSoundCard — that callback is only for scene-to-sidebar
  // communication (sound sphere / linked object click) and would trigger right sidebar expansion.
  // Instead, we write directly to uiStore so SpeckleScene can highlight the sphere.
  const handleExpandedIndexChange = useCallback((newFilteredIndex: number | null) => {
    if (previewingSoundId) {
      onPreviewStop?.(previewingSoundId);
    }
    setExpandedIndex(newFilteredIndex);
    // Map filtered position → original index for 3D scene sync
    const originalIdx = newFilteredIndex !== null
      ? (filteredCardItems[newFilteredIndex]?.originalIndex ?? null)
      : null;
    setExpandedSoundCardIndex(originalIdx);
  }, [previewingSoundId, onPreviewStop, setExpandedSoundCardIndex, filteredCardItems]);

  // Available card types for add button dropdown (sound types only)
  const availableTypes: CardTypeOption[] = useMemo(() => [
    { type: 'text-to-audio', label: CARD_TYPE_LABELS['text-to-audio'], enabled: true },
    { type: 'text-to-speech', label: CARD_TYPE_LABELS['text-to-speech'], enabled: true },
    { type: 'upload', label: CARD_TYPE_LABELS['upload'], enabled: true },
    { type: 'library', label: CARD_TYPE_LABELS['library'], enabled: true },
    { type: 'catalog', label: CARD_TYPE_LABELS['catalog'], enabled: true },
    { type: 'sample-audio', label: CARD_TYPE_LABELS['sample-audio'], enabled: true },
  ], []);

  // Calculate pending count
  const getPendingCount = useCallback((items: SoundCardConfig[]) => {
    return items.filter((item) => !isSoundGenerated(item.originalIndex)).length;
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
    if (isSoundGenerating && pendingConfigOrderRef.current.length > 0) {
      const orderIdx = pendingConfigOrderRef.current.indexOf(config);
      const currentConfig = pendingConfigOrderRef.current.find(c => {
        const idx = soundConfigs.indexOf(c);
        return idx !== -1 && !isSoundGenerated(idx);
      });
      const currentOrderIdx = currentConfig ? pendingConfigOrderRef.current.indexOf(currentConfig) : -1;
      if (orderIdx >= 0 && currentOrderIdx >= 0) {
        if (orderIdx > currentOrderIdx) return `(queued #${orderIdx - currentOrderIdx})`;
      }
    }
    return '';
  }, [isSoundGenerated, getVariantsForPrompt, isSoundGenerating, soundConfigs]);

  // Handle config update (bridge between Card's partial update and original update signature)
  // Note: `originalIndex` is passed explicitly; the `index` arg from Card is ignored.
  const handleUpdateConfig = useCallback((originalIndex: number, updates: Partial<SoundCardConfig>) => {
    if (updates.display_name !== undefined) {
      onUpdateConfig(originalIndex, 'display_name', updates.display_name);
    }
  }, [onUpdateConfig]);

  // Render card function
  const renderCard = useCallback((
    item: SoundCardConfig,
    index: number,
    isExpanded: boolean,
    onToggleExpandFn: (index: number) => void
  ) => {
    // originalIndex = position in the full soundConfigs array (used for all store ops)
    // index        = position in filteredCardItems (used for expand/collapse display)
    const originalIndex = item.originalIndex;
    const config = item.originalConfig;
    const isGenerated = isSoundGenerated(originalIndex);
    const generatedSound = getGeneratedSound(originalIndex);
    const variants = getVariantsForPrompt(originalIndex);
    const selectedVariantIdx = getSelectedVariantIdx(originalIndex);
    const isMuted = generatedSound ? mutedSounds.has(generatedSound.id) : false;
    const isSoloed = generatedSound ? soloedSound === generatedSound.id : false;
    // When any sound is soloed, dim all other generated cards the same way as muted
    const isEffectivelyMuted = isMuted || (!!soloedSound && isGenerated && !isSoloed);

    // Build custom menu items
    const customButtons: CustomMenuItem[] = [];

    // Mute button (only if generated)
    if (isGenerated && onMute && generatedSound) {
      customButtons.push({
        key: 'mute',
        icon: (
          <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            {isMuted ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" clipRule="evenodd" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
            )}
          </svg>
        ),
        label: isMuted ? 'Unmute' : 'Mute',
        isActive: isMuted,
        onClick: (e) => { e.stopPropagation(); onMute(generatedSound.id); },
      });
    }

    // Solo button (only if generated)
    if (isGenerated && onSolo && generatedSound) {
      customButtons.push({
        key: 'solo',
        icon: (
          <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill={isSoloed ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
          </svg>
        ),
        label: isSoloed ? 'Unsolo' : 'Solo',
        isActive: isSoloed,
        onClick: (e) => { e.stopPropagation(); onSolo(generatedSound.id); },
      });
    }

    // Scheduling mode toggle removed from kebab — use the lock icon in the DAW timeline instead.

    // Duplicate button (only if generated)
    if (isGenerated && onDuplicateConfig) {
      customButtons.push({
        key: 'duplicate',
        icon: (
          <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        ),
        label: 'Duplicate sound',
        onClick: (e) => { e.stopPropagation(); onDuplicateConfig(originalIndex); },
      });
    }

    // Derive version string for this card's service
    const cardVersion = (() => {
      if (!serviceVersions) return undefined;
      const cardType = item.type;
      if (cardType === 'text-to-audio') {
        if (audioModel === AUDIO_MODEL_ELEVENLABS) return ELEVENLABS_SERVICE_VERSION;
        if (audioModel === AUDIO_MODEL_AUDIOLDM2) {
          const v = serviceVersions.audioldm2;
          return v.version && v.version !== 'unknown' ? `${v.name} ${v.version}` : v.name;
        }
        const v = serviceVersions.tangoflux;
        return v.version && v.version !== 'unknown' ? `${v.name} ${v.version}` : v.name;
      }
      if (cardType === 'text-to-speech') {
        const v = serviceVersions['gemini-tts'];
        return v && v.version && v.version !== 'unknown' ? `${v.name} ${v.version}` : v?.name;
      }
      if (cardType === 'library') {
        const v = serviceVersions.bbc;
        return `${v.name} ${v.version}`;
      }
      if (cardType === 'catalog') return GOOGLE_SOUND_LIBRARY_SERVICE_VERSION;
      return undefined;
    })();

    // Link button rendered in the card header prefix (pre-gen and post-gen)
    const isCurrentlyLinking = isLinkingEntity && linkingConfigIndex === originalIndex;
    const showLinkButton = modelEntities.length > 0 || useSpeckleViewer
      || !!config.entities?.length
      || (isGenerated && generatedSound?.entity_index !== undefined);

    const linkedEntityLabel = isGenerated
      ? (generatedSound?.entity_index !== undefined
          ? `Entity ${generatedSound.entity_index}`
          : undefined)
      : (config.entities?.length
          ? config.entities.map((e: any) => e.name || (e.index !== undefined
              ? `Entity ${e.index}`
              : (e.id as string)?.slice(0, 8) || 'Object')).join(', ')
          : undefined);
    const isLinkedInHeader = isGenerated
      ? generatedSound?.entity_index !== undefined
      : !!config.entities?.length;

    // Determine active entity index in config.entities array (for selector highlighting)
    const activeEntityArrayIdx = (() => {
      if (!config.entities?.length) return 0;
      // Local state takes priority (most recent user click)
      if (activeLinkedEntityIdx[originalIndex] !== undefined) {
        return activeLinkedEntityIdx[originalIndex];
      }
      // Fall back to store (generated sound entity_index)
      if (isGenerated && generatedSound?.entity_index !== undefined) {
        const idx = config.entities.findIndex((e: any) => e.index === generatedSound.entity_index);
        return idx >= 0 ? idx : 0;
      }
      return 0;
    })();

    const hasMultipleEntities = config.entities && config.entities.length > 1;
    const hasEntities = config.entities && config.entities.length > 0;

    // Check if timeline iteration links manage DIFFERENT entity assignments
    const timelineEntityId = isGenerated && generatedSound ? (
      (() => {
        const linkedEntityIds = new Set<string>();
        for (const [k, v] of Object.entries(iterationLinks)) {
          if (k.startsWith(`${generatedSound.id}-`) && v.entityNodeId) {
            linkedEntityIds.add(v.entityNodeId);
          }
        }
        if (linkedEntityIds.size === 0) return null;
        if (linkedEntityIds.size === 1) return [...linkedEntityIds][0];
        return '__multiple__';
      })()
    ) : null;
    const isTimelineManaged = timelineEntityId === '__multiple__';

    // When all iteration links point to the same entity, find its array index
    const timelineCommonEntityIdx = (timelineEntityId && timelineEntityId !== '__multiple__' && config.entities)
      ? config.entities.findIndex((e: any) => (e.nodeId || e.id) === timelineEntityId)
      : -1;

    // Effective active index: timeline common entity takes priority
    const effectiveActiveIdx = timelineCommonEntityIdx >= 0
      ? timelineCommonEntityIdx
      : activeEntityArrayIdx;

    // Linked entities display (shown inside card body when entities are linked)
    const linkedEntitiesDisplay = hasEntities ? (
      <div className="flex items-center gap-2 mt-2">
        <span className="text-[10px] text-secondary whitespace-nowrap">
          Linked entities:
        </span>
          {hasMultipleEntities ? (
          <div
            className="flex gap-1 overflow-x-auto flex-shrink-0"
            style={{
              scrollbarWidth: 'thin',
              scrollbarColor: timelineEntityId !== null ? 'var(--color-secondary-light) transparent' : 'var(--color-primary) transparent',
              opacity: isTimelineManaged ? 0.4 : 1,
            }}
            title={isTimelineManaged ? 'Managed by timeline' : undefined}
          >
            {config.entities!.map((entity: any, idx: number) => (
              <button
                key={idx}
                onClick={(e) => {
                  if (timelineEntityId !== null) return;
                  e.stopPropagation();
                  setActiveLinkedEntityIdx(prev => ({ ...prev, [originalIndex]: idx }));
                  onSelectLinkedEntity?.(originalIndex, idx);
                }}
                className={`w-5 h-5 text-[10px] rounded transition-colors flex-shrink-0 ${
                  timelineEntityId !== null ? 'cursor-not-allowed' : ''
                } ${idx === effectiveActiveIdx && timelineEntityId === null ? 'text-white' : ''}`}
                style={isTimelineManaged
                  ? { backgroundColor: 'var(--color-secondary-light)', color: 'var(--color-secondary-hover)', cursor: 'not-allowed' }
                  : idx === effectiveActiveIdx
                    ? { backgroundColor: 'var(--color-primary)', cursor: timelineEntityId !== null ? 'not-allowed' : undefined }
                    : { backgroundColor: 'var(--color-secondary)', color: 'var(--color-secondary-light)', cursor: timelineEntityId !== null ? 'not-allowed' : undefined }}
                title={
                  isTimelineManaged
                    ? 'Managed by timeline — different entities per iteration'
                    : timelineEntityId !== null
                      ? 'Assigned via timeline — select a different entity from the DAW'
                      : (entity.name || `Entity ${entity.index !== undefined ? entity.index : idx + 1}`)
                }
              >
                {idx + 1}
              </button>
            ))}
          </div>
        ) : (
          <span className="text-[10px] text-secondary-hover truncate"
            style={{ opacity: isTimelineManaged ? 0.4 : 1 }}
            title={isTimelineManaged ? 'Managed by timeline — different entities per iteration' : linkedEntityLabel}
          >
            {linkedEntityLabel}
          </span>
        )}
        {onClearLinkedEntities && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClearLinkedEntities(originalIndex);
            }}
            className="text-[10px] text-warning hover:text-error cursor-pointer whitespace-nowrap ml-auto"
            title="Remove all linked entities"
          >
            Clear
          </button>
        )}
      </div>
    ) : null;

    const linkHeaderPrefix = showLinkButton ? (
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (isCurrentlyLinking) {
            onFinishLinkingEntity?.();
          } else if (isLinkedInHeader) {
            onStartLinkingEntity?.(originalIndex);
          } else {
            onStartLinkingEntity?.(originalIndex);
          }
        }}
        title={
          isCurrentlyLinking
            ? 'Multi-select active — click entities in the 3D view (click here to finish)'
            : linkedEntityLabel
              ? `Linked to: ${linkedEntityLabel} — click to edit links`
              : 'Link to entities'
        }
        className={`flex-shrink-0 w-5 h-5 flex items-center justify-center rounded-full transition-all opacity-80 hover:bg-secondary hover:text-primary ${
          isCurrentlyLinking ? 'animate-pulse' : ''
        }`}
        style={{ color: (isCurrentlyLinking || isLinkedInHeader) ? 'var(--color-primary-hover)' : undefined , backgroundColor: (isCurrentlyLinking || isLinkedInHeader) ? 'var(--color-foreground)' : undefined}}
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
        </svg>
      </button>
    ) : undefined;

    // Linking mode tip bar (reused in both before/after content)
    const linkingTipBar = isCurrentlyLinking ? (
      <div
        className="text-xs p-2 rounded-md flex items-start justify-between gap-2 mb-2"
        style={{ backgroundColor: 'color-mix(in srgb, var(--color-warning) 40%, transparent)', color: 'var(--color-secondary)' }}
      >
        <span>
          Select one or multiple objects in the 3D view to link them.
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); onFinishLinkingEntity?.(); }}
          className="shrink-0 px-2 py-0.5 rounded text-xs font-medium cursor-pointer"
          style={{
            backgroundColor: 'var(--color-secondary)',
            color: 'var(--color-primary)',
          }}
        >
          Done
        </button>
      </div>
    ) : null;

    // Category badge (if available from foley analysis)
    const categoryBadge = config.category ? (
      <span
        style={{
          fontSize: '9px',
          padding: '1px 5px',
          borderRadius: '3px',
          backgroundColor: 'var(--color-secondary-light)',
          color: 'var(--color-secondary-hover)',
          textTransform: 'capitalize',
          letterSpacing: '0.02em',
          flexShrink: 0,
          whiteSpace: 'nowrap',
        }}
      >
        {config.category.replace(/_/g, ' ')}
      </span>
    ) : null;

    const headerPrefix = linkHeaderPrefix ? (
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        {linkHeaderPrefix}
      </div>
    ) : undefined;

    return (
      <div key={originalIndex} style={{ position: 'relative' }}>
      <Card
        config={item}
        index={index}
        isExpanded={isExpanded}
        hasResult={isGenerated}
        result={generatedSound}
        isRunning={isSoundGenerating && originalIndex === currentGeneratingCardIndex}
        progress={originalIndex === currentGeneratingCardIndex ? soundGenProgressValue : 0}
        status={
          originalIndex === currentGeneratingCardIndex
            ? 'Generating...'
            : !isGenerated && isSoundGenerating && (soundGenTargetIndices === null || soundGenTargetIndices.includes(originalIndex))
              ? 'Queued'
              : undefined
        }
        defaultName={undefined}
        collapsedInfo={getCollapsedInfo(config, originalIndex)}
        showIndex={true}
        canRemove={true}
        closeButtonTitle="Remove sound"
        resetButtonTitle="Reset to configuration UI"
        customButtons={customButtons.length > 0 ? customButtons : undefined}
        error={config.error || null}
        onDismissError={() => onUpdateConfig(originalIndex, 'error', '')}
        onToggleExpand={onToggleExpandFn}
        onDoubleClickCard={() => triggerZoomToSoundCard(originalIndex)}
        onUpdateConfig={(_i, updates) => handleUpdateConfig(originalIndex, updates)}
        onRemove={() => onRemoveConfig(originalIndex)}
        onReset={() => handleReset(originalIndex)}
        color="primary"
        version={cardVersion}
        dimmed={isEffectivelyMuted}
        headerPrefix={headerPrefix}
        beforeContent={isGenerated ? undefined : (
          <>
            {categoryBadge}
            {linkingTipBar}
            <SoundPreContent
              config={config}
              index={originalIndex}
              isSoundGenerating={isSoundGenerating}
              isLinkingEntity={isLinkingEntity}
              linkingConfigIndex={linkingConfigIndex}
              onUpdateConfig={onUpdateConfig}
              onUploadAudio={onUploadAudio}
              onClearUploadedAudio={onClearUploadedAudio}
              onLibrarySearch={onLibrarySearch}
              onLibrarySoundSelect={onLibrarySoundSelect}
              onCatalogSoundSelect={onCatalogSoundSelect}
              availableTypes={availableTypes}
              onSwitchType={handleSwitchCardType}
            />
            {linkedEntitiesDisplay}
          </>
        )}
        afterContent={!isGenerated || !generatedSound ? undefined : (
          <>
            {categoryBadge}
            {linkingTipBar}
            <SoundResultContent
              generatedSound={generatedSound}
              index={originalIndex}
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
              schedulingMode={soundSchedulingModes[generatedSound.id] ?? 'interval'}
              soundTimestamps={soundTimestamps}
              onSchedulingModeChange={onSchedulingModeChange}
              onTimestampsChange={onTimestampsChange}
              onVariantChange={onVariantChange}
              onUpdatePosition={handleUpdateSoundPosition}
              onUnlinkEntity={() => handleDetachSoundFromEntity(originalIndex)}
            />
            {linkedEntitiesDisplay}
          </>
        )}
      />
      {isExpanded && !isGenerated && (
        <CircularFAB
          label={isSoundGenerating && (soundGenTargetIndices === null || soundGenTargetIndices.includes(originalIndex)) ? 'Generating…' : 'Generate Sound'}
          onClick={() => onGenerateSingle(originalIndex)}
          isLoading={isSoundGenerating && (soundGenTargetIndices === null || soundGenTargetIndices.includes(originalIndex))}
        />
      )}
    </div>
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
    soundGenTargetIndices,
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
    onFinishLinkingEntity,
    onSelectLinkedEntity,
    onClearLinkedEntities,
    activeLinkedEntityIdx,
    iterationLinks,
    onMute,
    onSolo,
    onDuplicateConfig,
    onPreviewPlayPause,
    onPreviewStop,
    onVolumeChange,
    onIntervalChange,
    soundSchedulingModes,
    soundTimestamps,
    onSchedulingModeChange,
    onTimestampsChange,
    onVariantChange,
    handleUpdateSoundPosition,
    handleDetachSoundFromEntity,
    serviceVersions,
    audioModel,
    triggerZoomToSoundCard,
    currentGeneratingCardIndex,
    soundGenProgressValue,
    onGenerateSingle,
    isConfigValid,
  ]);  

  // Footer with generate button
  const footer = (
    <div className="flex gap-2">
      {isSoundGenerating ? (
        /* Progress bar replaces generate button while running */
        <div
          className="flex-1 px-3 py-2 rounded-lg text-xs"
          style={{
            backgroundColor: 'var(--color-secondary-hover)',
            color: 'white',
            backgroundImage: soundGenProgressValue > 0
              ? `linear-gradient(to right, var(--card-color, var(--color-primary)) ${soundGenProgressValue}%, var(--color-secondary-hover) ${soundGenProgressValue}%)`
              : undefined,
            transition: 'background-image 0.3s ease',
          }}
        >
          <div className="flex justify-between items-center">
            <span className="font-medium">{displayProgress}</span>
            {soundGenProgressValue > 0 && (
              <span className="font-bold">{soundGenProgressValue}%</span>
            )}
          </div>
        </div>
      ) : (
        <button
          onClick={() => {
            const pendingIndices = filteredCardItems
              .filter((item) => !isSoundGenerated(item.originalIndex))
              .map((item) => item.originalIndex);
            onGenerateFiltered(pendingIndices);
          }}
          disabled={shouldDisableGenerateButton}
          className={`flex-1 py-2 px-4 rounded-lg text-white text-xs font-medium transition-colors ${
            shouldDisableGenerateButton
              ? 'bg-secondary-hover opacity-40 cursor-not-allowed'
              : 'hover:opacity-80 cursor-pointer'
          }`}
          style={!shouldDisableGenerateButton ? { backgroundColor: 'var(--card-color, var(--color-primary))' } : undefined}
        >
          Generate Sounds
        </button>
      )}

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
      items={filteredCardItems}
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
      color="primary"
      onReorder={handleReorderSoundConfigs}
      onDuplicate={(from, toInsertion) => {
        const fromOriginal = filteredCardItems[from]?.originalIndex;
        if (fromOriginal === undefined) return;
        const toOriginal = toInsertion < filteredCardItems.length
          ? filteredCardItems[toInsertion]?.originalIndex
          : soundConfigs.length;
        if (toOriginal !== undefined) {
          duplicateConfigAt(fromOriginal, toOriginal);
        }
      }}

    />
  );
}
