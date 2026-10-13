/**
 * AmbisonicSendBus
 *
 * Fixed-order ACN/SN3D bus ((order+1)² channels — 16 for third order) that
 * carries the active mode's pre-decoder ambisonic signal to a multichannel
 * output device (Dante Virtual Soundcard → Holophonix / a DAW). Independent of
 * the binaural decoder. The order is fixed per instance; rebuild to change it.
 *
 *   tap ─▶ tapGain (crossfade) ─▶ HOARotator(order) ─▶ sum ─▶ outGain (master volume) ─▶ destination
 *
 * - Every node is (order+1)²-channel `explicit`/`discrete`: lower-order taps are
 *   zero-padded and higher-order taps truncated (valid for ACN/SN3D), so the
 *   downstream channel layout never changes.
 * - Each attached tap owns its own stage (gain + rotator), so two taps with
 *   different rotation frames can crossfade during a mode switch.
 * - Rotation per stage (R = listener rotation):
 *
 *   |                         | rotate with listener | world-fixed  |
 *   |-------------------------|----------------------|--------------|
 *   | preRotated = false      | R                    | identity     |
 *   | preRotated = true       | identity             | transpose(R) |
 *
 * Usage:
 * ```ts
 * const bus = await AmbisonicSendBus.create(ctx, 3);
 * bus.attach(mode.getAmbisonicSendTap());
 * bus.connect(ctx.destination);
 * ```
 */

import type { HOARotator } from 'omnitone/build/omnitone.esm.js';
import type { AmbisonicOrder, AmbisonicSendTap, Orientation } from '@/types/audio';
import { AMBISONIC_SEND } from '@/utils/constants';
import {
  ambisonicChannelCount,
  IDENTITY_MATRIX3,
  orientationToRotationMatrix3,
  transposeMatrix3,
} from '../utils/ambisonic-utils';

type CreateHOARotator = (context: BaseAudioContext, ambisonicOrder: number) => HOARotator;

interface TapStage {
  tap: AmbisonicSendTap;
  tapGain: GainNode;
  rotator: HOARotator;
}

/** Make a GainNode that passes `channels` discrete channels untouched. */
function createDiscreteGain(context: BaseAudioContext, channels: number, gain: number): GainNode {
  const node = context.createGain();
  node.channelCount = channels;
  node.channelCountMode = 'explicit';
  node.channelInterpretation = 'discrete';
  node.gain.value = gain;
  return node;
}

function isSameTap(a: AmbisonicSendTap, b: AmbisonicSendTap): boolean {
  return a.node === b.node && a.order === b.order && a.preRotated === b.preRotated;
}

export class AmbisonicSendBus {
  private readonly sum: GainNode;
  private readonly outGain: GainNode;

  /** Active stage is last; earlier entries are fading out. */
  private stages: TapStage[] = [];

  private orientation: Orientation = { yaw: 0, pitch: 0, roll: 0 };
  private rotateWithListener: boolean = AMBISONIC_SEND.DEFAULT_ROTATE_WITH_LISTENER;

  private readonly channels: number;

  private constructor(
    private readonly context: AudioContext,
    private readonly order: AmbisonicOrder,
    private readonly createRotator: CreateHOARotator
  ) {
    this.channels = ambisonicChannelCount(order);
    this.sum = createDiscreteGain(context, this.channels, 1);
    this.outGain = createDiscreteGain(context, this.channels, 1);
    this.sum.connect(this.outGain);
  }

  /** Load Omnitone lazily (it touches `window` at import time — SSR rule). */
  static async create(context: AudioContext, order: AmbisonicOrder): Promise<AmbisonicSendBus> {
    const OmnitoneModule = await import('omnitone/build/omnitone.esm.js');
    return new AmbisonicSendBus(context, order, OmnitoneModule.default.createHOARotator);
  }

  getOrder(): AmbisonicOrder {
    return this.order;
  }

  getChannelCount(): number {
    return this.channels;
  }

  /**
   * Route `tap` into the send, crossfading from the previous one. Passing the
   * tap that is already active is a no-op; `null` fades the send to silence.
   */
  attach(tap: AmbisonicSendTap | null): void {
    const active = this.stages[this.stages.length - 1];
    if (tap && active && isSameTap(active.tap, tap)) return;
    if (!tap && !active) return;

    const now = this.context.currentTime;
    const fadeEnd = now + AMBISONIC_SEND.TAP_CROSSFADE_SEC;

    for (const stage of this.stages) {
      stage.tapGain.gain.cancelScheduledValues(now);
      stage.tapGain.gain.setValueAtTime(stage.tapGain.gain.value, now);
      stage.tapGain.gain.linearRampToValueAtTime(0, fadeEnd);
    }
    const fading = [...this.stages];
    window.setTimeout(
      () => fading.forEach((stage) => this.disposeStage(stage)),
      AMBISONIC_SEND.TAP_CROSSFADE_SEC * 1000 + 50
    );

    if (tap) {
      const stage: TapStage = {
        tap,
        tapGain: createDiscreteGain(this.context, this.channels, 0),
        rotator: this.createRotator(this.context, this.order),
      };
      tap.node.connect(stage.tapGain);
      stage.tapGain.connect(stage.rotator.input);
      stage.rotator.output.connect(this.sum);
      this.applyRotation(stage);
      stage.tapGain.gain.setValueAtTime(0, now);
      stage.tapGain.gain.linearRampToValueAtTime(1, fadeEnd);
      this.stages.push(stage);
    }
  }

  /** Listener (camera) orientation — call every frame alongside the decoders. */
  setOrientation(orientation: Orientation): void {
    this.orientation = orientation;
    this.stages.forEach((stage) => this.applyRotation(stage));
  }

  setRotateWithListener(enabled: boolean): void {
    this.rotateWithListener = enabled;
    this.stages.forEach((stage) => this.applyRotation(stage));
  }

  getRotateWithListener(): boolean {
    return this.rotateWithListener;
  }

  /** Master volume (0..1), ramped to avoid zipper noise. */
  setVolume(volume: number): void {
    this.outGain.gain.setTargetAtTime(volume, this.context.currentTime, AMBISONIC_SEND.VOLUME_RAMP_SEC);
  }

  connect(destination: AudioNode): void {
    this.outGain.connect(destination);
  }

  disconnect(): void {
    try {
      this.outGain.disconnect();
    } catch {
      // Not connected
    }
  }

  dispose(): void {
    this.stages.forEach((stage) => this.disposeStage(stage));
    this.stages = [];
    this.disconnect();
    this.sum.disconnect();
  }

  private applyRotation(stage: TapStage): void {
    const listener = orientationToRotationMatrix3(this.orientation);
    let matrix: readonly number[];
    if (stage.tap.preRotated) {
      matrix = this.rotateWithListener ? IDENTITY_MATRIX3 : transposeMatrix3(listener);
    } else {
      matrix = this.rotateWithListener ? listener : IDENTITY_MATRIX3;
    }
    stage.rotator.setRotationMatrix3(matrix);
  }

  private disposeStage(stage: TapStage): void {
    this.stages = this.stages.filter((s) => s !== stage);
    try {
      // Only remove our own connection — the tap node still feeds its decoder.
      stage.tap.node.disconnect(stage.tapGain);
    } catch {
      // Tap node already torn down by its mode
    }
    stage.tapGain.disconnect();
    stage.rotator.output.disconnect();
  }
}
