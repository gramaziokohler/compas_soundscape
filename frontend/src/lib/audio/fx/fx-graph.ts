/**
 * Shared Foley FX graph builder.
 *
 * One graph, two contexts: live AudioContext (preview) and OfflineAudioContext
 * (bounce). Bypass is a send/dry gain ramp, never a reconnect. Structural
 * changes (add / remove / reorder) rebuild the inner chain while fxInput /
 * fxOutput stay identity-stable so a playing BufferSource is not interrupted.
 */

import { SOUND_FX } from '@/utils/constants';
import { hardClipCurve, tanhCurve } from './fx-curves';
import { type FxChain, type FxInstance, type FxParams } from './fx-types';
import { ensureFxWorklet, FX_PITCH_PROCESSOR, FX_WORKLET_PROCESSOR } from './fx-worklet-loader';

type Startable = OscillatorNode | ConstantSourceNode;

export interface BuiltFxInstance {
  instanceId: string;
  type: FxInstance['type'];
  input: GainNode;
  output: GainNode;
  dryGain: GainNode;
  sendGain: GainNode;
  applyParams: (params: FxParams) => void;
  startables: Startable[];
}

function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

function minDelaySec(ctx: BaseAudioContext): number {
  return SOUND_FX.MIN_DELAY_SAMPLES / ctx.sampleRate;
}

function rampParam(param: AudioParam, value: number, seconds: number, ctx: BaseAudioContext): void {
  if (seconds <= 0 || !('currentTime' in ctx) || ctx.constructor.name === 'OfflineAudioContext') {
    param.value = value;
    return;
  }
  const now = ctx.currentTime;
  try {
    param.cancelAndHoldAtTime(now);
  } catch {
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
  }
  param.linearRampToValueAtTime(value, now + seconds);
}

function setBypassGains(built: BuiltFxInstance, enabled: boolean, ctx: BaseAudioContext, rampSec: number): void {
  rampParam(built.sendGain.gain, enabled ? 1 : 0, rampSec, ctx);
  rampParam(built.dryGain.gain, enabled ? 0 : 1, rampSec, ctx);
}

interface EffectPorts {
  input: AudioNode;
  output: AudioNode;
  applyParams: (params: FxParams) => void;
  startables: Startable[];
}

async function createEffect(ctx: BaseAudioContext, inst: FxInstance): Promise<EffectPorts> {
  switch (inst.type) {
    case 'eq':
      return createEq(ctx, inst.params);
    case 'clean':
      return createClean(ctx, inst.params);
    case 'gate':
      return createGate(ctx, inst.params);
    case 'saturation':
      return createDrive(ctx, 'sat', inst.params);
    case 'distortion':
      return createDrive(ctx, 'dist', inst.params);
    case 'compressor':
      return createCompressor(ctx, inst.params);
    case 'limiter':
      return createLimiter(ctx, inst.params);
    case 'delay':
      return createDelay(ctx, inst.params);
    case 'pitch':
      return createPitch(ctx, inst.params);
    case 'gain':
      return createGain(ctx, inst.params);
    case 'noiseReduction':
    case 'trimSilence':
    case 'stableAudioRestyle':
    case 'stableAudioInpaint':
    case 'stableAudioExtend':
      // Server-rendered stages: the live/offline graph passes audio through
      // unchanged. The real transform runs when the user presses Process in
      // the editor (see lib/audio/fx/stable-audio-render.ts and
      // lib/audio/fx/server-post-render.ts).
      return createPassthrough(ctx);
  }
}

function createPassthrough(ctx: BaseAudioContext): EffectPorts {
  const input = ctx.createGain();
  const output = ctx.createGain();
  input.connect(output);
  return { input, output, applyParams: () => {}, startables: [] };
}

