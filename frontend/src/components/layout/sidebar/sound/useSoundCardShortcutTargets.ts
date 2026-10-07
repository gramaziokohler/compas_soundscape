import { useEffect, useRef } from 'react';
import { registerShortcutTarget } from '@/lib/shortcuts/shortcut-targets';
import { useAudioControlsStore } from '@/store';
import type { SoundEvent, SoundGenerationConfig } from '@/types';

/** The slice of a sidebar sound card item these shortcuts need. */
interface ShortcutCardItem {
  originalIndex: number;
  originalConfig: Pick<SoundGenerationConfig, 'uploadedAudioUrl' | 'uploadedAudioInfo'>;
}

/** Shared key for a pre-generation (upload / sample-audio) preview of a card. */
export function getPreGenPreviewKey(originalIndex: number): string {
  return `pregen:${originalIndex}`;
}

/**
 * Preview key Space should toggle for a card, or null when the card has
 * nothing to play: the selected variant once generated, otherwise the
 * uploaded / sample audio (rendered by UploadMode / SampleAudioMode).
 */
export function getCardPreviewKey(
  item: ShortcutCardItem,
  generatedSound: SoundEvent | undefined,
  isGenerated: boolean,
): string | null {
  if (isGenerated) return generatedSound?.id ?? null;
  const config = item.originalConfig;
  return config.uploadedAudioUrl && config.uploadedAudioInfo ? getPreGenPreviewKey(item.originalIndex) : null;
}

interface UseSoundCardShortcutTargetsParams {
  /** Expanded card position in `filteredCardItems` (null = none). */
  expandedIndex: number | null;
  filteredCardItems: ShortcutCardItem[];
  isSoundGenerated: (originalIndex: number) => boolean;
  getGeneratedSound: (originalIndex: number) => SoundEvent | undefined;
  onExpandedIndexChange: (filteredIndex: number | null) => void;
  onRemoveConfig: (originalIndex: number) => void;
  onZoomToCard: (originalIndex: number) => void;
}

/**
 * Publishes the sound-card list to the keyboard shortcut registry:
 * Space plays the expanded card's preview (cardPreview slot), Alt+↑/↓ move
 * between cards, Esc collapses, Delete removes, F zooms to its sphere.
 * Registered while the section is mounted; reads the latest props via a ref.
 */
export function useSoundCardShortcutTargets(params: UseSoundCardShortcutTargetsParams): void {
  const latest = useRef(params);
  latest.current = params;

  useEffect(() => {
    const expandedItem = (): ShortcutCardItem | undefined => {
      const { expandedIndex, filteredCardItems } = latest.current;
      return expandedIndex !== null ? filteredCardItems[expandedIndex] : undefined;
    };

    const expandedPreviewKey = (): string | null => {
      const item = expandedItem();
      if (!item) return null;
      const { isSoundGenerated, getGeneratedSound } = latest.current;
      return getCardPreviewKey(item, getGeneratedSound(item.originalIndex), isSoundGenerated(item.originalIndex));
    };

    const unregisterPreview = registerShortcutTarget('cardPreview', {
      canToggle: () => expandedPreviewKey() !== null,
      toggle: () => {
        const key = expandedPreviewKey();
        if (key) useAudioControlsStore.getState().handlePreviewPlayPause(key);
      },
      stop: () => {
        const key = expandedPreviewKey();
        const audio = useAudioControlsStore.getState();
        if (key && audio.previewingSoundId === key) audio.handlePreviewStop(key);
      },
    });

    const unregisterCards = registerShortcutTarget('soundCards', {
      step: (direction) => {
        const { expandedIndex, filteredCardItems, onExpandedIndexChange } = latest.current;
        const count = filteredCardItems.length;
        if (count === 0) return;
        const next = expandedIndex === null
          ? (direction === 1 ? 0 : count - 1)
          : Math.min(Math.max(expandedIndex + direction, 0), count - 1);
        if (next !== expandedIndex) onExpandedIndexChange(next);
      },
      collapse: () => {
        if (latest.current.expandedIndex === null) return false;
        latest.current.onExpandedIndexChange(null);
        return true;
      },
      removeExpanded: () => {
        const item = expandedItem();
        if (!item) return false;
        latest.current.onRemoveConfig(item.originalIndex);
        return true;
      },
      zoomToExpanded: () => {
        const item = expandedItem();
        if (!item) return false;
        latest.current.onZoomToCard(item.originalIndex);
        return true;
      },
    });

    return () => {
      unregisterPreview();
      unregisterCards();
    };
  }, []);
}
