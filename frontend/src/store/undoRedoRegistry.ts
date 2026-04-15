/**
 * Global undo/redo registry.
 *
 * Tracks which temporal store performed the most recent action so that
 * Ctrl+Z / Ctrl+Y replay commits in the exact reverse/forward order across
 * ALL registered zundo stores — not just one.
 *
 * Usage (in store/index.ts):
 *   registerTemporalStore('myStore', useMyStore.temporal, snapshotFn)
 *
 * For continuous pointer gestures (sliders, ThreeJS drags), wrap the gesture with:
 *   pauseStore(id)   — on drag start: snapshot pre-drag state, pause temporal recording
 *   commitStore(id)  — on drag end:   push snapshot to history, resume recording
 *
 * Each .temporal is a standard Zustand store whose state has:
 *   pastStates[]  — undo history
 *   futureStates[] — redo history
 *   undo()        — move latest past → future
 *   redo()        — move latest future → past
 */

import type { TemporalState } from 'zundo';

type AnyTemporalStore = {
  getState: () => TemporalState<unknown>;
  setState: (partial: Partial<TemporalState<unknown>> | ((s: TemporalState<unknown>) => Partial<TemporalState<unknown>>)) => void;
  subscribe: (
    listener: (
      state: TemporalState<unknown>,
      prev: TemporalState<unknown>,
    ) => void,
  ) => () => void;
};

interface _StoreEntry {
  temporal: AnyTemporalStore;
  /** Returns the current partialized state — snapshot taken at pauseStore() time. */
  snapshotFn: () => unknown;
  /** Snapshot captured on pauseStore() — pushed to pastStates on commitStore(). */
  preDragSnapshot: unknown | null;
}

// Ordered list of store IDs — each entry represents one undoable user action.
// The last element is the most recent action (popped first on undo).
const _actionLog: string[] = [];

// Mirrors _actionLog in reverse: restored actions waiting to be re-applied.
const _redoLog: string[] = [];

const _stores = new Map<string, _StoreEntry>();

// Prevents the subscription listener from reacting to undo/redo calls.
let _busy = false;

/**
 * Register a temporal store with the global undo/redo system.
 * Call once per store at module-init time (e.g., from store/index.ts).
 * Safe to call multiple times with the same id — subsequent calls are no-ops.
 *
 * @param snapshotFn  Returns the partialized current state for this store.
 *                    Called inside pauseStore() to capture the pre-drag snapshot.
 */
export function registerTemporalStore(
  id: string,
  store: AnyTemporalStore,
  snapshotFn: () => unknown,
): void {
  if (_stores.has(id)) return;
  _stores.set(id, { temporal: store, snapshotFn, preDragSnapshot: null });

  store.subscribe((state, prev) => {
    if (_busy) return;

    const grew = state.pastStates.length > prev.pastStates.length;
    if (grew) {
      // A new user action was committed to this store's history.
      _actionLog.push(id);
      // Any previously undone future is now gone — mirror that globally.
      _redoLog.length = 0;
      _notifyUndoRedo();
    }
  });
}

// ─── Undo / Redo ─────────────────────────────────────────────────────────────

/** Undo the single most-recent action, targeting the correct store. */
export function globalUndo(): void {
  if (_actionLog.length === 0) return;
  const storeId = _actionLog.pop()!;
  _busy = true;
  _stores.get(storeId)?.temporal.getState().undo();
  _busy = false;
  _redoLog.push(storeId);
  _notifyUndoRedo();
}

/** Redo the most-recently undone action. */
export function globalRedo(): void {
  if (_redoLog.length === 0) return;
  const storeId = _redoLog.pop()!;
  _busy = true;
  _stores.get(storeId)?.temporal.getState().redo();
  _busy = false;
  _actionLog.push(storeId);
  _notifyUndoRedo();
}

export const canUndo = (): boolean => _actionLog.length > 0;
export const canRedo = (): boolean => _redoLog.length > 0;

// ─── Reactive subscription for UI (e.g. toolbar buttons) ─────────────────────

const _undoRedoListeners = new Set<() => void>();

// Stable cached snapshot — replaced only when values change.
let _undoRedoSnapshot = { canUndo: false, canRedo: false };

function _notifyUndoRedo(): void {
  const nextCanUndo = _actionLog.length > 0;
  const nextCanRedo = _redoLog.length > 0;
  if (nextCanUndo !== _undoRedoSnapshot.canUndo || nextCanRedo !== _undoRedoSnapshot.canRedo) {
    _undoRedoSnapshot = { canUndo: nextCanUndo, canRedo: nextCanRedo };
  }
  _undoRedoListeners.forEach((cb) => cb());
}

/**
 * Subscribe to undo/redo availability changes. Returns an unsubscribe fn.
 * Use with useSyncExternalStore for React toolbar buttons.
 */
export function subscribeUndoRedo(callback: () => void): () => void {
  _undoRedoListeners.add(callback);
  return () => _undoRedoListeners.delete(callback);
}

export function getUndoRedoSnapshot(): { canUndo: boolean; canRedo: boolean } {
  return _undoRedoSnapshot;
}

// ─── Batch gesture support ───────────────────────────────────────────────────

/**
 * Begin a batched gesture for the given store (e.g. slider drag, ThreeJS object drag).
 * - Snapshots the current partialized state as the "pre-drag" value.
 * - Pauses temporal recording so intermediate drag steps are NOT added to history.
 *
 * Must be paired with commitStore(id) on gesture end.
 */
export function pauseStore(storeId: string): void {
  const entry = _stores.get(storeId);
  if (!entry) return;
  entry.preDragSnapshot = entry.snapshotFn();
  entry.temporal.getState().pause();
}

/**
 * Finish a batched gesture:
 * - Pushes the pre-drag snapshot (captured in pauseStore) to the store's pastStates.
 *   This means undo() will restore to exactly the state before dragging started.
 * - Resumes temporal recording.
 * - Logs the action in the global action log.
 *
 * No-op if pauseStore was not called first.
 *
 * Also usable in ThreeJS:
 *   import { pauseStore, commitStore } from '@/store';
 *   mesh.addEventListener('dragstart', () => pauseStore('acousticMaterial'));
 *   mesh.addEventListener('dragend',   () => commitStore('acousticMaterial'));
 */
export function commitStore(storeId: string): void {
  const entry = _stores.get(storeId);
  if (!entry || entry.preDragSnapshot === null) return;

  const snapshot = entry.preDragSnapshot;
  entry.preDragSnapshot = null;

  // Manually push the pre-drag state to pastStates so undo() restores to before drag.
  entry.temporal.setState((ts) => ({
    ...(ts as object),
    pastStates: [...ts.pastStates, snapshot],
    futureStates: [],
  }) as Partial<TemporalState<unknown>>);

  // Resume temporal recording for future single-step actions.
  entry.temporal.getState().resume();

  // Log in the global action log.
  _actionLog.push(storeId);
  _redoLog.length = 0;
  _notifyUndoRedo();
}
