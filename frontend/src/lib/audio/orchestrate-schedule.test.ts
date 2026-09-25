import { describe, it, expect } from 'vitest';
import { solveOrchestrateSchedule, scheduleEntryKey, type SolverEntryInput } from './orchestrate-schedule';

const key = (scope: string, entryId: string) => scheduleEntryKey(scope, entryId);

function entry(partial: Partial<SolverEntryInput> & Pick<SolverEntryInput, 'entryId' | 'expressions'>): SolverEntryInput {
  return {
    orchestrateId: 's',
    delays: partial.expressions.map(() => 0),
    variants: partial.expressions.map(() => 1),
    variantDurations: [3],
    durationsKnown: true,
    ...partial,
  };
}

describe('solveOrchestrateSchedule — exact placement', () => {
  const result = solveOrchestrateSchedule([
    entry({ entryId: 'door', expressions: ['00:00'], variantDurations: [3] }),
    entry({ entryId: 'steps', expressions: ['after(door)'], delays: [0.2] }),
    entry({ entryId: 'chair', expressions: ['after(steps)'], variantDurations: [2] }),
    entry({ entryId: 'before', expressions: ['alignEnd(chair)'], variantDurations: [1] }),
    entry({ entryId: 'par', expressions: ['overlap(door)'], delays: [1], variantDurations: [5] }),
  ]);

  it('resolves every slot with no exclusions or cycles', () => {
    expect(result.deferred).toBe(false);
    expect(result.exclusions).toEqual([]);
    expect(result.cycles).toEqual([]);
  });

  it('places after/alignEnd/overlap exactly', () => {
    expect(result.byEntry[key('s', 'door')].timestamps).toEqual([0]);
    expect(result.byEntry[key('s', 'steps')].timestamps).toEqual([3.2]); // door end 3 + 0.2
    expect(result.byEntry[key('s', 'chair')].timestamps).toEqual([6.2]); // steps end 6.2
    expect(result.byEntry[key('s', 'before')].timestamps).toEqual([5.2]); // chair start 6.2 − 1
    expect(result.byEntry[key('s', 'par')].timestamps).toEqual([1]); // door start 0 + 1 (overlaps)
  });

  it('does not clamp delays (the LLM decides)', () => {
    const r = solveOrchestrateSchedule([
      entry({ entryId: 'a', expressions: ['00:00'], variantDurations: [3] }),
      entry({ entryId: 'b', expressions: ['after(a)'], delays: [17] }),
    ]);
    expect(r.byEntry[key('s', 'b')].timestamps).toEqual([20]);
  });
});

describe('solveOrchestrateSchedule — semantics', () => {
  it('alignEnd() subtracts the delay (ends before the reference)', () => {
    const r = solveOrchestrateSchedule([
      entry({ entryId: 'B', expressions: ['00:10'], variantDurations: [5] }),
      entry({ entryId: 'A', expressions: ['alignEnd(B)'], delays: [2], variantDurations: [1] }),
    ]);
    expect(r.byEntry[key('s', 'A')].timestamps).toEqual([7]); // 10 − 1 − 2
  });

  it('overlap() lets several children share an anchor (parallel)', () => {
    const r = solveOrchestrateSchedule([
      entry({ entryId: 'anchor', expressions: ['00:00'], variantDurations: [10] }),
      entry({ entryId: 'talk', expressions: ['overlap(anchor)'], delays: [2], variantDurations: [8] }),
      entry({ entryId: 'notes', expressions: ['overlap(anchor)'], delays: [3], variantDurations: [6] }),
    ]);
    expect(r.byEntry[key('s', 'talk')].timestamps).toEqual([2]);
    expect(r.byEntry[key('s', 'notes')].timestamps).toEqual([3]);
  });

  it('afterAll() joins on the latest predecessor end', () => {
    const r = solveOrchestrateSchedule([
      entry({ entryId: 'A', expressions: ['00:00'], variantDurations: [3] }),
      entry({ entryId: 'B', expressions: ['00:10'], variantDurations: [2] }),
      entry({ entryId: 'C', expressions: ['afterAll(A, B)'], delays: [1], variantDurations: [1] }),
    ]);
    expect(r.byEntry[key('s', 'C')].timestamps).toEqual([13]); // max(3, 12) + 1
  });
});

