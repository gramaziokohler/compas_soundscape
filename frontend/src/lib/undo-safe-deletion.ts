/**
 * Undo-safe server deletions.
 *
 * Removing an item in the UI is undoable, but deleting its backing file on the
 * backend is not: an undo would bring back a card / variant whose audio is gone.
 * Such deletions are therefore DEFERRED until the removal can no longer be
 * undone — when undo history is cleared (another project / model opened) or
 * the page is closed — and skipped if the item is referenced again by then
 * (e.g. the removal was undone).
 */

import { onUndoHistoryCleared } from '@/store/undoRedoRegistry';

interface PendingDeletion {
  /** True while the live app state still uses the resource (e.g. after an undo). */
  isReferenced: () => boolean;
  run: () => Promise<unknown> | void;
}

const _pending = new Map<string, PendingDeletion>();
let _installed = false;

function install(): void {
  if (_installed || typeof window === 'undefined') return;
  _installed = true;
  onUndoHistoryCleared(flushUndoSafeDeletions);
  window.addEventListener('pagehide', flushUndoSafeDeletions);
}

/**
 * Schedule a backend deletion for when it can no longer be undone. Scheduling
 * the same key again replaces the earlier entry.
 */
export function scheduleUndoSafeDeletion(key: string, deletion: PendingDeletion): void {
  install();
  _pending.set(key, deletion);
}

/** Run every pending deletion whose resource is no longer referenced. */
export function flushUndoSafeDeletions(): void {
  const entries = [..._pending.values()];
  _pending.clear();
  for (const { isReferenced, run } of entries) {
    if (isReferenced()) continue;
    try {
      void Promise.resolve(run()).catch((err) => console.warn('[undo-safe-deletion] delete failed:', err));
    } catch (err) {
      console.warn('[undo-safe-deletion] delete failed:', err);
    }
  }
}
