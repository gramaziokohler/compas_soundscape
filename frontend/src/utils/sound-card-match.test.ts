import { describe, it, expect } from 'vitest';
import { findCardIndexForSound, soundMatchesCard } from './sound-card-match';

const configs = [{ config_id: 'a' }, { config_id: 'b' }, {}];

describe('sound-card-match', () => {
  it('matches by config_id regardless of prompt_index', () => {
    expect(findCardIndexForSound({ config_id: 'b', prompt_index: 0 }, configs)).toBe(1);
    expect(soundMatchesCard({ config_id: 'b', prompt_index: 0 }, configs, 0)).toBe(false);
  });

  it('falls back to prompt_index (pending placeholders, legacy events)', () => {
    expect(findCardIndexForSound({ prompt_index: 1 }, configs)).toBe(1);
    expect(findCardIndexForSound({ prompt_index: 2 }, configs)).toBe(2);
  });

  it('decodes speech-line prompt indices (card * 10000 + line)', () => {
    expect(findCardIndexForSound({ prompt_index: 20003 }, configs)).toBe(2);
  });

  it('returns -1 when no card matches', () => {
    expect(findCardIndexForSound({ config_id: 'zzz', prompt_index: 9 }, configs)).toBe(-1);
  });
});
