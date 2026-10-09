/**
 * Global undo/redo registry.
 *
 * Every undoable store is a zundo `temporal` store registered here. The
 * registry owns the GLOBAL history: Ctrl+Z / Ctrl+Y (and the toolbar) replay
 * user actions in exact reverse/forward order across ALL registered stores.
 *
 * Model — "one user interaction = one undo step":
 *   • Steps are GROUPS. Every history entry pushed by any store while a group is
 *     open joins that group, so an action that touches several stores (e.g. a
 *     DAW clip move writes soundscape + audioControls) undoes in ONE Ctrl+Z.
 *     A group opens on the first push and closes UNDO_GROUP_WINDOW_MS later.
 *   • Interaction sessions: every user input — a pointer press (through the
 *     click it produces), a key press, a text-field edit (focus → blur), a drop
 *     or a file pick — pauses every store and commits ONE step at the end with
 *     whatever changed. Sliders, drags, resizes and typing therefore never
 *     flood history, without per-component wiring (installUndoInteractionTracking,
 *     mounted by useUndoRedo).
 *   • Background writes (job results, streamed LLM output — anything recorded
 *     outside an interaction) are steps too, but consecutive background writes
 *     to a store collapse into one step while it is the latest step.
 *   • Undo / redo apply a store's snapshot through its `apply` function, so a
 *     store can keep runtime fields (job progress, live results, non-cloneable
 *     handles) that are deliberately excluded from its snapshot.
 *   • Right after an undo / redo, every store is paused until the next
 *     macrotask so React effects that re-derive state from the restored values
 *     (echo writes) neither become new steps nor wipe the redo stack.
 *   • Derived recomputations (e.g. timeline bakes) run inside runWithoutUndo.
 *   • clearUndoHistory() drops everything — call it after opening a project.
 *
 * Registration (store/index.ts):
 *   registerTemporalStore('myStore', useMyStore, { partialize: myStorePartialize })
 *
 * Every temporal store must pass `equality: undoEquality` (and the same
 * `partialize`) to zundo so writes that do not change the snapshot (progress,
 * flags, play state) never create an empty undo step.
 *
 * Explicit gestures (still supported, nest safely inside sessions):
 *   pauseStore(id)   — snapshot pre-gesture state and pause recording
 *   commitStore(id)  — push the snapshot as one step (only if something changed)
 */

import type { TemporalState } from 'zundo';
import type { StoreApi } from 'zustand';

// ─── Shared temporal options ────────────────────────────────────────────────

/** Max entries kept per store and max global steps. */
export const UNDO_HISTORY_LIMIT = 200;

/** Pushes within this window after the first one form a single undo step. */
const UNDO_GROUP_WINDOW_MS = 50;

/**
 * Structural equality for partialized snapshots. Handles primitives, arrays,
 * plain objects, Map, Set and Date. Any other object (File, AudioBuffer, class
 * instances) compares by reference. Reference-equal subtrees short-circuit, so
 * snapshots that share structure compare in O(changed).
 */
export function undoEquality(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;

  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!undoEquality(a[i], b[i])) return false;
    return true;
  }
  if (Array.isArray(b)) return false;

  if (a instanceof Map) {
    if (!(b instanceof Map) || a.size !== b.size) return false;
    for (const [k, v] of a) {
      if (!b.has(k) || !undoEquality(v, b.get(k))) return false;
    }
    return true;
  }
  if (a instanceof Set) {
    if (!(b instanceof Set) || a.size !== b.size) return false;
    for (const v of a) if (!b.has(v)) return false;
    return true;
  }
  if (a instanceof Date) return b instanceof Date && a.getTime() === b.getTime();

  const protoA = Object.getPrototypeOf(a);
  const protoB = Object.getPrototypeOf(b);
  const plainA = protoA === Object.prototype || protoA === null;
  const plainB = protoB === Object.prototype || protoB === null;
  if (!plainA || !plainB) return false; // non-plain objects: reference only

  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const keysA = Object.keys(ra).filter((k) => ra[k] !== undefined);
  const keysB = Object.keys(rb).filter((k) => rb[k] !== undefined);
  if (keysA.length !== keysB.length) return false;
  for (const k of keysA) {
    if (!undoEquality(ra[k], rb[k])) return false;
  }
  return true;
}

// ─── Registry ───────────────────────────────────────────────────────────────

