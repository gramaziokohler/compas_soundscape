import { describe, it, expect } from 'vitest';
import { parseTriggerRef, isParamExpression } from './trigger-ref';

const known = new Set(['Marcus_1', 'Lucas_1', 'coffee_cup_placement_1', 'footsteps_concrete_1', 'Anna_1']);

describe('parseTriggerRef', () => {
  it('resolves a bare single-occurrence entry id (the regression)', () => {
    expect(parseTriggerRef('after(Marcus_1)', known)).toEqual({ op: 'after', entryId: 'Marcus_1', iterIdx: 0 });
    expect(parseTriggerRef('alignEnd(Lucas_1)', known)).toEqual({ op: 'alignEnd', entryId: 'Lucas_1', iterIdx: 0 });
    expect(parseTriggerRef('after(coffee_cup_placement_1)', known)).toEqual({
      op: 'after', entryId: 'coffee_cup_placement_1', iterIdx: 0,
    });
  });

  it('peels a legacy trailing _N as the 1-based iteration', () => {
    expect(parseTriggerRef('after(footsteps_concrete_1_2)', known)).toEqual({
      op: 'after', entryId: 'footsteps_concrete_1', iterIdx: 1,
    });
    expect(parseTriggerRef('after(Anna_1_1)', known)).toEqual({ op: 'after', entryId: 'Anna_1', iterIdx: 0 });
  });

  it('accepts the canonical #N iteration form', () => {
    expect(parseTriggerRef('after(Anna_1#2)', known)).toEqual({ op: 'after', entryId: 'Anna_1', iterIdx: 1 });
    expect(parseTriggerRef('after(Marcus_1#1)', known)).toEqual({ op: 'after', entryId: 'Marcus_1', iterIdx: 0 });
  });

  it('returns null for unknown entries and non-param expressions', () => {
    expect(parseTriggerRef('after(Unknown_9)', known)).toBeNull();
    expect(parseTriggerRef('00:15', known)).toBeNull();
    expect(parseTriggerRef('', known)).toBeNull();
    expect(parseTriggerRef(null, known)).toBeNull();
  });

  it('isParamExpression distinguishes formulas from absolute timestamps', () => {
    expect(isParamExpression('after(Marcus_1)')).toBe(true);
    expect(isParamExpression('alignEnd(Lucas_1)')).toBe(true);
    expect(isParamExpression('00:15')).toBe(false);
    expect(isParamExpression('')).toBe(false);
  });
});
