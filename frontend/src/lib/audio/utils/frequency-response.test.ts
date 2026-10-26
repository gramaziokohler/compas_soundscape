import { describe, expect, it } from 'vitest';
import { computeFrequencyResponse } from './frequency-response';

function fakeBuffer(channels: Float32Array[], sampleRate: number): AudioBuffer {
  return {
    sampleRate,
    numberOfChannels: channels.length,
    length: channels[0].length,
    duration: channels[0].length / sampleRate,
    getChannelData: (i: number) => channels[i],
  } as unknown as AudioBuffer;
}

describe('computeFrequencyResponse', () => {
  it('a unit impulse has a flat 0 dB response', () => {
    const ir = new Float32Array(8192);
    ir[0] = 1;
    const { channelsDb } = computeFrequencyResponse(fakeBuffer([ir], 48000));
    for (const db of channelsDb[0]) expect(Math.abs(db)).toBeLessThan(0.1);
  });

  it('a sine peaks near its frequency', () => {
    const sr = 48000;
    const sig = new Float32Array(sr);
    for (let i = 0; i < sig.length; i++) sig[i] = Math.sin((2 * Math.PI * 1000 * i) / sr);
    const { frequencies, channelsDb } = computeFrequencyResponse(fakeBuffer([sig], sr));
    const peak = channelsDb[0].indexOf(Math.max(...channelsDb[0]));
    expect(frequencies[peak]).toBeGreaterThan(900);
    expect(frequencies[peak]).toBeLessThan(1100);
  });
});