describe('solveOrchestrateSchedule — exclusions', () => {
  it('excludes only the iterations involved in a cycle and reports them', () => {
    const r = solveOrchestrateSchedule([
      entry({ entryId: 'A', expressions: ['after(B)'], variantDurations: [2] }),
      entry({ entryId: 'B', expressions: ['after(A)'], variantDurations: [2] }),
    ]);
    expect(r.cycles.length).toBeGreaterThan(0);
    expect(r.exclusions.length).toBeGreaterThan(0);
    expect(r.byEntry[key('s', 'A')].timestamps[0]).toBeNull();
    expect(r.byEntry[key('s', 'B')].timestamps[0]).toBeNull();
  });

  it('excludes an iteration whose reference is unknown, keeping the rest', () => {
    const r = solveOrchestrateSchedule([
      entry({ entryId: 'A', expressions: ['00:00', 'after(Unknown_1)'], variantDurations: [3] }),
    ]);
    expect(r.byEntry[key('s', 'A')].timestamps[0]).toBe(0);
    expect(r.byEntry[key('s', 'A')].excludedIndices).toEqual([1]);
  });

  it('reports a malformed non-empty expression instead of silently dropping it', () => {
    // The LLM sometimes emits the literal type word ("absolute") as an expression.
    const r = solveOrchestrateSchedule([
      entry({ entryId: 'A', expressions: ['absolute'], variantDurations: [3], durationsKnown: true }),
    ]);
    expect(r.byEntry[key('s', 'A')].excludedIndices).toContain(0);
    expect(r.brokenLinks.some((b) => b.includes('malformed'))).toBe(true);
    expect(r.exclusions.some((e) => e.iterationIndex === 0 && e.reason.includes('malformed'))).toBe(true);
  });

  it('excludes an iteration with no anchor and no manual timestamp', () => {
    const r = solveOrchestrateSchedule([
      entry({ entryId: 'A', expressions: [''] }),
    ]);
    expect(r.byEntry[key('s', 'A')].excludedIndices).toEqual([0]);
  });

  it('keeps an unanchored iteration that has a manual timestamp', () => {
    const r = solveOrchestrateSchedule([
      entry({ entryId: 'A', expressions: [''], manualTimestamps: [12] }),
    ]);
    expect(r.byEntry[key('s', 'A')].timestamps).toEqual([12]);
  });

  it('defers while a measured duration is missing', () => {
    const r = solveOrchestrateSchedule([
      entry({ entryId: 'B', expressions: ['00:10'], variantDurations: [5], durationsKnown: false }),
      entry({ entryId: 'A', expressions: ['after(B)'], durationsKnown: false }),
    ]);
    expect(r.deferred).toBe(true);
  });

  it('scopes references by orchestrateId (duplicate entry ids do not collide)', () => {
    const r = solveOrchestrateSchedule([
      entry({ orchestrateId: 's1', entryId: 'X', expressions: ['00:05'], variantDurations: [2] }),
      entry({ orchestrateId: 's2', entryId: 'X', expressions: ['00:50'], variantDurations: [2] }),
      entry({ orchestrateId: 's2', entryId: 'Y', expressions: ['after(X)'], variantDurations: [2] }),
    ]);
    expect(r.byEntry[key('s2', 'Y')].timestamps).toEqual([52]);
    expect(r.byEntry[key('s1', 'X')].timestamps).toEqual([5]);
  });
});

