/**
 * Real-time source directivity for the dry playback modes (anechoic, ShoeBox).
 *
 * The simulation engines bake a source's pattern into the impulse responses; the
 * 6-DoF modes have no IR, so the pattern is applied live, per source, along the
 * source→listener direction:
 *
 * - analytical (Cardioid family): one gain `p + (1 − p)·cos θ`, smoothed;
 * - measured balloon: a convolver with the impulse response of the nearest balloon
 *   direction (the same `.npz` the pyroomacoustics engine uses, served as a compact
 *   binary blob), swapped with a short crossfade between two convolvers when the
 *   direction crosses into another balloon cell.
 *
 * `SourceDirectivityStage` is a Web Audio sub-graph (`input` → `output`) that each
 * mode inserts into its per-source chain; `loadBalloon` caches balloons per id.
 */

import * as THREE from 'three';
import { apiService } from '@/services/api';
import { rotationMatrix } from '@/lib/three/orientation';
import { isOmniDirectivity } from '@/utils/positionKey';
import { DIRECTIVITY, DIRECTIVITY_REALTIME } from '@/utils/constants';
import type { SoundDirectivity } from '@/types/directivity';

// ── Balloons ───────────────────────────────────────────────────────────────

export interface DirectivityBalloon {
  id: string;
  n: number;
  taps: number;
  fs: number;
  /** (n, 3) unit vectors in the source frame (+x front, +y left, +z up). */
  directions: Float32Array;
  /** (n, taps) impulse responses at `fs`. */
  irs: Float32Array;
}

/** What a source needs at playback time for its pattern. */
export type RealtimeDirectivity =
  | { kind: 'analytical'; directivity: SoundDirectivity; p: number }
  | { kind: 'measured'; directivity: SoundDirectivity; balloon: DirectivityBalloon };

/** Parse the binary balloon of GET /api/directivities/{id}/balloon. */
export function parseBalloon(id: string, buffer: ArrayBuffer): DirectivityBalloon {
  const magic = String.fromCharCode(...new Uint8Array(buffer, 0, 4));
  if (magic !== DIRECTIVITY_REALTIME.BALLOON_MAGIC) throw new Error('Not a directivity balloon');
  const header = new DataView(buffer, 4, 12);
  const n = header.getUint32(0, true);
  const taps = header.getUint32(4, true);
  const fs = header.getUint32(8, true);
  const offset = DIRECTIVITY_REALTIME.BALLOON_HEADER_BYTES;
  const expected = offset + 4 * (n * 3 + n * taps);
  if (buffer.byteLength !== expected) throw new Error('Truncated directivity balloon');
  return {
    id,
    n,
    taps,
    fs,
    directions: new Float32Array(buffer, offset, n * 3),
    irs: new Float32Array(buffer, offset + 4 * n * 3, n * taps),
  };
}

const balloonCache = new Map<string, Promise<DirectivityBalloon | null>>();

/** Fetch (once) the balloon of a measured directivity id; null when it cannot be loaded. */
export function loadBalloon(id: string): Promise<DirectivityBalloon | null> {
  let pending = balloonCache.get(id);
  if (!pending) {
    pending = apiService
      .fetchDirectivityBalloon(id)
      .then((buffer) => parseBalloon(id, buffer))
      .catch((e) => {
        console.warn(`[source-directivity] balloon ${id} unavailable:`, e);
        balloonCache.delete(id);
        return null;
      });
    balloonCache.set(id, pending);
  }
  return pending;
}

/** Forget a cached balloon (deleted / re-imported entry). */
export function evictBalloon(id: string): void {
  balloonCache.delete(id);
}

export function analyticalP(id: string): number | undefined {
  return DIRECTIVITY.ANALYTICAL_PRESETS.find((preset) => preset.id === id)?.p;
}

/** Resolve a sound's directivity into what the stage needs (null = omnidirectional / unavailable). */
export async function resolveRealtimeDirectivity(directivity: SoundDirectivity | undefined): Promise<RealtimeDirectivity | null> {
  if (isOmniDirectivity(directivity) || !directivity) return null;
  const p = analyticalP(directivity.id);
  if (p !== undefined) return p >= 1 ? null : { kind: 'analytical', directivity, p };
  const balloon = await loadBalloon(directivity.id);
  return balloon ? { kind: 'measured', directivity, balloon } : null;
}

