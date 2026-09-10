'use client';

import { useCallback, useRef, useState } from 'react';

interface ClipModifiers {
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

/**
 * Selection state for DAW clips. Transient — not persisted, not undoable.
 *
 * Two entry points from the gesture layer:
 * - `onClipPressed` fires on pointerdown, before we know if the gesture becomes a
 *   drag or a plain click. Shift/ctrl are resolved immediately (so a drag can act
 *   on the resulting selection); a plain press on an already multi-selected clip
 *   is left untouched (so the group can be dragged) until...
 * - `onClipClicked` fires only when the press resolves to a click (no meaningful
 *   pointer movement) — this is where a plain click collapses a multi-selection
 *   down to the single clicked clip, and where ctrl+click (which doubles as the
 *   "duplicate drag" modifier) toggles membership.
 */
export function useClipSelection() {
  const [selectedClipKeys, setSelectedClipKeys] = useState<Set<string>>(new Set());
  const anchorRef = useRef<string | null>(null);

  const replace = useCallback((keys: string[]) => {
    setSelectedClipKeys(new Set(keys));
  }, []);

  const selectOnly = useCallback((clipKey: string) => {
    anchorRef.current = clipKey;
    setSelectedClipKeys(new Set([clipKey]));
  }, []);

  const toggle = useCallback((clipKey: string) => {
    anchorRef.current = clipKey;
    setSelectedClipKeys((prev) => {
      const next = new Set(prev);
      if (next.has(clipKey)) next.delete(clipKey);
      else next.add(clipKey);
      return next;
    });
  }, []);

  const extendRange = useCallback((clipKey: string, orderedKeysInTrack: string[]) => {
    const anchor = anchorRef.current;
    const ai = anchor ? orderedKeysInTrack.indexOf(anchor) : -1;
    const bi = orderedKeysInTrack.indexOf(clipKey);
    if (ai === -1 || bi === -1) {
      selectOnly(clipKey);
      return;
    }
    const [lo, hi] = ai <= bi ? [ai, bi] : [bi, ai];
    setSelectedClipKeys(new Set(orderedKeysInTrack.slice(lo, hi + 1)));
  }, [selectOnly]);

  const onClipPressed = useCallback((clipKey: string, e: ClipModifiers, orderedKeysInTrack: string[]) => {
    if (e.shiftKey) {
      extendRange(clipKey, orderedKeysInTrack);
      return;
    }
    if (e.ctrlKey || e.metaKey) return; // resolved on click/duplicate — don't touch selection yet
    setSelectedClipKeys((prev) => (prev.has(clipKey) ? prev : new Set([clipKey])));
    if (!selectedClipKeys.has(clipKey)) anchorRef.current = clipKey;
  }, [extendRange, selectedClipKeys]);

  const onClipClicked = useCallback((clipKey: string, e: ClipModifiers) => {
    if (e.shiftKey) return; // already handled on press
    if (e.ctrlKey || e.metaKey) {
      toggle(clipKey);
      return;
    }
    selectOnly(clipKey);
  }, [toggle, selectOnly]);

  const clear = useCallback(() => {
    anchorRef.current = null;
    setSelectedClipKeys(new Set());
  }, []);

  const selectAll = useCallback((allKeys: string[]) => setSelectedClipKeys(new Set(allKeys)), []);
  const setMarquee = useCallback((keys: string[]) => setSelectedClipKeys(new Set(keys)), []);
  const isSelected = useCallback((k: string) => selectedClipKeys.has(k), [selectedClipKeys]);

  return {
    selectedClipKeys,
    isSelected,
    onClipPressed,
    onClipClicked,
    clear,
    selectAll,
    setMarquee,
    replace,
  };
}
