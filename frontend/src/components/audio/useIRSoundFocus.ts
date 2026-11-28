import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { useSoundscapeStore, useUIStore } from '@/store';
import { FOCUS_SCROLL } from '@/utils/constants';
import { scrollIntoContainer } from '@/utils/scrollIntoContainer';

/** Data attribute an IR row carries with its source position key (`sourceId`). */
export const IR_SOURCE_ROW_ATTR = 'data-ir-source-id';
/** Data attribute an IR receiver group carries with its group id. */
export const IR_GROUP_ATTR = 'data-ir-group-id';

/**
 * Picks the receiver group to scroll to, expands it and returns its id (null: none).
 * `listenerFirst` (a listener click): `groupId` wins. Otherwise (a sound click) `groupId`
 * only when it holds one of `sourceIds`, else the first group that does.
 */
export type RevealIRGroup = (groupId: string | null, sourceIds: Set<string>, listenerFirst: boolean) => string | null;

interface UseIRSoundFocusOptions {
  /** Only an expanded simulation card follows the focus; a collapsed one stays collapsed. */
  enabled: boolean;
  /** Simulation-time sound ID → source position key (`simulationPositions.soundToPosKey`). */
  soundToPosKey: Record<string, string> | undefined;
  /** The IR list's own scroll container. */
  containerRef: RefObject<HTMLDivElement | null>;
  revealGroup: RevealIRGroup;
  /** FPS (go-to-listener) group: a sound click targets only this listener's IR. */
  pinnedGroupId?: string | null;
}

interface UseIRSoundFocusResult {
  /** Source position keys of the focused sound — its IR rows are highlighted. */
  focusedSourceIds: Set<string>;
  /** Receiver group of the last listener clicked in the scene — outlined. */
  focusedGroupId: string | null;
}

/** First element under `root` whose `attr` is in `values`. */
function findByAttr(root: ParentNode, attr: string, values: Set<string>): HTMLElement | null {
  const els = root.querySelectorAll<HTMLElement>(`[${attr}]`);
  return Array.from(els).find((el) => values.has(el.getAttribute(attr) ?? '')) ?? null;
}

/**
 * IR list side of the shared focus: an expanded simulation card scrolls its IR list to
 * - the focused sound's IR (`uiStore.soundFocus`: DAW track / clip, sound sphere or sound
 *   card click), inside the last clicked listener's group when it has one;
 * - the clicked listener's group (`uiStore.listenerFocus`: receiver / grid point click),
 *   on the focused sound's row when the group has one.
 * In FPS mode (`pinnedGroupId`) a sound click targets the powered listener's group only.
 * The target group is expanded (an expanded one stays expanded); nothing else collapses.
 *
 * Usage:
 * ```tsx
 * const { focusedSourceIds, focusedGroupId } = useIRSoundFocus({ enabled: isExpanded, soundToPosKey, containerRef, revealGroup });
 * <div {...{ [IR_GROUP_ATTR]: groupId }}>…<div {...{ [IR_SOURCE_ROW_ATTR]: sourceId }}>…</div></div>
 * ```
 */
export function useIRSoundFocus({
  enabled,
  soundToPosKey,
  containerRef,
  revealGroup,
  pinnedGroupId = null,
}: UseIRSoundFocusOptions): UseIRSoundFocusResult {
  const soundFocus = useUIStore((s) => s.soundFocus);
  const listenerFocus = useUIStore((s) => s.listenerFocus);
  const soundscapeData = useSoundscapeStore((s) => s.soundscapeData);
  const handledSoundRef = useRef<number | null>(null);
  const handledListenerRef = useRef<number | null>(null);
  const wasEnabledRef = useRef(false);
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

  const listenerId = listenerFocus?.id ?? null;

  useEffect(() => {
    const justEnabled = enabled && !wasEnabledRef.current;
    wasEnabledRef.current = enabled;
    if (!enabled) return;
    if (justEnabled) {
      // Expanding the card (or mounting expanded) never jumps to an earlier click.
      handledSoundRef.current = soundFocus?.version ?? null;
      handledListenerRef.current = listenerFocus?.version ?? null;
      return;
    }
    const soundChanged = !!soundFocus && handledSoundRef.current !== soundFocus.version;
    const listenerChanged = !!listenerFocus && handledListenerRef.current !== listenerFocus.version;
    if (!soundChanged && !listenerChanged) return;
    handledSoundRef.current = soundFocus?.version ?? null;
    handledListenerRef.current = listenerFocus?.version ?? null;
    // A sound click needs IRs of that sound; a listener click scrolls to its group anyway.
    if (soundChanged && !listenerChanged && focusedSourceIds.size === 0) return;

    // FPS: the powered listener's group wins over any earlier listener click.
    const groupId = pinnedGroupId && !listenerChanged
      ? revealGroup(pinnedGroupId, focusedSourceIds, true)
      : revealGroup(listenerId, focusedSourceIds, listenerChanged);
    if (!groupId) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    // Wait for the revealed group to lay out before measuring it.
    timerRef.current = setTimeout(() => {
      const container = containerRef.current;
      const group = container ? findByAttr(container, IR_GROUP_ATTR, new Set([groupId])) : null;
      if (!container || !group) return;
      const target = findByAttr(group, IR_SOURCE_ROW_ATTR, focusedSourceIds) ?? group;
      scrollIntoContainer(container, { align: 'nearest' }); // the IR list into the sidebar view
      scrollIntoContainer(target, { align: 'nearest' });
    }, FOCUS_SCROLL.SETTLE_DELAY_MS);
  }, [enabled, soundFocus?.version, listenerFocus?.version, focusedSourceIds]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return { focusedSourceIds, focusedGroupId: listenerId };
}
