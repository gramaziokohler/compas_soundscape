import { describe, it, expect } from 'vitest';
import { parseTriggerRef, parseTriggerExpression, isParamExpression } from './trigger-ref';

const known = new Set(['Marcus_1', 'Lucas_1', 'coffee_cup_placement_1', 'footsteps_concrete_1', 'Anna_1', 'scene_1']);

const r = (entryId: string, iterIdx: number, op: 'after' | 'alignEnd' | 'overlap' = 'after') =>
  ({ op, entryId, iterIdx });

describe('parseTriggerExpression', () => {
  it('resolves a bare single-occurrence entry id (the regression)', () => {
    expect(parseTriggerExpression('after(Marcus_1)', known)).toEqual({ op: 'after', refs: [r('Marcus_1', 0)] });
    expect(parseTriggerExpression('alignEnd(Lucas_1)', known)).toEqual({ op: 'alignEnd', refs: [r('Lucas_1', 0, 'alignEnd')] });
  });

  it('peels a legacy trailing _N as the 1-based iteration', () => {
    expect(parseTriggerExpression('after(footsteps_concrete_1_2)', known)).toEqual({
      op: 'after', refs: [r('footsteps_concrete_1', 1)],
    });
  });

  it('accepts the canonical #N iteration form', () => {
    expect(parseTriggerExpression('after(Anna_1#2)', known)).toEqual({ op: 'after', refs: [r('Anna_1', 1)] });
  });

  it('parses overlap (parallel) and multi-reference joins', () => {
    expect(parseTriggerExpression('overlap(scene_1)', known)).toEqual({ op: 'overlap', refs: [r('scene_1', 0, 'overlap')] });
    expect(parseTriggerExpression('afterAll(Marcus_1, Anna_1#2)', known)).toEqual({
      op: 'after', refs: [r('Marcus_1', 0), r('Anna_1', 1)],
    });
    expect(parseTriggerExpression('overlapAll(Lucas_1, scene_1)', known)).toEqual({
      op: 'overlap', refs: [r('Lucas_1', 0, 'overlap'), r('scene_1', 0, 'overlap')],
    });
  });

  it('returns null for unknown entries and non-param expressions', () => {
    expect(parseTriggerExpression('after(Unknown_9)', known)).toBeNull();
    expect(parseTriggerExpression('after(Marcus_1, Unknown_2)', known)).toBeNull();
    expect(parseTriggerExpression('00:15', known)).toBeNull();
    expect(parseTriggerExpression('', known)).toBeNull();
  });

  it('parseTriggerRef returns the first reference', () => {
    expect(parseTriggerRef('afterAll(Marcus_1, Anna_1#2)', known)).toEqual(r('Marcus_1', 0));
    expect(parseTriggerRef('00:15', known)).toBeNull();
  });

  it('isParamExpression distinguishes formulas from absolute timestamps', () => {
    expect(isParamExpression('after(Marcus_1)')).toBe(true);
    expect(isParamExpression('overlap(scene_1)')).toBe(true);
    expect(isParamExpression('00:15')).toBe(false);
    expect(isParamExpression('')).toBe(false);
  });
});