// ── Geometry ───────────────────────────────────────────────────────────────

/** Cardioid-family gain toward a direction at angle θ from the source axis. */
export function analyticalGain(p: number, cosTheta: number): number {
  return p + (1 - p) * cosTheta;
}

/** World direction → source-frame direction (inverse of the source rotation). */
export function worldToSourceFrame(direction: THREE.Vector3, directivity: SoundDirectivity): THREE.Vector3 {
  const inverse = rotationMatrix(directivity.yaw ?? 0, directivity.pitch ?? 0, directivity.roll ?? 0).transpose();
  return direction.clone().applyMatrix4(inverse).normalize();
}

/** Index of the balloon direction closest to a source-frame unit vector. */
export function nearestBalloonIndex(balloon: DirectivityBalloon, dir: THREE.Vector3): number {
  const d = balloon.directions;
  let best = 0;
  let bestDot = -Infinity;
  for (let i = 0; i < balloon.n; i++) {
    const dot = d[3 * i] * dir.x + d[3 * i + 1] * dir.y + d[3 * i + 2] * dir.z;
    if (dot > bestDot) {
      bestDot = dot;
      best = i;
    }
  }
  return best;
}

/** Linear resampling of a short impulse response (balloons are a few hundred taps). */
export function resampleLinear(src: Float32Array, fsIn: number, fsOut: number): Float32Array {
  if (fsIn === fsOut) return src;
  const nOut = Math.max(1, Math.round((src.length * fsOut) / fsIn));
  const out = new Float32Array(nOut);
  const ratio = fsIn / fsOut;
  for (let i = 0; i < nOut; i++) {
    const x = i * ratio;
    const k = Math.floor(x);
    const t = x - k;
    const a = src[Math.min(k, src.length - 1)];
    const b = src[Math.min(k + 1, src.length - 1)];
    out[i] = a + (b - a) * t;
  }
  return out;
}

/** AudioBuffers of balloon directions, per AudioContext sample rate (built lazily). */
const bufferCache = new WeakMap<DirectivityBalloon, Map<string, AudioBuffer>>();

function directionBuffer(ctx: BaseAudioContext, balloon: DirectivityBalloon, index: number): AudioBuffer {
  let perBalloon = bufferCache.get(balloon);
  if (!perBalloon) {
    perBalloon = new Map();
    bufferCache.set(balloon, perBalloon);
  }
  const key = `${ctx.sampleRate}:${index}`;
  let buffer = perBalloon.get(key);
  if (!buffer) {
    const ir = balloon.irs.subarray(index * balloon.taps, (index + 1) * balloon.taps);
    const samples = resampleLinear(ir, balloon.fs, ctx.sampleRate);
    buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
    buffer.copyToChannel(new Float32Array(samples), 0);
    perBalloon.set(key, buffer);
  }
  return buffer;
}

// ── Web Audio stage ────────────────────────────────────────────────────────

type Vec3Like = { x: number; y: number; z: number };

/**
 * Per-source directivity sub-graph.
 *
 * ```
 * input ─┬─ direct ─────────────┬─ output
 *        ├─ convolver A ─ fadeA ┤
 *        └─ convolver B ─ fadeB ┘
 * ```
 * Bypass / analytical: `direct` carries the signal (analytical sets `output.gain`).
 * Measured: `direct` is silent and the active convolver carries it.
 */
export class SourceDirectivityStage {
  readonly input: GainNode;
  readonly output: GainNode;
  private readonly direct: GainNode;
  private readonly convolvers: [ConvolverNode, ConvolverNode];
  private readonly fades: [GainNode, GainNode];
  private active = 0;
  private currentIndex = -1;
  private resolved: RealtimeDirectivity | null = null;
  private bypass = false;
  private lastSource: Vec3Like | null = null;
  private lastListener: Vec3Like | null = null;

