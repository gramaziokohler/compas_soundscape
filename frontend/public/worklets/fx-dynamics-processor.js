/**
 * Foley FX gate processor.
 *
 * Param contract is mirrored in frontend/src/lib/audio/fx/fx-graph.ts
 * (`createDynamics`) — keep them in sync.
 */
class FxGateProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._env = 0;
    this._holdLeft = 0;
    this._open = 0;
    this._gain = 1;
  }

  static get parameterDescriptors() {
    return [
      { name: 'threshold', defaultValue: -40, minValue: -80, maxValue: 0, automationRate: 'k-rate' },
      { name: 'attack', defaultValue: 0.002, minValue: 0.0001, maxValue: 0.2, automationRate: 'k-rate' },
      { name: 'hold', defaultValue: 0.04, minValue: 0, maxValue: 0.5, automationRate: 'k-rate' },
      { name: 'release', defaultValue: 0.08, minValue: 0.001, maxValue: 2, automationRate: 'k-rate' },
    ];
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input.length || !output || !output.length) return true;

    const thresholdDb = parameters.threshold[0];
    const attackSec = Math.max(1e-4, parameters.attack[0]);
    const releaseSec = Math.max(1e-3, parameters.release[0]);
    const holdSec = Math.max(0, parameters.hold[0]);

    const attackCoeff = Math.exp(-1 / (attackSec * sampleRate));
    const releaseCoeff = Math.exp(-1 / (releaseSec * sampleRate));
    const holdSamples = holdSec * sampleRate;
    const threshLin = Math.pow(10, thresholdDb / 20);
    const channels = Math.min(input.length, output.length);
    const frames = input[0].length;

    for (let i = 0; i < frames; i++) {
      let peak = 0;
      for (let c = 0; c < channels; c++) {
        const v = Math.abs(input[c][i]);
        if (v > peak) peak = v;
      }

      const coeff = peak > this._env ? attackCoeff : releaseCoeff;
      this._env = coeff * this._env + (1 - coeff) * peak;

      if (this._env >= threshLin) {
        this._open = 1;
        this._holdLeft = holdSamples;
      } else if (this._holdLeft > 0) {
        this._holdLeft -= 1;
      } else {
        this._open = 0;
      }

      const target = this._open ? 1 : 0;
      const gCoeff = target > this._gain ? attackCoeff : releaseCoeff;
      this._gain = gCoeff * this._gain + (1 - gCoeff) * target;

      for (let c = 0; c < channels; c++) {
        output[c][i] = input[c][i] * this._gain;
      }
    }

    return true;
  }
}

registerProcessor('fx-dynamics-processor', FxGateProcessor);