/** History entries are partialized snapshots (opaque to the registry). */
type Snap = Record<string, unknown>;
type AnyTemporal = StoreApi<TemporalState<Snap>>;

/** Minimal shape of a zustand store wrapped with zundo `temporal`. */
export interface UndoableStore<S, P> {
  getState: () => S;
  setState: (partial: Partial<S>) => void;
  temporal: StoreApi<TemporalState<P>>;
}

export interface RegisterTemporalStoreOptions<S, P> {
  /** Same partialize as passed to zundo — the snapshot recorded in history. */
  partialize: (state: S) => P;
  /**
   * Same equality as passed to zundo (defaults to undoEquality). Return true
   * when two snapshots differ only in fields that must not create a step
   * (runtime / progress / view fields kept in the snapshot for restore).
   */
  equality?: (a: P, b: P) => boolean;
  /**
   * Restore a snapshot onto the live store. Defaults to a top-level merge
   * (`setState(snapshot)`). Override to keep runtime fields that the snapshot
   * omits, or to re-sync side effects (viewer visibility, module refs, …).
   */
  apply?: (snapshot: P) => void;
}

interface Entry {
  id: string;
  temporal: AnyTemporal;
  snapshot: () => unknown;
  equal: (a: unknown, b: unknown) => boolean;
  apply: (snapshot: unknown) => void;
  /** Pre-gesture snapshot (pauseStore → commitStore). */
  gesture: { snapshot: unknown; wasTracking: boolean } | null;
  /** Paused by the post-undo echo window (resumed by its timer). */
  echoPaused: boolean;
  /** Set by zundo's onSave; handled by the temporal subscriber right after. */
  pendingPush: boolean;
  /**
   * History entry + step created by the last BACKGROUND push (a write outside
   * any user interaction: job results, streamed LLM output). Consecutive
   * background writes collapse into that entry while its step is still the
   * latest one, so a streamed result undoes in one step.
   */
  backgroundTop: unknown;
  backgroundStep: Step | null;
}

const _stores = new Map<string, Entry>();

/** A step = the ids of the stores that pushed history, in push order. */
type Step = string[];
const _undoStack: Step[] = [];
const _redoStack: Step[] = [];

let _openStep: Step | null = null;
let _openStepTimer: ReturnType<typeof setTimeout> | null = null;

/** True while the registry itself mutates a temporal store (ignore its events). */
let _busy = false;

function closeOpenStep(): void {
  if (_openStepTimer) clearTimeout(_openStepTimer);
  _openStepTimer = null;
  _openStep = null;
}

function logPush(id: string): void {
  if (!_openStep) {
    _openStep = [];
    _undoStack.push(_openStep);
    if (_undoStack.length > UNDO_HISTORY_LIMIT) _undoStack.shift();
    _openStepTimer = setTimeout(closeOpenStep, UNDO_GROUP_WINDOW_MS);
  }
  _openStep.push(id);
  _redoStack.length = 0;
  _notifyUndoRedo();
}

function purgeStore(id: string): void {
  for (const stack of [_undoStack, _redoStack]) {
    for (let i = stack.length - 1; i >= 0; i--) {
      const remaining = stack[i].filter((s) => s !== id);
      if (remaining.length > 0) {
        stack[i].splice(0, stack[i].length, ...remaining);
        continue;
      }
      if (stack[i] === _openStep) closeOpenStep();
      stack.splice(i, 1);
    }
  }
  _notifyUndoRedo();
}

/**
 * Register a temporal store with the global undo/redo system.
 * Call once per store at module-init time (store/index.ts). Re-registering the
 * same id is a no-op.
 */
