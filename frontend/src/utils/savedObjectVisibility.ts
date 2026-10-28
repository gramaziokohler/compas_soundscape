/**
 * Saved object visibility — shared helpers for the "Save object visibility" /
 * "Clear saved visibility" rows of the scene and simulation card menus (Simple
 * bubbles and Expert cards), plus the snapshot summary used by the toast.
 *
 * The snapshot itself lives on the card config (`savedObjectVisibility`) and is
 * restored by `useApplySavedObjectVisibility` when the card is powered on.
 */

import { notifyError, useSpeckleStore } from '@/store';
import type { SavedObjectVisibility } from '@/types/card';
import { SAVED_OBJECT_VISIBILITY } from '@/utils/constants';

/** A menu row independent of the menu component (ContextMenu / Card kebab). */
export interface SavedVisibilityRow {
  key: string;
  label: string;
  /** True when a saved view already exists (save row) — rendered as selected. */
  isActive?: boolean;
  onClick: () => void;
}

export interface SavedVisibilityRowsOptions {
  /** Currently saved view of the card, if any. */
  saved: SavedObjectVisibility | undefined;
  /** Persist the freshly captured view on the card. */
  onSave: (snapshot: SavedObjectVisibility) => void;
  /** Remove the saved view from the card. */
  onClear: () => void;
}

/** Defensive copy so a saved view never shares arrays with the live store. */
function cloneSnapshot(s: SavedObjectVisibility): SavedObjectVisibility {
  return { hiddenIds: [...s.hiddenIds], isolatedIds: [...s.isolatedIds], excludedIds: [...s.excludedIds] };
}

/** Normalises a possibly partial / foreign value (loaded JSON); undefined when unusable. */
export function normalizeSavedObjectVisibility(raw: unknown): SavedObjectVisibility | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Partial<Record<keyof SavedObjectVisibility, unknown>>;
  const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  return { hiddenIds: list(r.hiddenIds), isolatedIds: list(r.isolatedIds), excludedIds: list(r.excludedIds) };
}

/** "Saved object visibility: 12 hidden, 0 isolated" (adds excluded only when present). */
export function describeSavedObjectVisibility(s: SavedObjectVisibility): string {
  if (s.hiddenIds.length === 0 && s.isolatedIds.length === 0 && s.excludedIds.length === 0) {
    return SAVED_OBJECT_VISIBILITY.TOAST_ALL_VISIBLE;
  }
  const parts = [`${s.hiddenIds.length} hidden`, `${s.isolatedIds.length} isolated`];
  if (s.excludedIds.length > 0) parts.push(`${s.excludedIds.length} excluded`);
  return `Saved object visibility: ${parts.join(', ')}`;
}

/** Snapshot of the Object Explorer's current hide / isolate / exclude intent. */
export function captureObjectVisibility(): SavedObjectVisibility {
  return cloneSnapshot(useSpeckleStore.getState().getVisibilitySnapshot());
}

/** Save + (optional) clear rows for a card whose saved view is `saved`. */
export function buildSavedVisibilityRows({ saved, onSave, onClear }: SavedVisibilityRowsOptions): SavedVisibilityRow[] {
  const rows: SavedVisibilityRow[] = [
    {
      key: 'save-object-visibility',
      label: saved ? SAVED_OBJECT_VISIBILITY.RESAVE_LABEL : SAVED_OBJECT_VISIBILITY.SAVE_LABEL,
      isActive: !!saved,
      onClick: () => {
        const snapshot = captureObjectVisibility();
        onSave(snapshot);
        notifyError(describeSavedObjectVisibility(snapshot), 'info');
      },
    },
  ];
  if (saved) {
    rows.push({
      key: 'clear-object-visibility',
      label: SAVED_OBJECT_VISIBILITY.CLEAR_LABEL,
      onClick: () => {
        onClear();
        notifyError(SAVED_OBJECT_VISIBILITY.CLEARED_TOAST, 'info');
      },
    });
  }
  return rows;
}
