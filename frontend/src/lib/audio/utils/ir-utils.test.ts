import { describe, it, expect } from 'vitest';
import { ambisonicContentChannels, irChannelLabel } from './ir-utils';

/** Fake buffer: `active` channels carry a sample, the rest are silent. */
function fakeBuffer(channels: number, active: number): AudioBuffer {
  const data = Array.from({ length: channels }, (_, c) => {
    const d = new Float32Array(8);
    if (c < active) d[3] = 0.5;
    return d;
  });
  return { numberOfChannels: channels, length: 8, sampleRate: 48000, getChannelData: (c: number) => data[c] } as unknown as AudioBuffer;
}

describe('ambisonicContentChannels', () => {
  it('drops a silent third order (an SOA IR padded to 16)', () => {
    expect(ambisonicContentChannels(fakeBuffer(16, 9))).toBe(9);
  });

  it('keeps a full TOA / SOA IR', () => {
    expect(ambisonicContentChannels(fakeBuffer(16, 16))).toBe(16);
    expect(ambisonicContentChannels(fakeBuffer(16, 10))).toBe(16);
    expect(ambisonicContentChannels(fakeBuffer(9, 9))).toBe(9);
  });

  it('falls back to first order and leaves other counts alone', () => {
    expect(ambisonicContentChannels(fakeBuffer(16, 1))).toBe(4);
    expect(ambisonicContentChannels(fakeBuffer(4, 1))).toBe(4);
    expect(ambisonicContentChannels(fakeBuffer(2, 2))).toBe(2);
  });
});

describe('irChannelLabel', () => {
  it('names the ambisonic orders', () => {
    expect(irChannelLabel(9)).toBe('9-Channel (SOA)');
    expect(irChannelLabel(16)).toBe('16-Channel (TOA)');
    expect(irChannelLabel(4)).toBe('4-Channel (FOA)');
  });
});
