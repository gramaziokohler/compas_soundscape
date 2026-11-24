import { describe, it, expect } from 'vitest';
import { clipVariation, detuneRate, formatClipVariation, isVariedCategory } from './clip-variation';
import { applyFadeInOut } from './fade-envelope';
import { CLIP_VARIATION } from '@/utils/constants';

describe('clipVariation', () => {
  it('is stable for one occurrence and differs between occurrences', () => {
    const a = clipVariation('generated_tap_0', 3, 'sound_event', 'subtle');
    expect(clipVariation('generated_tap_0', 3, 'sound_event', 'subtle')).toEqual(a);
    const all = Array.from({ length: 8 }, (_, i) => clipVariation('generated_tap_0', i, 'sound event', 'subtle'));
    expect(new Set(all.map((v) => v.detuneCents)).size).toBeGreaterThan(4);
  });

  it('stays within the range of its mode', () => {
    for (let i = 0; i < 50; i++) {
      const subtle = clipVariation('s', i, 'sound_event', 'subtle');
      expect(Math.abs(subtle.detuneCents)).toBeLessThanOrEqual(CLIP_VARIATION.DETUNE_CENTS);
      expect(Math.abs(subtle.gainDb)).toBeLessThanOrEqual(CLIP_VARIATION.GAIN_DB);
      const strong = clipVariation('s', i, 'sound_event', 'strong');
      expect(Math.abs(strong.detuneCents)).toBeLessThanOrEqual(2 * CLIP_VARIATION.DETUNE_CENTS);
    }
    expect(clipVariation('s', 1, 'sound_event', 'off')).toEqual({ detuneCents: 0, gainDb: 0 });
  });

  it('never varies speech or background beds', () => {
    expect(isVariedCategory('speech')).toBe(false);
    expect(isVariedCategory('background sound')).toBe(false);
    expect(clipVariation('s', 2, 'speech', 'strong')).toEqual({ detuneCents: 0, gainDb: 0 });
    expect(clipVariation('s', 2, 'background', 'strong')).toEqual({ detuneCents: 0, gainDb: 0 });
  });

  it('lets a hand-set value win and a seed re-roll the automatic one', () => {
    expect(clipVariation('s', 0, 'sound_event', 'subtle', { detuneCents: -80, gainDb: 1.5 }))
      .toEqual({ detuneCents: -80, gainDb: 1.5 });
    const auto = clipVariation('s', 0, 'sound_event', 'subtle');
    const rerolled = clipVariation('s', 0, 'sound_event', 'subtle', { seed: 1 });
    expect(rerolled).not.toEqual(auto);
  });

  it('formats a label and converts detune to a playback rate', () => {
    expect(formatClipVariation({ detuneCents: 30, gainDb: -1.2 })).toBe('+30 ct · −1.2 dB');
    expect(formatClipVariation({ detuneCents: 0, gainDb: 0 })).toBe('');
    expect(detuneRate(1200)).toBeCloseTo(2);
  });
});

describe('applyFadeInOut with a variation', () => {
  function fakeContext() {
    const gains: { value: number; events: [string, number][] }[] = [];
    const ctx = {
      currentTime: 0,
      createGain: () => {
        const g = {
          value: 1,
          events: [] as [string, number][],
        };
        gains.push(g);
        return {
          gain: {
            set value(v: number) { g.value = v; },
            get value() { return g.value; },
            setValueAtTime: (v: number) => { g.events.push(['set', v]); },
            linearRampToValueAtTime: (v: number) => { g.events.push(['ramp', v]); },
          },
          connect: () => undefined,
        };
      },
    };
    return { ctx, gains };
  }

  it('detunes the source and scales the envelope plateau', () => {
    const { ctx, gains } = fakeContext();
    const source = { context: ctx, detune: { value: 0 }, buffer: { duration: 2 }, connect: () => undefined };
    const sink = {};
    // Test doubles for the Web Audio nodes (only the members applyFadeInOut touches).
    applyFadeInOut(source as unknown as AudioBufferSourceNode, sink as AudioNode, {
      fadeInMs: 10, fadeOutMs: 10, detuneCents: 50, gainDb: 6, durationSec: 1,
    });
    expect(source.detune.value).toBe(50);
    const peak = Math.max(...gains[0].events.map(([, v]) => v));
    expect(peak).toBeCloseTo(Math.pow(10, 6 / 20));
  });

  it('adds a level stage even without fades', () => {
    const { ctx, gains } = fakeContext();
    const source = { context: ctx, detune: { value: 0 }, buffer: { duration: 2 }, connect: () => undefined };
    applyFadeInOut(source as unknown as AudioBufferSourceNode, {} as AudioNode, { gainDb: -2 });
    expect(gains).toHaveLength(1);
    expect(gains[0].value).toBeCloseTo(Math.pow(10, -2 / 20));
  });
});