describe('solveOrchestrateSchedule — authored fallback', () => {
  it('breaks a cycle using the authored fallback instead of dropping the slots', () => {
    const r = solveOrchestrateSchedule([
      entry({ entryId: 'A', expressions: ['after(B)'], variantDurations: [3], manualTimestamps: [10] }),
      entry({ entryId: 'B', expressions: ['after(A)'], variantDurations: [3], manualTimestamps: [5] }),
    ]);
    expect(r.deferred).toBe(false);
    expect(r.exclusions).toEqual([]);
    expect(r.cycles.length).toBeGreaterThan(0);
    // The back-edge child is placed at its authored time; the dependent derives.
    const ts = [r.byEntry[key('s', 'A')].timestamps[0], r.byEntry[key('s', 'B')].timestamps[0]];
    expect(ts.every((t) => t !== null)).toBe(true);
    expect(ts).toContain(5);
    // Both endpoints of the cycle are placed from their authored times.
    expect(r.fallbacks.length).toBe(2);
  });

  it('places a slot whose parent duration is unknown using the authored time', () => {
    const r = solveOrchestrateSchedule([
      entry({ entryId: 'B', expressions: ['00:10'], variantDurations: [null], durationsKnown: false }),
      entry({ entryId: 'A', expressions: ['after(B)'], durationsKnown: true, manualTimestamps: [42] }),
    ]);
    expect(r.deferred).toBe(false);
    expect(r.byEntry[key('s', 'A')].timestamps).toEqual([42]);
    expect(r.fallbacks.length).toBe(1);
    expect(r.fallbacks[0].entryId).toBe('A');
  });

  it('uses the authored fallback for a malformed expression', () => {
    const r = solveOrchestrateSchedule([
      entry({ entryId: 'A', expressions: ['absolute'], variantDurations: [3], manualTimestamps: [36] }),
    ]);
    expect(r.byEntry[key('s', 'A')].timestamps).toEqual([36]);
    expect(r.byEntry[key('s', 'A')].excludedIndices).toEqual([]);
    expect(r.fallbacks.length).toBe(1);
  });

  it('still defers when neither a strict anchor nor a fallback exists', () => {
    const r = solveOrchestrateSchedule([
      entry({ entryId: 'B', expressions: ['00:10'], variantDurations: [null], durationsKnown: false }),
      entry({ entryId: 'A', expressions: ['after(B)'], durationsKnown: false }),
    ]);
    expect(r.deferred).toBe(true);
  });

  it('restores the authored dialogue sequence when the speech/foley graph is cyclic', () => {
    // Regression: the Lucas & Emma scene — a chair↔speech cycle made the solver
    // drop the whole dialogue, leaving both speakers unscheduled.
    const r = solveOrchestrateSchedule([
      entry({
        entryId: 'Lucas_1',
        expressions: ['after(Emma_1#1)', 'after(Emma_1#2)', 'after(Emma_1#3)'],
        delays: [0.2, 0.2, 0.2],
        variants: [1, 2, 3],
        variantDurations: [null],
        durationsKnown: false,
        manualTimestamps: [38, 43, 48],
      }),
      entry({
        entryId: 'Emma_1',
        expressions: ['after(chair_swivel_1#1)', 'after(Lucas_1#1)', 'after(Lucas_1#2)'],
        delays: [0.5, 0.2, 0.2],
        variants: [1, 2, 3],
        variantDurations: [null],
        durationsKnown: false,
        manualTimestamps: [36, 40, 46],
      }),
      entry({
        entryId: 'chair_swivel_1',
        expressions: ['alignEnd(Emma_1#1)', 'after(Lucas_1#3)'],
        delays: [1.0, 0.5],
        variants: [1, 1],
        variantDurations: [3, 3],
        durationsKnown: true,
        manualTimestamps: [35, 55],
      }),
    ]);

    expect(r.deferred).toBe(false);
    expect(r.exclusions).toEqual([]);
    expect(r.cycles.length).toBeGreaterThan(0);
    expect(r.byEntry[key('s', 'Lucas_1')].timestamps).toEqual([38, 43, 48]);
    expect(r.byEntry[key('s', 'Emma_1')].timestamps).toEqual([36, 40, 46]);
  });
});
