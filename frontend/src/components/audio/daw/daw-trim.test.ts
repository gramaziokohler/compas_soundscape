import { describe, it, expect } from 'vitest';
import { computeTrimEdit, startMsAfterTrimReset, type TrimEditInput } from './daw-trim';

const noSnap = (s: number) => s;

function edit(partial: Partial<TrimEditInput>) {
  return computeTrimEdit({
    edge: 'end',
    trim: { start: 0, end: 1 },
    sourceMs: 10_000,
    startMs: 5_000,
    deltaMs: 0,
    minDurationMs: 100,
    snapSec: noSnap,
    ...partial,
  });
}

describe('computeTrimEdit — right edge', () => {
  it('shortens the clip and keeps its start', () => {
    const r = edit({ edge: 'end', deltaMs: -4_000 });
    expect(r.startMs).toBe(5_000);
    expect(r.durationMs).toBe(6_000);
    expect(r.trim).toEqual({ start: 0, end: 0.6 });
  });

  it('cannot extend past the end of the source', () => {
    const r = edit({ edge: 'end', trim: { start: 0.2, end: 0.5 }, deltaMs: 60_000 });
    expect(r.trim.end).toBe(1);
    expect(r.durationMs).toBe(8_000);
  });

  it('respects the minimum length', () => {
    const r = edit({ edge: 'end', deltaMs: -20_000 });
    expect(r.durationMs).toBe(100);
    expect(r.trim.end).toBeCloseTo(0.01);
  });

  it('snaps the edge time', () => {
    const r = edit({ edge: 'end', deltaMs: -3_700, snapSec: (s) => Math.round(s) });
    expect(r.durationMs).toBe(6_000); // raw end 11.3s → 11s
  });
});

describe('computeTrimEdit — left edge', () => {
  it('moves the start with the trim so the audio stays anchored', () => {
    const r = edit({ edge: 'start', deltaMs: 2_000 });
    expect(r.startMs).toBe(7_000);
    expect(r.durationMs).toBe(8_000);
    expect(r.trim).toEqual({ start: 0.2, end: 1 });
    // The sample at source position 0.2 plays at the same time before/after.
    expect(r.startMs - r.trim.start * 10_000).toBe(5_000);
  });

  it('can be dragged back out to the first sample but not further', () => {
    const r = edit({ edge: 'start', trim: { start: 0.3, end: 1 }, deltaMs: -60_000 });
    expect(r.trim.start).toBe(0);
    expect(r.startMs).toBe(2_000);
  });

  it('never starts before t=0', () => {
    const r = edit({ edge: 'start', trim: { start: 0.8, end: 1 }, startMs: 1_000, deltaMs: -60_000 });
    expect(r.startMs).toBe(0);
    expect(r.trim.start).toBeCloseTo(0.7);
  });

  it('respects the minimum length', () => {
    const r = edit({ edge: 'start', deltaMs: 20_000 });
    expect(r.durationMs).toBe(100);
    expect(r.startMs).toBe(14_900);
  });
});

describe('startMsAfterTrimReset', () => {
  it('moves the start back so the audio stays put', () => {
    expect(startMsAfterTrimReset(7_000, { start: 0.2, end: 1 }, undefined, 10_000)).toBe(5_000);
    expect(startMsAfterTrimReset(7_000, { start: 0.2, end: 1 }, { start: 0.1, end: 1 }, 10_000)).toBe(6_000);
    expect(startMsAfterTrimReset(500, { start: 0.2, end: 1 }, undefined, 10_000)).toBe(0);
  });
});
