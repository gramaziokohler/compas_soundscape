import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useUIStore } from '@/store';

/** The slice of a sidebar sound card item the focus sync needs. */
interface FocusCardItem {
  originalIndex: number;
}

interface UseSoundCardFocusParams {
  /** Cards shown by this section (possibly filtered to one scene). */
  filteredCardItems: FocusCardItem[];
  /** Expands a card by its position in `filteredCardItems`. */
  setExpandedIndex: (filteredIndex: number) => void;
}

interface UseSoundCardFocusResult {
  /** Feed to `CardSection.scrollRequest` (position in `filteredCardItems`). */
  scrollRequest: { index: number; version: number } | null;
  /** Call when the user expands (index) or collapses (null) a card. */
  publishCardExpansion: (originalIndex: number | null) => void;
}

/**
 * Sound cards side of the shared sound focus (`uiStore.soundFocus`):
 * - a focus from the 3D scene or the DAW expands its card and scrolls its header to the top,
 *   once per focus `version` — also when the card only appears later (scene panel switched
 *   to the sound's scene) or when this section mounts after the focus was set;
 * - a card the user expands becomes the focus (source `'card'`), so the sphere and the DAW
 *   track follow; collapsing the focused card clears the focus.
 *
 * Runs in a layout effect so a section mounting with a focus never flashes card 0 expanded.
 *
 * Usage:
 * ```ts
 * const { scrollRequest, publishCardExpansion } = useSoundCardFocus({ filteredCardItems, setExpandedIndex });
 * ```
 */
export function useSoundCardFocus({
  filteredCardItems,
  setExpandedIndex,
}: UseSoundCardFocusParams): UseSoundCardFocusResult {
  const soundFocus = useUIStore((s) => s.soundFocus);
  const [scrollRequest, setScrollRequest] = useState<{ index: number; version: number } | null>(null);
  // Last focus version applied here (null = none yet, so a focus present at mount applies).
  const appliedVersionRef = useRef<number | null>(null);
  const mountedRef = useRef(false);

  const visibleKey = filteredCardItems.map((item) => item.originalIndex).join(',');

  useLayoutEffect(() => {
    const isMount = !mountedRef.current;
    mountedRef.current = true;
    if (!soundFocus || appliedVersionRef.current === soundFocus.version) return;
    const filteredIdx = filteredCardItems.findIndex((item) => item.originalIndex === soundFocus.index);
    if (filteredIdx < 0) return; // not shown here (yet) — retried when the visible cards change
    appliedVersionRef.current = soundFocus.version;
    setExpandedIndex(filteredIdx);
    useUIStore.getState().setExpandedSoundCardIndex(soundFocus.index);
    // The user's own card click is already in view; anything else scrolls to the card.
    if (isMount || soundFocus.source !== 'card') {
      setScrollRequest((prev) => ({ index: filteredIdx, version: (prev?.version ?? 0) + 1 }));
    }
  }, [soundFocus?.version, visibleKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const publishCardExpansion = useCallback((originalIndex: number | null) => {
    const ui = useUIStore.getState();
    const collapsedIndex = ui.expandedSoundCardIndex;
    ui.setExpandedSoundCardIndex(originalIndex);
    if (originalIndex !== null) {
      ui.focusSound(originalIndex, 'card');
      // Our own focus: mark it applied so the effect does not re-expand / scroll.
      appliedVersionRef.current = useUIStore.getState().soundFocus?.version ?? null;
    } else if (ui.soundFocus !== null && ui.soundFocus.index === collapsedIndex) {
      ui.clearSoundFocus();
    }
  }, []);

  return { scrollRequest, publishCardExpansion };
}
