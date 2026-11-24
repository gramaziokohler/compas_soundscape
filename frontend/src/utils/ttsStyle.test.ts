import { describe, expect, it } from 'vitest';
import { activeStylePresetLabels, applyStylePresetLabels, cleanStyle, splitStyle } from './ttsStyle';

describe('ttsStyle', () => {
  it('splits on commas and drops empties', () => {
    expect(splitStyle(' whispering, , slow ')).toEqual(['whispering', 'slow']);
    expect(splitStyle(undefined)).toEqual([]);
  });

  it('lights the chips whose value is a part of the style', () => {
    expect(activeStylePresetLabels('Whispering, like a secret, slow')).toEqual(['Whisper', 'Slow']);
    expect(activeStylePresetLabels('whispering softly')).toEqual([]);
  });

  it('adds and removes preset parts, keeping free text', () => {
    expect(applyStylePresetLabels('like a secret', ['Whisper'])).toBe('like a secret, whispering');
    expect(applyStylePresetLabels('whispering, like a secret', [])).toBe('like a secret');
    expect(applyStylePresetLabels('', ['Shout', 'Angry'])).toBe('shouting, angry');
  });

  it('cleans to one capped line, undefined when empty', () => {
    expect(cleanStyle('  a \n b ')).toBe('a b');
    expect(cleanStyle('   ')).toBeUndefined();
    expect(cleanStyle('x'.repeat(500))).toHaveLength(200);
  });
});
