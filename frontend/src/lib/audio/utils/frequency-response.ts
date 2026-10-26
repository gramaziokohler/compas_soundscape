/**
 * Frequency-response analysis of an impulse response.
 * Magnitude spectrum of each channel (zero-padded radix-2 FFT), fractional-octave
 * smoothed and resampled on a log-frequency axis for plotting.
 */

import { AUDIO_VISUALIZATION } from '@/utils/constants';

export interface FrequencyResponseData {
  /** Log-spaced frequencies (Hz) */
  frequencies: number[];
  /** Per channel: magnitude in dB (absolute, not normalised) per frequency */
  channelsDb: number[][];
  /** Number of channels in the source buffer (may exceed channelsDb.length) */
  totalChannels: number;
}

const DB_FLOOR = -200;

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/** In-place iterative radix-2 FFT. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

function channelResponseDb(samples: Float32Array, sampleRate: number, frequencies: number[]): number[] {
  const cfg = AUDIO_VISUALIZATION.FREQUENCY_RESPONSE;
  const len = Math.min(samples.length, cfg.MAX_FFT_SIZE);
  const size = nextPow2(Math.max(len, cfg.MIN_FFT_SIZE));
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let i = 0; i < len; i++) re[i] = samples[i];
  fft(re, im);

  const bins = size >> 1;
  const binHz = sampleRate / size;
  const mag = new Float64Array(bins + 1);
  // Prefix sums of power so each smoothing band is an O(1) average.
  const cumPower = new Float64Array(bins + 2);
  for (let k = 0; k <= bins; k++) {
    mag[k] = Math.hypot(re[k], im[k]);
    cumPower[k + 1] = cumPower[k] + mag[k] * mag[k];
  }

  const halfBand = Math.pow(2, cfg.SMOOTHING_OCTAVES / 2);
  return frequencies.map((f) => {
    const lo = Math.ceil(f / halfBand / binHz);
    const hi = Math.floor((f * halfBand) / binHz);
    let magnitude: number;
    if (hi >= lo && hi - lo >= 1) {
      const loC = Math.max(0, lo);
      const hiC = Math.min(bins, hi);
      magnitude = Math.sqrt((cumPower[hiC + 1] - cumPower[loC]) / (hiC - loC + 1));
    } else {
      // Band narrower than a bin (low frequencies): interpolate the spectrum.
      const pos = Math.min(bins, f / binHz);
      const k0 = Math.floor(pos);
      const k1 = Math.min(bins, k0 + 1);
      magnitude = mag[k0] + (mag[k1] - mag[k0]) * (pos - k0);
    }
    return magnitude > 0 ? Math.max(DB_FLOOR, 20 * Math.log10(magnitude)) : DB_FLOOR;
  });
}

export function computeFrequencyResponse(audioBuffer: AudioBuffer): FrequencyResponseData {
  const cfg = AUDIO_VISUALIZATION.FREQUENCY_RESPONSE;
  const maxHz = Math.min(cfg.MAX_HZ, audioBuffer.sampleRate / 2);
  const ratio = maxHz / cfg.MIN_HZ;
  const frequencies = Array.from(
    { length: cfg.POINTS },
    (_, i) => cfg.MIN_HZ * Math.pow(ratio, i / (cfg.POINTS - 1)),
  );

  const shown = Math.min(audioBuffer.numberOfChannels, cfg.MAX_CHANNELS);
  const channelsDb: number[][] = [];
  for (let ch = 0; ch < shown; ch++) {
    channelsDb.push(channelResponseDb(audioBuffer.getChannelData(ch), audioBuffer.sampleRate, frequencies));
  }
  return { frequencies, channelsDb, totalChannels: audioBuffer.numberOfChannels };
}

/** Format a frequency for axis labels (e.g. 125, 1k, 16k). */
export function formatFrequency(hz: number): string {
  if (hz >= 1000) {
    const k = hz / 1000;
    return `${Number.isInteger(k) ? k : k.toFixed(1)}k`;
  }
  return `${Math.round(hz)}`;
}