export function registerTemporalStore<S, P>(
  id: string,
  store: UndoableStore<S, P>,
  options: RegisterTemporalStoreOptions<S, P>,
): void {
  if (_stores.has(id)) return;
  const temporal = store.temporal as unknown as AnyTemporal;
  const entry: Entry = {
    id,
    temporal,
    snapshot: () => options.partialize(store.getState()),
    equal: (a, b) => (options.equality ?? undoEquality)(a as P, b as P),
    apply: (snapshot) => {
      if (options.apply) options.apply(snapshot as P);
      else store.setState(snapshot as Partial<S>);
    },
    gesture: null,
    echoPaused: false,
    pendingPush: false,
    backgroundTop: null,
    backgroundStep: null,
  };
  _stores.set(id, entry);

  // zundo calls onSave for every recorded entry (tracking on + equality false),
  // right before it appends to pastStates. User interactions pause recording
  // (sessions), so these pushes are background / programmatic writes.
  temporal.getState().setOnSave(() => {
    if (!_busy) entry.pendingPush = true;
  });

  temporal.subscribe((state, prev) => {
    if (_busy) return;
    if (entry.pendingPush) {
      entry.pendingPush = false;
      handleBackgroundPush(entry, prev.pastStates[prev.pastStates.length - 1], state.pastStates);
      return;
    }
    // External `temporal.clear()` → drop this store from the global stacks.
    const cleared =
      (state.pastStates !== prev.pastStates || state.futureStates !== prev.futureStates) &&
      state.pastStates.length === 0 &&
      state.futureStates.length === 0;
    const hadHistory = prev.pastStates.length > 0 || prev.futureStates.length > 0;
    if (cleared) {
      // Whatever the store holds now is its new baseline — an open gesture
      // must not commit the pre-clear state as a step.
      if (entry.gesture) entry.gesture.snapshot = entry.snapshot();
      if (hadHistory) {
        entry.backgroundTop = null;
        entry.backgroundStep = null;
        purgeStore(id);
      }
    }
  });
}

function handleBackgroundPush(entry: Entry, prevTop: unknown, pastStates: unknown[]): void {
  const coalesce =
    entry.backgroundStep !== null &&
    entry.backgroundTop === prevTop &&
    _undoStack[_undoStack.length - 1] === entry.backgroundStep;

  if (coalesce) {
    // Keep the pre-job snapshot on top: drop the entry zundo just appended.
    _busy = true;
    try {
      entry.temporal.setState({ pastStates: pastStates.slice(0, -1) as Snap[] });
    } finally {
      _busy = false;
    }
    if (_redoStack.length > 0) {
      _redoStack.length = 0;
      _notifyUndoRedo();
    }
    return;
  }

  logPush(entry.id);
  entry.backgroundTop = pastStates[pastStates.length - 1];
  entry.backgroundStep = _openStep;
}

// ─── Snapshot stepping ──────────────────────────────────────────────────────

/** Apply the store's top past/future snapshot; returns false when there is none. */
function stepStore(entry: Entry, direction: 'undo' | 'redo'): boolean {
  const before = entry.temporal.getState();
  const source = direction === 'undo' ? before.pastStates : before.futureStates;
  if (source.length === 0) return false;

  const target = source[source.length - 1];
  const current = entry.snapshot() as Snap;
  entry.backgroundTop = null;
  entry.backgroundStep = null;

  _busy = true;
  const wasTracking = before.isTracking;
  if (wasTracking) before.pause();
  try {
    entry.apply(target);
  } finally {
    if (wasTracking) entry.temporal.getState().resume();
    const after = entry.temporal.getState();
    entry.temporal.setState(
      direction === 'undo'
        ? { pastStates: after.pastStates.slice(0, -1), futureStates: [...after.futureStates, current] }
        : { futureStates: after.futureStates.slice(0, -1), pastStates: [...after.pastStates, current] },
    );
    _busy = false;
  }
  return true;
}

/**
 * Pause every tracking store until the next macrotask so the undo/redo itself
 * and the effects reacting to it (re-derived values) neither record a step nor
 * clear the redo stack.
 */
function suppressEchoes(): void {
  const paused: Entry[] = [];
  for (const entry of _stores.values()) {
    if (entry.gesture || !entry.temporal.getState().isTracking) continue;
    entry.temporal.getState().pause();
    entry.echoPaused = true;
    paused.push(entry);
  }
  setTimeout(() => {
    for (const entry of paused) {
      if (!entry.echoPaused) continue; // a gesture took ownership of the pause
      entry.echoPaused = false;
      entry.temporal.getState().resume();
    }
  }, 0);
}

function runStep(from: Step[], to: Step[], direction: 'undo' | 'redo'): void {
  if (from.length === 0) return;
  // Pause everything first: restoring one store can synchronously write others
  // (viewer sync, derived fields) — those writes must not be recorded.
  suppressEchoes();
  while (from.length > 0) {
    const step = from.pop()!;
    const ordered = direction === 'undo' ? [...step].reverse() : step;
    const applied: string[] = [];
    for (const id of ordered) {
      const entry = _stores.get(id);
      if (entry && stepStore(entry, direction)) applied.push(id);
    }
    if (applied.length > 0) {
      to.push(direction === 'undo' ? applied.reverse() : applied);
      return;
    }
    // Stale step (its store history was cleared or trimmed) — skip to the next.
  }
}