function createEq(ctx: BaseAudioContext, params: Extract<FxInstance, { type: 'eq' }>['params']): EffectPorts {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const filters = params.bands.map(() => {
    const f = ctx.createBiquadFilter();
    return f;
  });

  const apply = (p: FxParams) => {
    if (!('bands' in p)) return;
    let prev: AudioNode = input;
    for (let i = 0; i < filters.length; i++) {
      const band = p.bands[i];
      const f = filters[i];
      if (!band || !f) continue;
      f.type = band.type;
      f.frequency.value = band.freq;
      f.Q.value = Math.max(0.0001, band.q);
      f.gain.value = band.enabled ? band.gain : 0;
      if (band.type === 'highpass' || band.type === 'lowpass') {
        // Bypass a cutoff filter by parking it at the Nyquist / DC edge.
        if (!band.enabled) {
          f.frequency.value = band.type === 'highpass' ? 10 : ctx.sampleRate * 0.49;
        }
      }
      prev.connect(f);
      prev = f;
    }
    prev.connect(output);
  };

  // Initial graph — applyParams reconnects, so disconnect first when updating.
  const reconnect = (p: FxParams) => {
    try { input.disconnect(); } catch { /* ignore */ }
    for (const f of filters) {
      try { f.disconnect(); } catch { /* ignore */ }
    }
    apply(p);
  };
  reconnect(params);

  return { input, output, applyParams: reconnect, startables: [] };
}

function createClean(ctx: BaseAudioContext, params: Extract<FxInstance, { type: 'clean' }>['params']): EffectPorts {
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.Q.value = 0.7;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 0.7;
  hp.connect(lp);
  const apply = (p: FxParams) => {
    if (!('highpassHz' in p) || !('lowpassHz' in p)) return;
    hp.frequency.value = Math.max(10, Math.min(ctx.sampleRate * 0.49, p.highpassHz));
    lp.frequency.value = Math.max(10, Math.min(ctx.sampleRate * 0.49, p.lowpassHz));
  };
  apply(params);
  return { input: hp, output: lp, applyParams: apply, startables: [] };
}

async function createGate(
  ctx: BaseAudioContext,
  params: Extract<FxInstance, { type: 'gate' }>['params'],
): Promise<EffectPorts> {
  const passthroughIn = ctx.createGain();
  const passthroughOut = ctx.createGain();
  passthroughIn.connect(passthroughOut);

  const ok = await ensureFxWorklet(ctx);
  if (!ok) {
    return { input: passthroughIn, output: passthroughOut, applyParams: () => undefined, startables: [] };
  }

  const node = new AudioWorkletNode(ctx, FX_WORKLET_PROCESSOR, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
  });

  const apply = (p: FxParams) => {
    if (!('thresholdDb' in p) || !('holdMs' in p)) return;
    const set = (name: string, value: number) => {
      const param = node.parameters.get(name);
      if (param) param.value = value;
    };
    set('threshold', p.thresholdDb);
    set('attack', p.attackMs / 1000);
    set('hold', p.holdMs / 1000);
    set('release', p.releaseMs / 1000);
  };
  apply(params);
  return { input: node, output: node, applyParams: apply, startables: [] };
}

function createDrive(
  ctx: BaseAudioContext,
  kind: 'sat' | 'dist',
  params: Extract<FxInstance, { type: 'saturation' | 'distortion' }>['params'],
): EffectPorts {
  const input = ctx.createGain();
  const shaper = ctx.createWaveShaper();
  shaper.oversample = '4x';
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  const wet = ctx.createGain();
  const dry = ctx.createGain();
  const output = ctx.createGain();

  input.connect(shaper);
  shaper.connect(tone);
  tone.connect(wet);
  wet.connect(output);
  input.connect(dry);
  dry.connect(output);

  const apply = (p: FxParams) => {
    if (!('drive' in p) || !('toneHz' in p) || !('mix' in p)) return;
    const curveSrc = kind === 'sat' ? tanhCurve(p.drive) : hardClipCurve(p.drive);
    const curve = new Float32Array(curveSrc.length);
    curve.set(curveSrc);
    shaper.curve = curve;
    tone.frequency.value = p.toneHz;
    wet.gain.value = p.mix;
    dry.gain.value = 1 - p.mix;
  };
  apply(params);
  return { input, output, applyParams: apply, startables: [] };
}

