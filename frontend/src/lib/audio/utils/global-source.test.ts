import { describe, it, expect } from 'vitest';
import { applyOmniToEncoder, isConfigGlobal, isGlobalSoundCategory, omniLevelGain, toOmniFilter } from './global-source';
import { GLOBAL_SOURCE } from '@/utils/constants';

/** Encoder stub: one gain node per ACN channel, as AmbisonicMonoEncoder exposes. */
function fakeEncoder(channels: number) {
  return { gainNodes: Array.from({ length: channels }, () => ({ gain: { value: 0.5 } }) as unknown as GainNode) };
}

/** Minimal AudioBuffer + context stand-ins (Node has no Web Audio). */
function fakeBuffer(channels: number, length: number, sampleRate = 48000): AudioBuffer {
  const data = Array.from({ length: channels }, () => new Float32Array(length));
  return {
    numberOfChannels: channels,
    length,
    sampleRate,
    getChannelData: (ch: number) => data[ch],
  } as unknown as AudioBuffer;
}
const fakeContext = {
  createBuffer: (channels: number, length: number, sampleRate: number) => fakeBuffer(channels, length, sampleRate),
} as unknown as BaseAudioContext;

describe('isGlobalSoundCategory', () => {
  it('matches every background spelling only', () => {
    expect(isGlobalSoundCategory('background')).toBe(true);
    expect(isGlobalSoundCategory('Background Sound')).toBe(true);
    expect(isGlobalSoundCategory('background_sound')).toBe(true);
    expect(isGlobalSoundCategory('sound_event')).toBe(false);
    expect(isGlobalSoundCategory('speech')).toBe(false);
    expect(isGlobalSoundCategory(undefined)).toBe(false);
  });
});

describe('isConfigGlobal', () => {
  it('defaults background cards to global and follows their own toggle', () => {
    expect(isConfigGlobal({ category: 'background' })).toBe(GLOBAL_SOURCE.DEFAULT_ENABLED);
    expect(isConfigGlobal({ category: 'background', global_playback: false })).toBe(false);
    expect(isConfigGlobal({ category: 'background', global_playback: true })).toBe(true);
  });

  it('never makes non-background cards global', () => {
    expect(isConfigGlobal({ category: 'sound_event', global_playback: true })).toBe(false);
    expect(isConfigGlobal({ global_playback: true })).toBe(false);
  });
});

describe('applyOmniToEncoder', () => {
  it('keeps only a level-matched W channel', () => {
    const encoder = fakeEncoder(16);
    applyOmniToEncoder(encoder, 3);
    expect(encoder.gainNodes[0].gain.value).toBe(GLOBAL_SOURCE.OMNI_LEVEL_GAIN[3]);
    for (let ch = 1; ch < 16; ch++) expect(encoder.gainNodes[ch].gain.value).toBe(0);
  });

  it('boosts W above unity at every order (omni decodes quieter than a point source)', () => {
    for (const order of [1, 2, 3] as const) expect(omniLevelGain(order)).toBeGreaterThan(1);
  });
});

describe('toOmniFilter', () => {
  it('scales W by the gain for the filter order and zeroes directional channels', () => {
    const ir = fakeBuffer(4, 3);
    for (let ch = 0; ch < 4; ch++) ir.getChannelData(ch).set([1, -0.5, 0.25]);

    const omni = toOmniFilter(fakeContext, ir);

    expect(omni.numberOfChannels).toBe(4);
    const g = GLOBAL_SOURCE.OMNI_LEVEL_GAIN[1];
    expect(Array.from(omni.getChannelData(0))).toEqual([1 * g, -0.5 * g, 0.25 * g].map(Math.fround));
    for (let ch = 1; ch < 4; ch++) expect(Array.from(omni.getChannelData(ch))).toEqual([0, 0, 0]);
    // The source IR is untouched.
    expect(ir.getChannelData(1)[0]).toBe(1);
  });

  it('picks the third-order gain for a 16-channel filter', () => {
    const ir = fakeBuffer(16, 1);
    ir.getChannelData(0)[0] = 1;
    expect(toOmniFilter(fakeContext, ir).getChannelData(0)[0]).toBeCloseTo(GLOBAL_SOURCE.OMNI_LEVEL_GAIN[3], 5);
  });
});
