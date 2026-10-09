import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';
import { temporal } from 'zundo';
import {
  UNDO_HISTORY_LIMIT,
  beginUndoInteraction,
  canRedo,
  canUndo,
  clearUndoHistory,
  commitStore,
  endUndoInteraction,
  globalRedo,
  globalUndo,
  pauseStore,
  rebaseUndoHistory,
  registerTemporalStore,
  runAsLoad,
  runWithoutUndo,
  undoEquality,
} from './undoRedoRegistry';

// ─── Test stores ─────────────────────────────────────────────────────────────

interface ItemsState {
  items: Array<{ id: string; name: string; progress: number }>;
  progressFlag: number;
  setItems: (items: ItemsState['items']) => void;
}

const itemsPartialize = (s: ItemsState) => ({ items: s.items });
type ItemsSnap = ReturnType<typeof itemsPartialize>;
// `progress` is runtime: ignored by equality and kept live on apply.
const project = (snap: ItemsSnap) => snap.items.map(({ progress: _p, ...rest }) => rest);
const itemsEquality = (a: ItemsSnap, b: ItemsSnap) => undoEquality(project(a), project(b));

const useItems = create<ItemsState>()(
  temporal(
    (set) => ({
      items: [],
      progressFlag: 0,
      setItems: (items) => set({ items }),
    }),
    { partialize: itemsPartialize, equality: itemsEquality, limit: UNDO_HISTORY_LIMIT },
  ),
);

registerTemporalStore('test-items', useItems, {
  partialize: itemsPartialize,
  equality: itemsEquality,
  apply: (snap) => {
    const live = new Map(useItems.getState().items.map((i) => [i.id, i]));
    useItems.setState({
      items: snap.items.map((i) => ({ ...i, progress: live.get(i.id)?.progress ?? i.progress })),
    });
  },
});

interface CounterState {
  count: number;
  label: string;
}
const counterPartialize = (s: CounterState) => ({ count: s.count, label: s.label });
const useCounter = create<CounterState>()(
  temporal(() => ({ count: 0, label: 'a' }), {
    partialize: counterPartialize,
    equality: undoEquality,
    limit: UNDO_HISTORY_LIMIT,
  }),
);
registerTemporalStore('test-counter', useCounter, { partialize: counterPartialize });

/** A user interaction (what a click / key press / field edit becomes). */
function interact(fn: () => void) {
  beginUndoInteraction();
  fn();
  endUndoInteraction();
}

beforeEach(() => {
  vi.useFakeTimers();
  useItems.setState({ items: [], progressFlag: 0 });
  useCounter.setState({ count: 0, label: 'a' });
  clearUndoHistory();
  vi.runAllTimers();
});

