import { describe, it, expect } from 'vitest';
import { solveOrchestrateSchedule, type SolverEntryInput } from './orchestrate-schedule';

/** The real last-generated scene (orchestrate_c576c667…), with plausible real durations. */
const C576: SolverEntryInput[] = [
  { entryId: 'hvac_hum_1', expressions: ['00:00'], delays: [0], variants: [1], variantDurations: [60] },
  { entryId: 'exterior_door_open_1', expressions: ['00:02'], delays: [0], variants: [1], variantDurations: [3] },
  {
    entryId: 'footsteps_concrete_1',
    expressions: ['00:18', 'after(coffee_cup_placement_1)', 'after(laptop_close_1)'],
    delays: [0, 0, 0], variants: [1, 1, 1], variantDurations: [3],
  },
  { entryId: 'coffee_cup_placement_1', expressions: ['after(Marcus_1)'], delays: [0], variants: [1], variantDurations: [1] },
  {
    entryId: 'conference_chair_movement_1',
    expressions: [
      'after(footsteps_concrete_1_2)',
      'after(conference_chair_movement_1_1)',
      'after(footsteps_concrete_1_3)',
    ],
    delays: [0, 0, 0], variants: [1, 1, 1], variantDurations: [3],
  },
  { entryId: 'laptop_shift_1', expressions: ['alignEnd(Lucas_1)'], delays: [0], variants: [1], variantDurations: [1] },
  { entryId: 'laptop_close_1', expressions: ['after(Anna_1_2)'], delays: [0], variants: [1], variantDurations: [2] },
  {
    entryId: 'Anna_1',
    expressions: ['after(conference_chair_movement_1_2)', 'after(Lucas_1)'],
    delays: [0, 0], variants: [1, 2], variantDurations: [7, 6],
  },
  { entryId: 'Lucas_1', expressions: ['after(Anna_1_1)'], delays: [0], variants: [1], variantDurations: [6] },
  { entryId: 'Marcus_1', expressions: ['after(footsteps_concrete_1_1)'], delays: [0], variants: [1], variantDurations: [1] },
];

describe('solveOrchestrateSchedule — real c576 scene', () => {
  const result = solveOrchestrateSchedule(C576);
  const ts = (id: string): (number | null)[] => result.byEntry[id].timestamps;

  it('resolves every slot with no broken links or cycles', () => {
    expect(result.brokenLinks).toEqual([]);
    expect(result.cycles).toEqual([]);
    for (const e of C576) {
      expect(result.byEntry[e.entryId].timestamps.every((t) => t !== null)).toBe(true);
    }
  });

  it('places the conversational chain back-to-back (no overlap)', () => {
    expect(ts('footsteps_concrete_1')).toEqual([18, 23, 53]);
    expect(ts('Marcus_1')).toEqual([21]);
    expect(ts('coffee_cup_placement_1')).toEqual([22]);
    expect(ts('conference_chair_movement_1')).toEqual([26, 29, 56]);
    expect(ts('Anna_1')).toEqual([32, 45]);
    expect(ts('Lucas_1')).toEqual([39]);
    expect(ts('laptop_close_1')).toEqual([51]);
  });

  it('alignEnd ends the pre-action exactly when the reference starts', () => {
    expect(ts('laptop_shift_1')).toEqual([38]); // Lucas starts 39, laptop_shift lasts 1s
  });
});

describe('solveOrchestrateSchedule — semantics', () => {
  it('after() starts exactly refEnd + delay', () => {
    const r = solveOrchestrateSchedule([
      { entryId: 'B', expressions: ['00:10'], delays: [0], variants: [1], variantDurations: [5] },
      { entryId: 'A', expressions: ['after(B)'], delays: [0.5], variants: [1], variantDurations: [2] },
    ]);
    expect(r.byEntry.A.timestamps).toEqual([15.5]);
    expect(r.brokenLinks).toEqual([]);
  });

  it('alignEnd() ends exactly delay before the reference starts (subtract)', () => {
    const r = solveOrchestrateSchedule([
      { entryId: 'B', expressions: ['00:10'], delays: [0], variants: [1], variantDurations: [5] },
      { entryId: 'A', expressions: ['alignEnd(B)'], delays: [2], variants: [1], variantDurations: [1] },
    ]);
    expect(r.byEntry.A.timestamps).toEqual([7]); // 10 − 1 − 2
  });

  it('deterministically breaks a cycle and reports it', () => {
    const r = solveOrchestrateSchedule([
      { entryId: 'A', expressions: ['after(B)'], delays: [0], variants: [1], variantDurations: [2], authoredTimestamps: ['00:30'] },
      { entryId: 'B', expressions: ['after(A)'], delays: [0], variants: [1], variantDurations: [2], authoredTimestamps: ['00:00'] },
    ]);
    expect(r.cycles.length).toBeGreaterThan(0);
    expect(r.brokenLinks.some((l) => l.includes('cycle'))).toBe(true);
    expect(r.byEntry.A.timestamps[0]).not.toBeNull();
    expect(r.byEntry.B.timestamps[0]).not.toBeNull();
  });
});