function createCompressor(ctx: BaseAudioContext, params: Extract<FxInstance, { type: 'compressor' }>['params']): EffectPorts {
  const comp = ctx.createDynamicsCompressor();
  const makeup = ctx.createGain();
  comp.connect(makeup);
  const apply = (p: FxParams) => {
    if (!('thresholdDb' in p) || !('makeupDb' in p)) return;
    comp.threshold.value = p.thresholdDb;
    comp.ratio.value = p.ratio;
    comp.attack.value = Math.max(0, p.attackMs / 1000);
    comp.release.value = Math.max(0.01, p.releaseMs / 1000);
    comp.knee.value = p.kneeDb;
    makeup.gain.value = dbToGain(p.makeupDb);
  };
  apply(params);
  return { input: comp, output: makeup, applyParams: apply, startables: [] };
}

function createLimiter(ctx: BaseAudioContext, params: Extract<FxInstance, { type: 'limiter' }>['params']): EffectPorts {
  const comp = ctx.createDynamicsCompressor();
  // A limiter is a compressor pinned to a brick-wall ratio with no knee and a
  // near-instant attack, so anything above the ceiling is pulled down.
  comp.ratio.value = 20;
  comp.knee.value = 0;
  comp.attack.value = 0;
  const apply = (p: FxParams) => {
    if (!('thresholdDb' in p)) return;
    comp.threshold.value = Math.max(-100, Math.min(0, p.thresholdDb));
    comp.release.value = Math.max(0.01, p.releaseMs / 1000);
  };
  apply(params);
  return { input: comp, output: comp, applyParams: apply, startables: [] };
}

function createDelay(ctx: BaseAudioContext, params: Extract<FxInstance, { type: 'delay' }>['params']): EffectPorts {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const delay = ctx.createDelay(1.5);
  const feedback = ctx.createGain();
  const damping = ctx.createBiquadFilter();
  damping.type = 'lowpass';
  const wet = ctx.createGain();
  const dry = ctx.createGain();

  input.connect(dry);
  dry.connect(output);
  input.connect(delay);
  delay.connect(damping);
  damping.connect(feedback);
  feedback.connect(delay);
  delay.connect(wet);
  wet.connect(output);

  const apply = (p: FxParams) => {
    if (!('timeMs' in p)) return;
    delay.delayTime.value = Math.max(minDelaySec(ctx), p.timeMs / 1000);
    feedback.gain.value = Math.max(0, Math.min(0.95, p.feedback));
    damping.frequency.value = p.dampingHz;
    wet.gain.value = p.mix;
    dry.gain.value = 1 - p.mix;
  };
  apply(params);
  return { input, output, applyParams: apply, startables: [] };
}

async function createPitch(
  ctx: BaseAudioContext,
  params: Extract<FxInstance, { type: 'pitch' }>['params'],
): Promise<EffectPorts> {
  const passthroughIn = ctx.createGain();
  const passthroughOut = ctx.createGain();
  passthroughIn.connect(passthroughOut);

  const ok = await ensureFxWorklet(ctx);
  if (!ok) {
    return { input: passthroughIn, output: passthroughOut, applyParams: () => undefined, startables: [] };
  }

  const node = new AudioWorkletNode(ctx, FX_PITCH_PROCESSOR, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
  });

  const apply = (p: FxParams) => {
    if (!('semitones' in p)) return;
    const param = node.parameters.get('semitones');
    if (param) param.value = Math.max(-24, Math.min(24, p.semitones));
  };
  apply(params);
  return { input: node, output: node, applyParams: apply, startables: [] };
}