  constructor(private readonly ctx: BaseAudioContext) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.direct = ctx.createGain();
    const makeConvolver = () => {
      const node = ctx.createConvolver();
      node.normalize = false;
      return node;
    };
    this.convolvers = [makeConvolver(), makeConvolver()];
    this.fades = [ctx.createGain(), ctx.createGain()];
    this.fades[0].gain.value = 0;
    this.fades[1].gain.value = 0;
    this.input.connect(this.direct);
    this.direct.connect(this.output);
    for (let i = 0; i < 2; i++) {
      this.input.connect(this.convolvers[i]);
      this.convolvers[i].connect(this.fades[i]);
      this.fades[i].connect(this.output);
    }
  }

  /** The pattern to apply (null = omnidirectional); re-evaluates the last known geometry. */
  setResolved(resolved: RealtimeDirectivity | null): void {
    this.resolved = resolved;
    this.currentIndex = -1;
    this.applyRouting();
    this.reevaluate();
  }

  /** Global (non-spatial) sources ignore their pattern without losing it. */
  setBypass(bypass: boolean): void {
    if (this.bypass === bypass) return;
    this.bypass = bypass;
    this.currentIndex = -1;
    this.applyRouting();
    this.reevaluate();
  }

  /** Source / listener world positions (any {x, y, z}); cheap when nothing moved. */
  update(source: Vec3Like, listener: Vec3Like): void {
    const eps = DIRECTIVITY_REALTIME.MOVE_EPSILON_M;
    const same = (a: Vec3Like | null, b: Vec3Like) =>
      !!a && Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps && Math.abs(a.z - b.z) < eps;
    if (same(this.lastSource, source) && same(this.lastListener, listener)) return;
    this.lastSource = { x: source.x, y: source.y, z: source.z };
    this.lastListener = { x: listener.x, y: listener.y, z: listener.z };
    this.reevaluate();
  }

  dispose(): void {
    for (const node of [this.input, this.direct, this.output, ...this.convolvers, ...this.fades]) {
      try {
        node.disconnect();
      } catch {
        // already disconnected
      }
    }
  }

  private get effective(): RealtimeDirectivity | null {
    return this.bypass ? null : this.resolved;
  }

  private applyRouting(): void {
    const now = this.ctx.currentTime;
    const measured = this.effective?.kind === 'measured';
    this.direct.gain.setTargetAtTime(measured ? 0 : 1, now, DIRECTIVITY_REALTIME.GAIN_SMOOTHING_S);
    if (!measured) {
      this.fades[0].gain.setTargetAtTime(0, now, DIRECTIVITY_REALTIME.GAIN_SMOOTHING_S);
      this.fades[1].gain.setTargetAtTime(0, now, DIRECTIVITY_REALTIME.GAIN_SMOOTHING_S);
    }
    if (this.effective?.kind !== 'analytical') {
      this.output.gain.setTargetAtTime(1, now, DIRECTIVITY_REALTIME.GAIN_SMOOTHING_S);
    }
  }

  private reevaluate(): void {
    const resolved = this.effective;
    if (!resolved || !this.lastSource || !this.lastListener) return;
    const toListener = new THREE.Vector3(
      this.lastListener.x - this.lastSource.x,
      this.lastListener.y - this.lastSource.y,
      this.lastListener.z - this.lastSource.z,
    );
    // Coincident source and listener: treat as on-axis.
    const local = toListener.lengthSq() < 1e-12
      ? new THREE.Vector3(1, 0, 0)
      : worldToSourceFrame(toListener, resolved.directivity);
    const now = this.ctx.currentTime;
    if (resolved.kind === 'analytical') {
      this.output.gain.setTargetAtTime(analyticalGain(resolved.p, local.x), now, DIRECTIVITY_REALTIME.GAIN_SMOOTHING_S);
      return;
    }
    const index = nearestBalloonIndex(resolved.balloon, local);
    if (index === this.currentIndex) return;
    const idle = 1 - this.active;
    this.convolvers[idle].buffer = directionBuffer(this.ctx, resolved.balloon, index);
    const fadeIn = this.fades[idle].gain;
    const fadeOut = this.fades[this.active].gain;
    fadeIn.cancelScheduledValues(now);
    fadeOut.cancelScheduledValues(now);
    fadeIn.setValueAtTime(fadeIn.value, now);
    fadeOut.setValueAtTime(fadeOut.value, now);
    fadeIn.linearRampToValueAtTime(1, now + DIRECTIVITY_REALTIME.CROSSFADE_S);
    fadeOut.linearRampToValueAtTime(0, now + DIRECTIVITY_REALTIME.CROSSFADE_S);
    this.active = idle;
    this.currentIndex = index;
  }
}