afterEach(() => {
  vi.runAllTimers();
  vi.useRealTimers();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('undoEquality', () => {
  it('compares maps, sets, arrays and plain objects structurally', () => {
    expect(undoEquality(new Map([['a', [1, 2]]]), new Map([['a', [1, 2]]]))).toBe(true);
    expect(undoEquality(new Set(['a']), new Set(['b']))).toBe(false);
    expect(undoEquality({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(undoEquality([{ x: 1 }], [{ x: 2 }])).toBe(false);
  });

  it('compares non-plain objects by reference', () => {
    class Buffer { constructor(public n: number) {} }
    const a = new Buffer(1);
    expect(undoEquality(a, a)).toBe(true);
    expect(undoEquality(a, new Buffer(1))).toBe(false);
  });
});

describe('global undo / redo', () => {
  it('ignores writes that do not change the snapshot', () => {
    useItems.setState({ progressFlag: 5 });
    expect(canUndo()).toBe(false);
  });

  it('records one step per interaction even across several writes and stores', () => {
    interact(() => {
      useCounter.setState({ count: 1 });
      useCounter.setState({ count: 2 });
      useItems.getState().setItems([{ id: 'x', name: 'X', progress: 0 }]);
    });
    vi.runAllTimers();
    expect(canUndo()).toBe(true);

    globalUndo();
    vi.runAllTimers();
    expect(useCounter.getState().count).toBe(0);
    expect(useItems.getState().items).toEqual([]);
    expect(canUndo()).toBe(false);

    globalRedo();
    vi.runAllTimers();
    expect(useCounter.getState().count).toBe(2);
    expect(useItems.getState().items).toHaveLength(1);
  });

  it('an interaction that changes nothing records nothing', () => {
    interact(() => {
      useCounter.setState({ count: 0 });
    });
    vi.runAllTimers();
    expect(canUndo()).toBe(false);
  });

  it('undoes interactions in reverse order across stores', () => {
    interact(() => useCounter.setState({ count: 1 }));
    vi.runAllTimers();
    interact(() => useItems.getState().setItems([{ id: 'x', name: 'X', progress: 0 }]));
    vi.runAllTimers();
    interact(() => useCounter.setState({ label: 'b' }));
    vi.runAllTimers();

    globalUndo();
    vi.runAllTimers();
    expect(useCounter.getState()).toMatchObject({ count: 1, label: 'a' });
    expect(useItems.getState().items).toHaveLength(1);
    globalUndo();
    vi.runAllTimers();
    expect(useItems.getState().items).toHaveLength(0);
    globalUndo();
    vi.runAllTimers();
    expect(useCounter.getState().count).toBe(0);
  });

  it('keeps runtime fields live when a snapshot is applied', () => {
    interact(() => useItems.getState().setItems([{ id: 'x', name: 'X', progress: 0 }]));
    vi.runAllTimers();
    interact(() => useItems.getState().setItems([{ id: 'x', name: 'Renamed', progress: 0 }]));
    vi.runAllTimers();
    // A job reports progress — runtime only, must not create a step.
    useItems.setState((s) => ({ items: s.items.map((i) => ({ ...i, progress: 80 })) }));
    vi.runAllTimers();

    globalUndo();
    vi.runAllTimers();
    expect(useItems.getState().items[0]).toEqual({ id: 'x', name: 'X', progress: 80 });
  });

  it('a new action clears the redo stack', () => {
    interact(() => useCounter.setState({ count: 1 }));
    vi.runAllTimers();
    globalUndo();
    vi.runAllTimers();
    expect(canRedo()).toBe(true);
    interact(() => useCounter.setState({ count: 7 }));
    vi.runAllTimers();
    expect(canRedo()).toBe(false);
  });
});

describe('background writes', () => {
  it('collapse consecutive writes into one step while it is the latest', () => {
    // Streamed results (no interaction around them).
    useCounter.setState({ count: 1 });
    useCounter.setState({ count: 2 });
    vi.advanceTimersByTime(500);
    useCounter.setState({ count: 3 });
    vi.runAllTimers();

    globalUndo();
    vi.runAllTimers();
    expect(useCounter.getState().count).toBe(0);
    expect(canUndo()).toBe(false);
  });

  it('start a new step after a user action', () => {
    useCounter.setState({ count: 1 });
    vi.runAllTimers();
    interact(() => useItems.getState().setItems([{ id: 'x', name: 'X', progress: 0 }]));
    vi.runAllTimers();
    useCounter.setState({ count: 2 });
    vi.runAllTimers();

    globalUndo();
    vi.runAllTimers();
    expect(useCounter.getState().count).toBe(1);
    expect(useItems.getState().items).toHaveLength(1);
  });

  it('effects reacting to an undo are not recorded and keep redo', () => {
    interact(() => useCounter.setState({ count: 1 }));
    vi.runAllTimers();
    globalUndo();
    // Echo write in the same macrotask (e.g. a React effect re-deriving state).
    useItems.getState().setItems([{ id: 'derived', name: 'D', progress: 0 }]);
    vi.runAllTimers();
    expect(canRedo()).toBe(true);
    globalRedo();
    vi.runAllTimers();
    expect(useCounter.getState().count).toBe(1);
  });
});

describe('gestures', () => {
  it('pause / commit records one step and nothing when unchanged', () => {
    pauseStore('test-counter');
    useCounter.setState({ count: 1 });
    useCounter.setState({ count: 2 });
    commitStore('test-counter');
    vi.runAllTimers();
    globalUndo();
    vi.runAllTimers();
    expect(useCounter.getState().count).toBe(0);
    expect(canUndo()).toBe(false);

    pauseStore('test-counter');
    commitStore('test-counter');
    vi.runAllTimers();
    expect(canUndo()).toBe(false);
  });

  it('a spanning gesture survives the interactions inside it', () => {
    interact(() => {
      pauseStore('test-counter', { spanInteractions: true });
      useCounter.setState({ count: 1 });
    });
    vi.runAllTimers();
    interact(() => useCounter.setState({ count: 2 }));
    vi.runAllTimers();
    expect(canUndo()).toBe(false);
    commitStore('test-counter');
    vi.runAllTimers();
    globalUndo();
    vi.runAllTimers();
    expect(useCounter.getState().count).toBe(0);
  });

  it('undo commits an open gesture first', () => {
    pauseStore('test-counter');
    useCounter.setState({ count: 3 });
    globalUndo();
    vi.runAllTimers();
    expect(useCounter.getState().count).toBe(0);
  });
});

describe('loads and clearing', () => {
  it('clearUndoHistory drops everything', () => {
    interact(() => useCounter.setState({ count: 1 }));
    vi.runAllTimers();
    clearUndoHistory();
    expect(canUndo()).toBe(false);
    globalUndo();
    expect(useCounter.getState().count).toBe(1);
  });

  it('runWithoutUndo records nothing', () => {
    runWithoutUndo(() => useCounter.setState({ count: 4 }));
    vi.runAllTimers();
    expect(canUndo()).toBe(false);
  });

  it('runAsLoad re-bases history so undo never reverts the load', () => {
    interact(() => useCounter.setState({ count: 1 }));
    vi.runAllTimers();
    runAsLoad(() => useCounter.setState({ label: 'loaded' }));
    globalUndo();
    vi.runAllTimers();
    expect(useCounter.getState()).toEqual(expect.objectContaining({ count: 0, label: 'loaded' }));
  });

  it('rebaseUndoHistory patches every snapshot', () => {
    interact(() => useItems.getState().setItems([{ id: 'x', name: 'X', progress: 0 }]));
    vi.runAllTimers();
    rebaseUndoHistory<ItemsSnap>('test-items', (snap) => ({
      items: [...snap.items, { id: 'loaded', name: 'L', progress: 0 }],
    }));
    globalUndo();
    vi.runAllTimers();
    expect(useItems.getState().items.map((i) => i.id)).toEqual(['loaded']);
  });

  it('an external temporal.clear() drops that store from global history', () => {
    interact(() => useCounter.setState({ count: 1 }));
    vi.runAllTimers();
    interact(() => useItems.getState().setItems([{ id: 'x', name: 'X', progress: 0 }]));
    vi.runAllTimers();
    useItems.temporal.getState().clear();
    globalUndo();
    vi.runAllTimers();
    expect(useCounter.getState().count).toBe(0);
    expect(useItems.getState().items).toHaveLength(1);
  });
});