function createGain(ctx: BaseAudioContext, params: Extract<FxInstance, { type: 'gain' }>['params']): EffectPorts {
  const g = ctx.createGain();
  const apply = (p: FxParams) => {
    if (!('gainDb' in p)) return;
    g.gain.value = dbToGain(p.gainDb);
  };
  apply(params);
  return { input: g, output: g, applyParams: apply, startables: [] };
}

export class FxGraph {
  readonly input: GainNode;
  readonly output: GainNode;
  private readonly ctx: BaseAudioContext;
  private readonly regionGain: GainNode;
  private readonly makeup: GainNode;
  private instances: BuiltFxInstance[] = [];
  private innerConnected: AudioNode[] = [];

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.regionGain = ctx.createGain();
    this.makeup = ctx.createGain();
    this.output = ctx.createGain();
    this.input.connect(this.regionGain);
    this.makeup.connect(this.output);
  }

  getBuilt(): BuiltFxInstance[] {
    return this.instances;
  }

  async buildChain(chain: FxChain): Promise<void> {
    this.disconnectInner();
    this.instances = [];

    let current: AudioNode = this.regionGain;
    for (const inst of chain.instances) {
      const built = await this.wrapInstance(inst);
      current.connect(built.input);
      this.innerConnected.push(current);
      current = built.output;
      this.instances.push(built);
    }
    current.connect(this.makeup);
    this.innerConnected.push(current);
    this.makeup.gain.value = dbToGain(chain.outputGainDb);
  }

  setInstanceBypass(instanceId: string, enabled: boolean, rampSec = SOUND_FX.BYPASS_RAMP_SEC): void {
    const built = this.instances.find((i) => i.instanceId === instanceId);
    if (!built) return;
    setBypassGains(built, enabled, this.ctx, rampSec);
  }

  updateInstanceParams(instanceId: string, params: FxParams): void {
    const built = this.instances.find((i) => i.instanceId === instanceId);
    built?.applyParams(params);
  }

  setOutputGainDb(db: number): void {
    this.makeup.gain.value = dbToGain(db);
  }

  dispose(): void {
    this.disconnectInner();
    try { this.input.disconnect(); } catch { /* ignore */ }
    try { this.output.disconnect(); } catch { /* ignore */ }
  }

  private async wrapInstance(inst: FxInstance): Promise<BuiltFxInstance> {
    const effect = await createEffect(this.ctx, inst);
    const input = this.ctx.createGain();
    const output = this.ctx.createGain();
    const dryGain = this.ctx.createGain();
    const sendGain = this.ctx.createGain();

    input.connect(dryGain);
    dryGain.connect(output);
    input.connect(sendGain);
    sendGain.connect(effect.input);
    effect.output.connect(output);

    for (const s of effect.startables) {
      try { s.start(0); } catch { /* already started */ }
    }

    const built: BuiltFxInstance = {
      instanceId: inst.instanceId,
      type: inst.type,
      input,
      output,
      dryGain,
      sendGain,
      applyParams: effect.applyParams,
      startables: effect.startables,
    };
    setBypassGains(built, inst.enabled, this.ctx, 0);
    return built;
  }

  private disconnectInner(): void {
    for (const inst of this.instances) {
      for (const s of inst.startables) {
        try { s.stop(); } catch { /* ignore */ }
        try { s.disconnect(); } catch { /* ignore */ }
      }
      try { inst.input.disconnect(); } catch { /* ignore */ }
      try { inst.output.disconnect(); } catch { /* ignore */ }
      try { inst.dryGain.disconnect(); } catch { /* ignore */ }
      try { inst.sendGain.disconnect(); } catch { /* ignore */ }
    }
    for (const n of this.innerConnected) {
      try { n.disconnect(); } catch { /* ignore */ }
    }
    try { this.regionGain.disconnect(); } catch { /* ignore */ }
    this.instances = [];
    this.innerConnected = [];
  }
}
