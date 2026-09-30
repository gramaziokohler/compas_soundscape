import { describe, expect, it } from 'vitest';
import {
  createInsertionIndexMapper,
  createRemovalIndexMapper,
  remapIndexKeyedRecord,
  remapIndexSet,
  remapParentUsageIndex,
} from './cardIndexRemap';

describe('createRemovalIndexMapper', () => {
  it('shifts each index down by the number of removed indices below it', () => {
    const map = createRemovalIndexMapper([1, 3]);
    expect([0, 1, 2, 3, 4, 5].map(map)).toEqual([0, null, 1, null, 2, 3]);
  });
});

describe('createInsertionIndexMapper', () => {
  it('shifts indices at or after the insertion point up by one', () => {
    const map = createInsertionIndexMapper(2);
    expect([0, 1, 2, 3].map(map)).toEqual([0, 1, 3, 4]);
  });
});

describe('remapParentUsageIndex', () => {
  const map = createRemovalIndexMapper([1]);

  it('remaps usage indices', () => {
    expect(remapParentUsageIndex(2, map)).toBe(1);
    expect(remapParentUsageIndex(0, map)).toBe(0);
    expect(remapParentUsageIndex(1, map)).toBeUndefined();
    expect(remapParentUsageIndex(undefined, map)).toBeUndefined();
  });

  it('remaps the -(contextIndex + 1) audio-context namespace', () => {
    expect(remapParentUsageIndex(-3, map)).toBe(-2); // context 2 → 1
    expect(remapParentUsageIndex(-1, map)).toBe(-1); // context 0 stays
    expect(remapParentUsageIndex(-2, map)).toBeUndefined(); // context 1 removed
  });
});

describe('index-keyed collections', () => {
  const map = createRemovalIndexMapper([0]);

  it('re-keys sets and records, dropping removed keys', () => {
    expect([...remapIndexSet(new Set([0, 1, 2]), map)]).toEqual([0, 1]);
    expect(remapIndexKeyedRecord({ 0: 'a', 2: 'c' }, map, (v, i) => `${v}${i}`)).toEqual({ 1: 'c1' });
  });
});
