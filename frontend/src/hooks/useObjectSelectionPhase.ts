'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useSpeckleStore } from '@/store';

/**
 * Shared "select in the 3D viewer" phase controller (grid listeners, entity
 * linking, …). Owns the same mechanics as the grid-listener cards:
 *
 * - while `active && !hasConfirmedSelection`, the viewer is in "selecting"
 *   mode: the native Speckle SelectionExtension accumulates a multi-selection
 *   via shift-click (`speckleStore.selectedObjectIds`),
 * - Enter commits the current selection, Escape cancels and **clears** both the
 *   viewer highlight and the app selection state,
 * - Cancel/deselect always clears the viewer highlight (SelectionExtension),
 *   not just the Zustand array — this is the piece plain `setSelectedObjectIds([])`
 *   misses.
 *
 * Usage:
 * ```tsx
 * const { isSelecting, selectedObjectIds, startSelecting, commit, cancel } =
 *   useObjectSelectionPhase({
 *     active: isExpanded,
 *     hasConfirmedSelection: !!grid.boundingBox,
 *     onCommit: (ids) => { ...; return true; },
 *     onEnterSelecting: () => { /* clear prior meshes *\/ },
 *   });
 *
 * <HelperHint text={isSelecting ? 'Hold shift to select multiple objects, press Enter when finished.' : null} />
 * ```
 */
export function useObjectSelectionPhase({
  active = true,
  hasConfirmedSelection,
  onCommit,
  onEnterSelecting,
  onEscape,
  ignoreTyping = false,
  deps = [],
}: {
  /** Whether the selection UI is currently on screen (grid: expanded; linking: linking mode active). */
  active?: boolean;
  /** Whether there is already a confirmed selection to fall back to on cancel. */
  hasConfirmedSelection: boolean;
  /** Commit the given object IDs. Return true to leave selecting mode. */
  onCommit: (objectIds: string[]) => boolean;
  /** Fired when entering selecting mode (e.g. grid listener clears its meshes). */
  onEnterSelecting?: () => void;
  /** Extra action fired when Escape is pressed (after clearing the selection). */
  onEscape?: () => void;
  /** Skip the Enter/Escape shortcuts while typing in an input/textarea/select (sound prompt fields). */
  ignoreTyping?: boolean;
  /** Extra deps that must re-bind the Enter/Escape keydown handler. */
  deps?: React.DependencyList;
}) {
  const selectedObjectIds = useSpeckleStore((s) => s.selectedObjectIds);

  const isSelecting = active && !hasConfirmedSelection;
  const selectionRef = useRef<string[]>([]);

  // Snapshot the current multi-selection while selecting (so Enter commits
  // exactly what the user picked, even if a deselect event lands in between).
  useEffect(() => {
    if (isSelecting) selectionRef.current = [...selectedObjectIds];
  }, [selectedObjectIds, isSelecting]);

  const startSelecting = useCallback(() => {
    onEnterSelecting?.();
    useSpeckleStore.getState().clearViewerSelection();
  }, [onEnterSelecting]);

  const commit = useCallback(() => {
    const ids = selectionRef.current.length > 0 ? selectionRef.current : selectedObjectIds;
    if (ids.length === 0) return;
    selectionRef.current = [];
    onCommit(ids);
  }, [onCommit, selectedObjectIds]);

  const cancel = useCallback(() => {
    selectionRef.current = [];
    useSpeckleStore.getState().clearViewerSelection();
  }, []);

  useEffect(() => {
    if (!isSelecting) return;
    const handler = (e: KeyboardEvent) => {
      if (ignoreTyping) {
        const el = document.activeElement;
        if (
          el &&
          (el.tagName === 'INPUT' ||
            el.tagName === 'TEXTAREA' ||
            el.tagName === 'SELECT' ||
            (el as HTMLElement).isContentEditable)
        ) {
          return;
        }
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
        onEscape?.();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSelecting, commit, cancel, onEscape, ignoreTyping, ...deps]);

  return { isSelecting, selectedObjectIds, startSelecting, commit, cancel };
}