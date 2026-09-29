/**
 * Foley FX granular pitch shifter.
 *
 * A direction-aware delay-line shifter: each of two read taps walks the delay
 * line at `1 - ratio` samples/sample and is Hann-windowed so the wrap-around
 * discontinuity is muted. The two taps are half a grain apart and their Hann
 * windows sum to 1, so the output is continuous and shifts up *or* down
 * depending on the sign of `semitones` (the old node graph applied both).
 *
 * Param contract mirrored in frontend/src/lib/audio/fx/fx-graph.ts (`createPitch`).
 */
class FxPitchProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'semitones', defaultValue: 0, minValue: -24, maxValue: 24, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.sr = sampleRate;
    this.grain = Math.max(64, Math.floor(0.06 * this.sr));
    this.bufLen = this.grain + Math.ceil(0.25 * this.sr);
    this.bufs = [];
    this.delays = [];
    this.write = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input.length || !output || !output.length) return true;

    const channels = Math.min(input.length, output.length);
    const n = output[0].length;
    const semitones = parameters.semitones[0];

    this.ensureBuffers(channels);

    if (Math.abs(semitones) < 0.01) {
      for (let c = 0; c < channels; c++) output[c].set(input[c]);
      this.writeThrough(input, channels, n);
      return true;
    }

    const ratio = Math.pow(2, semitones / 12);
    const delta = 1 - ratio; // delay change per sample (sign picks up vs down)
    const half = this.grain * 0.5;
    const twoPiOverGrain = (2 * Math.PI) / this.grain;
    const len = this.bufLen;

    for (let i = 0; i < n; i++) {
      for (let c = 0; c < channels; c++) this.bufs[c][this.write] = input[c][i];

      for (let c = 0; c < channels; c++) {
        let D = this.delays[c] + delta;
        if (!Number.isFinite(D)) D = half;
        if (D >= this.grain) D -= this.grain;
        else if (D < 0) D += this.grain;
        this.delays[c] = D;

        const w1 = 0.5 - 0.5 * Math.cos(D * twoPiOverGrain);
        let D2 = D + half;
        if (D2 >= this.grain) D2 -= this.grain;
        const w2 = 0.5 - 0.5 * Math.cos(D2 * twoPiOverGrain);

        const s1 = readInterp(this.bufs[c], this.write - D, len);
        const s2 = readInterp(this.bufs[c], this.write - D2, len);
        output[c][i] = s1 * w1 + s2 * w2;
      }

      this.write = (this.write + 1) % len;
    }
    return true;
  }

  ensureBuffers(channels) {
    if (this.bufs.length === channels && this.delays.length === channels) return;
    this.bufs = [];
    this.delays = [];
    for (let c = 0; c < channels; c++) {
      this.bufs.push(new Float32Array(this.bufLen));
      this.delays.push(this.grain * 0.5);
    }
    this.write = 0;
  }

  writeThrough(input, channels, n) {
    const len = this.bufLen;
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < channels; c++) this.bufs[c][this.write] = input[c][i];
      this.write = (this.write + 1) % len;
    }
  }
}

function readInterp(buf, pos, len) {
  let p = pos % len;
  if (p < 0) p += len;
  const i0 = Math.floor(p);
  const frac = p - i0;
  const i1 = (i0 + 1) % len;
  return buf[i0] * (1 - frac) + buf[i1] * frac;
}

registerProcessor('fx-pitch-processor', FxPitchProcessor);