// ─── Modal override ──────────────────────────────────────────────────────────

/**
 * A transient mode with its own step history (e.g. placing polygon points while
 * drawing an area). While set, Ctrl+Z / Ctrl+Y and the toolbar act on it
 * instead of the store history.
 */
export interface UndoRedoOverride {
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

let _override: UndoRedoOverride | null = null;

/** Install (or clear with null) the modal undo/redo override. */
export function setUndoRedoOverride(override: UndoRedoOverride | null): void {
  _override = override;
  _notifyUndoRedo();
}

/** Re-read availability after the override's own history changed. */
export function notifyUndoRedoChanged(): void {
  _notifyUndoRedo();
}

// ─── Undo / Redo ─────────────────────────────────────────────────────────────

/** Undo the most recent user action (one step, possibly spanning several stores). */
export function globalUndo(): void {
  if (_override) {
    _override.undo();
    _notifyUndoRedo();
    return;
  }
  flushPendingGestures();
  closeOpenStep();
  runStep(_undoStack, _redoStack, 'undo');
  _notifyUndoRedo();
}

/** Redo the most recently undone action. */
export function globalRedo(): void {
  if (_override) {
    _override.redo();
    _notifyUndoRedo();
    return;
  }
  flushPendingGestures();
  closeOpenStep();
  runStep(_redoStack, _undoStack, 'redo');
  _notifyUndoRedo();
}

export const canUndo = (): boolean => (_override ? _override.canUndo() : _undoStack.length > 0);
export const canRedo = (): boolean => (_override ? _override.canRedo() : _redoStack.length > 0);

/**
 * Forget all undo/redo history (every store + global stacks). Call after a
 * project/model is opened or reset, so Ctrl+Z can never "undo the load".
 */
export function clearUndoHistory(): void {
  _busy = true;
  try {
    for (const entry of _stores.values()) {
      if (entry.gesture) {
        // Re-base an in-flight gesture on the freshly loaded state.
        entry.gesture.snapshot = entry.snapshot();
      }
      entry.backgroundTop = null;
      entry.backgroundStep = null;
      entry.temporal.getState().clear();
    }
  } finally {
    _busy = false;
  }
  closeOpenStep();
  _undoStack.length = 0;
  _redoStack.length = 0;
  _notifyUndoRedo();
  _clearedListeners.forEach((cb) => cb());
}

const _clearedListeners = new Set<() => void>();

/**
 * Called after clearUndoHistory(): nothing removed before this point can be
 * brought back by undo any more. Returns an unsubscribe fn.
 */
export function onUndoHistoryCleared(callback: () => void): () => void {
  _clearedListeners.add(callback);
  return () => _clearedListeners.delete(callback);
}

/**
 * Run `fn` without recording history in any store — for derived recomputations
 * and programmatic loads. Stores already paused (gesture / echo) are untouched.
 */
export function runWithoutUndo<T>(fn: () => T): T {
  const paused: Entry[] = [];
  for (const entry of _stores.values()) {
    const ts = entry.temporal.getState();
    if (!ts.isTracking) continue;
    ts.pause();
    paused.push(entry);
  }
  try {
    return fn();
  } finally {
    for (const entry of paused) entry.temporal.getState().resume();
  }
}

/**
 * Re-base a store's history after a write that is NOT an edit but a load of
 * pre-existing truth (e.g. hydrating an editor from saved data). `fn` is applied
 * to every past / future snapshot (and to an open gesture's snapshot), so the
 * loaded data is never undone and no step is created. Run the write itself
 * inside runWithoutUndo.
 */
export function rebaseUndoHistory<P>(storeId: string, fn: (snapshot: P) => P): void {
  const entry = _stores.get(storeId);
  if (!entry) return;
  const ts = entry.temporal.getState();
  _busy = true;
  try {
    entry.temporal.setState({
      pastStates: ts.pastStates.map((p) => fn(p as P) as Snap),
      futureStates: ts.futureStates.map((p) => fn(p as P) as Snap),
    });
  } finally {
    _busy = false;
  }
  // The coalescing marker pointed at the old top object — re-point it.
  if (entry.backgroundTop !== null) {
    const past = entry.temporal.getState().pastStates;
    entry.backgroundTop = past[past.length - 1] ?? null;
  }
  if (entry.gesture) entry.gesture.snapshot = fn(entry.gesture.snapshot as P);
}

/**
 * Run a programmatic LOAD (preferences, restored settings) without creating a
 * step, and re-base history so undo never reverts what was loaded: every
 * top-level snapshot field the load changed is written into all past / future
 * snapshots. Use for loads that overlay whole fields; for per-item loads use
 * rebaseUndoHistory with a precise patch.
 */
export function runAsLoad<T>(fn: () => T): T {
  const before = new Map<Entry, unknown>();
  for (const entry of _stores.values()) before.set(entry, entry.snapshot());
  const result = runWithoutUndo(fn);
  for (const [entry, prev] of before) {
    const next = entry.snapshot();
    if (!isPlainRecord(prev) || !isPlainRecord(next)) continue;
    const changed: Record<string, unknown> = {};
    let any = false;
    for (const key of Object.keys(next)) {
      if (!undoEquality(prev[key], next[key])) {
        changed[key] = next[key];
        any = true;
      }
    }
    if (any) {
      rebaseUndoHistory<Record<string, unknown>>(entry.id, (snap) =>
        isPlainRecord(snap) ? { ...snap, ...changed } : snap,
      );
    }
  }
  return result;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ─── Reactive subscription for UI (e.g. toolbar buttons) ─────────────────────

const _undoRedoListeners = new Set<() => void>();

// Stable cached snapshot — replaced only when values change.
let _undoRedoSnapshot = { canUndo: false, canRedo: false };

function _notifyUndoRedo(): void {
  const nextCanUndo = canUndo();
  const nextCanRedo = canRedo();
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

// ─── Gestures ────────────────────────────────────────────────────────────────

/**
 * Begin a batched gesture for one store (slider drag, text edit, a multi-click
 * flow such as Re-assign region). Snapshots the pre-gesture state and pauses
 * recording. Inside an interaction session this is a no-op (the session already
 * batches) unless `spanInteractions` is set, in which case the gesture takes the
 * store over and lives until commitStore(id) — across several interactions.
 * Always pair with commitStore(id); undo / redo also commit open gestures.
 */
export function pauseStore(storeId: string, options?: { spanInteractions?: boolean }): void {
  const entry = _stores.get(storeId);
  if (!entry) return;
  if (entry.gesture) {
    // Already inside a gesture / interaction: keep its earlier snapshot. A
    // gesture that must outlive the current interaction (a multi-click flow)
    // takes ownership so the interaction's end does not commit it.
    if (options?.spanInteractions) _sessionIds.delete(storeId);
    return;
  }
  const ts = entry.temporal.getState();
  // An echo-window pause is taken over by the gesture (the echo timer then
  // leaves it alone); the store resumes on commit.
  const wasTracking = ts.isTracking || entry.echoPaused;
  entry.echoPaused = false;
  entry.gesture = { snapshot: entry.snapshot(), wasTracking };
  if (ts.isTracking) ts.pause();
}

/**
 * Finish a batched gesture: push the pre-gesture snapshot as ONE step when the
 * state actually changed, then resume recording. No-op without a gesture.
 */
export function commitStore(storeId: string): void {
  const entry = _stores.get(storeId);
  if (!entry || !entry.gesture) return;
  const { snapshot, wasTracking } = entry.gesture;
  entry.gesture = null;

  if (!entry.equal(snapshot, entry.snapshot())) {
    _busy = true;
    try {
      entry.temporal.setState((ts) => {
        const past = [...ts.pastStates, snapshot as Snap];
        if (past.length > UNDO_HISTORY_LIMIT) past.shift();
        return { pastStates: past, futureStates: [] };
      });
    } finally {
      _busy = false;
    }
    logPush(storeId);
    entry.backgroundTop = null;
    entry.backgroundStep = null;
  }
  if (wasTracking) entry.temporal.getState().resume();
}

/** Commit every gesture still open (before undo/redo, so the edit is a step). */
function flushPendingGestures(): void {
  for (const entry of _stores.values()) {
    if (entry.gesture) commitStore(entry.id);
  }
  _sessionIds.clear();
}

// ─── Interaction sessions (all stores) ───────────────────────────────────────

let _sessionDepth = 0;
const _sessionIds = new Set<string>();

/** Start an interaction that should record as ONE step across all stores. */
export function beginUndoInteraction(): void {
  _sessionDepth++;
  if (_sessionDepth > 1) return;
  for (const entry of _stores.values()) {
    if (entry.gesture) continue;
    pauseStore(entry.id);
    _sessionIds.add(entry.id);
  }
}

/** End an interaction started with beginUndoInteraction(). */
export function endUndoInteraction(): void {
  if (_sessionDepth === 0) return;
  _sessionDepth--;
  if (_sessionDepth > 0) return;
  const ids = [..._sessionIds];
  _sessionIds.clear();
  for (const id of ids) commitStore(id);
}

const NON_TEXT_INPUT_TYPES = new Set([
  'checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'color', 'file', 'image', 'hidden',
]);

function isTextEntry(el: EventTarget | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable || el.tagName === 'TEXTAREA') return true;
  if (el.tagName === 'INPUT') return !NON_TEXT_INPUT_TYPES.has((el as HTMLInputElement).type);
  return false;
}

/**
 * Turn every user input into a single undo step.
 *
 * - pointerdown → pointerup (+ the click it produces): sliders, drags (DAW,
 *   3D gumball, orientation dials), resizes, button and menu clicks.
 * - keydown → keyup: keyboard shortcuts (Delete, Ctrl+D, arrow nudges — a held
 *   key repeating is one step).
 * - focusin → focusout on a text entry: the whole edit of a field.
 * - drop / change events: HTML drag-and-drop, file pickers, selects.
 *
 * Ends are deferred one macrotask so React onPointerUp / onClick / onBlur
 * handlers (which often commit the final value) and the effects they trigger
 * run inside the interaction. Anything recorded OUTSIDE an interaction is a
 * background write (see handleBackgroundPush).
 * Mount once (useUndoRedo). Returns a cleanup fn.
 */
export function installUndoInteractionTracking(): () => void {
  let pointerActive = false;
  let keyActive = false;
  let focusedField: HTMLElement | null = null;

  const deferEnd = () => setTimeout(endUndoInteraction, 0);
  const oneShot = () => {
    beginUndoInteraction();
    deferEnd();
  };

  const endPointer = () => {
    if (!pointerActive) return;
    pointerActive = false;
    deferEnd();
  };
  const onPointerDown = (e: PointerEvent) => {
    if (pointerActive || e.button !== 0) return;
    pointerActive = true;
    beginUndoInteraction();
  };
  const endKey = () => {
    if (!keyActive) return;
    keyActive = false;
    deferEnd();
  };
  const onKeyDown = () => {
    if (keyActive) return;
    keyActive = true;
    beginUndoInteraction();
  };
  const onFocusIn = (e: FocusEvent) => {
    if (focusedField || !isTextEntry(e.target)) return;
    focusedField = e.target;
    beginUndoInteraction();
  };
  const onFocusOut = (e: FocusEvent) => {
    if (!focusedField || e.target !== focusedField) return;
    focusedField = null;
    deferEnd();
  };
  const onWindowBlur = () => {
    endPointer();
    endKey();
  };

  window.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('pointerup', endPointer, true);
  window.addEventListener('pointercancel', endPointer, true);
  window.addEventListener('dragstart', endPointer, true);
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', endKey, true);
  window.addEventListener('drop', oneShot, true);
  window.addEventListener('change', oneShot, true);
  window.addEventListener('blur', onWindowBlur);
  document.addEventListener('focusin', onFocusIn, true);
  document.addEventListener('focusout', onFocusOut, true);

  // A field removed from the DOM while focused never fires focusout.
  const watchdog = setInterval(() => {
    if (focusedField && !focusedField.isConnected) {
      focusedField = null;
      endUndoInteraction();
    }
  }, 1000);

  return () => {
    window.removeEventListener('pointerdown', onPointerDown, true);
    window.removeEventListener('pointerup', endPointer, true);
    window.removeEventListener('pointercancel', endPointer, true);
    window.removeEventListener('dragstart', endPointer, true);
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('keyup', endKey, true);
    window.removeEventListener('drop', oneShot, true);
    window.removeEventListener('change', oneShot, true);
    window.removeEventListener('blur', onWindowBlur);
    document.removeEventListener('focusin', onFocusIn, true);
    document.removeEventListener('focusout', onFocusOut, true);
    clearInterval(watchdog);
    if (pointerActive) endUndoInteraction();
    if (keyActive) endUndoInteraction();
    if (focusedField) endUndoInteraction();
  };
}
