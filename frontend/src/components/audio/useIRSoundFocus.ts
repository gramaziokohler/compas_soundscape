import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { useSoundscapeStore, useUIStore } from '@/store';
import { FOCUS_SCROLL } from '@/utils/constants';
import { scrollIntoContainer } from '@/utils/scrollIntoContainer';

/** Data attribute an IR row carries with its source position key (`sourceId`). */
export const IR_SOURCE_ROW_ATTR = 'data-ir-source-id';

interface UseIRSoundFocusOptions {
  /** Only an expanded simulation card follows the focus. */
  enabled: boolean;
  /** Simulation-time sound ID → source position key (`simulationPositions.soundToPosKey`). */
  soundToPosKey: Record<string, string> | undefined;
  /** The IR list's own scroll container. */
  containerRef: RefObject<HTMLDivElement | null>;
  /** Expands the receiver groups holding these source keys before the scroll. */
  revealSources: (sourceIds: Set<string>) => void;
}

/**
 * IR list side of the shared sound focus (`uiStore.soundFocus`): a DAW track / clip,
 * sound sphere or sound card click scrolls an expanded simulation card's IR list to the
 * first IR of that sound's source position (expanding its receiver group), and every
 * matching IR row stays highlighted while the sound is focused.
 *
 * Usage:
 * ```tsx
 * const focusedSourceIds = useIRSoundFocus({ enabled: isExpanded, soundToPosKey, containerRef, revealSources });
 * <div {...{ [IR_SOURCE_ROW_ATTR]: sourceId }}>…</div>
 * ```
 */
export function useIRSoundFocus({
  enabled,
  soundToPosKey,
  containerRef,
  revealSources,
}: UseIRSoundFocusOptions): Set<string> {
  const soundFocus = useUIStore((s) => s.soundFocus);
  const soundscapeData = useSoundscapeStore((s) => s.soundscapeData);
  const handledVersionRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Source position keys of every simulated sound of the focused card (all its variants).
  const focusedSourceIds = useMemo(() => {
    const ids = new Set<string>();
    if (!soundFocus || !soundToPosKey) return ids;
    for (const sound of soundscapeData ?? []) {
      if ((sound.prompt_index ?? 0) !== soundFocus.index) continue;
      const posKey = soundToPosKey[sound.id];
      if (posKey) ids.add(posKey);
    }
    return ids;
  }, [soundFocus, soundToPosKey, soundscapeData]);

  useEffect(() => {
    if (!enabled || !soundFocus || handledVersionRef.current === soundFocus.version) return;
    handledVersionRef.current = soundFocus.version;
    if (focusedSourceIds.size === 0) return;
    revealSources(focusedSourceIds);
    if (timerRef.current) clearTimeout(timerRef.current);
    // Wait for the revealed group to lay out before measuring the row.
    timerRef.current = setTimeout(() => {
      const container = containerRef.current;
      const rows = container?.querySelectorAll<HTMLElement>(`[${IR_SOURCE_ROW_ATTR}]`) ?? [];
      const row = Array.from(rows).find((el) => focusedSourceIds.has(el.getAttribute(IR_SOURCE_ROW_ATTR) ?? ''));
      if (!container || !row) return;
      scrollIntoContainer(container, { align: 'nearest' }); // the IR list into the sidebar view
      scrollIntoContainer(row, { align: 'nearest' });
    }, FOCUS_SCROLL.SETTLE_DELAY_MS);
  }, [enabled, soundFocus?.version, focusedSourceIds]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return focusedSourceIds;
}
