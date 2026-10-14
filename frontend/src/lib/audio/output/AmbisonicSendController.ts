/**
 * AmbisonicSendController
 *
 * Owns the lifecycle of the multichannel ambisonic send for the orchestrator's
 * AudioContext, so AudioOrchestrator only forwards calls:
 *
 * - routes the send bus to its target:
 *   - `device`: pins the context to an output device (others keep the regular
 *     output) and switches the destination to (order+1)² discrete channels
 *     (or reports why not) — macOS DVS, BlackHole, any wide-enough device
 *   - `bridge`: streams to the local ASIO bridge over a localhost WebSocket —
 *     Windows DVS, whose WDM side only exposes stereo pairs to browsers
 * - swaps the binaural output for the send, and back (rebuilds the bus on an order change)
 * - follows the active mode's tap, the listener orientation and master volume
 * - disables a device send if the device stops exposing enough channels (`sinkchange`)
 *
 * Nothing here is OS-specific: sink selection, channel count, `sinkchange` and
 * AudioWorklet are feature-detected.
 */

import type {
  AmbisonicOrder,
  AmbisonicSendStatus,
  AmbisonicSendTap,
  AmbisonicSendTarget,
  Orientation,
} from '@/types/audio';
import { AMBISONIC_SEND } from '@/utils/constants';
import { isSinkSelectionSupported, setOutputDeviceOverride } from '../output-device';
import { ambisonicChannelCount } from '../utils/ambisonic-utils';
import { AmbisonicSendBus } from './AmbisonicSendBus';
import { BridgeSendTransport, type BridgeState } from './BridgeSendTransport';
import {
  InsufficientChannelsError,
  enableMultichannelDestination,
  restoreStereoDestination,
} from './destination-layout';

type StatusListener = (status: AmbisonicSendStatus) => void;

export class AmbisonicSendController {
  private bus: AmbisonicSendBus | null = null;
  private bridge: BridgeSendTransport | null = null;
  private bridgeState: BridgeState = { connected: false };
  /** Non-null exactly while the send is on. */
  private target: AmbisonicSendTarget | null = null;
  private order: AmbisonicOrder = AMBISONIC_SEND.DEFAULT_ORDER;
  private status: AmbisonicSendStatus;
  private listeners = new Set<StatusListener>();

  private volume = 1;
  private rotateWithListener: boolean = AMBISONIC_SEND.DEFAULT_ROTATE_WITH_LISTENER;
  private orientation: Orientation = { yaw: 0, pitch: 0, roll: 0 };

  // Serializes enable/disable so rapid toggles never interleave sink switches.
  private queue: Promise<unknown> = Promise.resolve();

  private readonly onSinkChange = () => {
    if (this.target?.kind !== 'device') return;
    const deviceChannels = this.context.destination.maxChannelCount;
    const required = ambisonicChannelCount(this.order);
    if (deviceChannels < required) {
      const { message } = new InsufficientChannelsError(deviceChannels, required);
      void this.setEnabled(false, null, this.order, message);
    }
  };

  /**
   * @param context - the orchestrator's AudioContext
   * @param binauralOutput - the node that normally feeds `context.destination`
   * @param getTap - the active mode's pre-decoder bus
   */
  constructor(
    private readonly context: AudioContext,
    private readonly binauralOutput: AudioNode,
    private readonly getTap: () => AmbisonicSendTap | null
  ) {
    this.status = {
      enabled: false,
      transport: 'device',
      order: this.order,
      deviceChannels: null,
      sinkSelectable: isSinkSelectionSupported(),
    };
    this.context.addEventListener?.('sinkchange', this.onSinkChange);
  }

  /**
   * Turn the send on (routing `order`'s (order+1)² channels to `target`) or off.
   * Calling it again while on with another target or order moves/rebuilds it.
   */
  setEnabled(
    enabled: boolean,
    target: AmbisonicSendTarget | null,
    order: AmbisonicOrder,
    error?: string
  ): Promise<AmbisonicSendStatus> {
    const run = () => (enabled && target ? this.enable(target, order) : this.disable(error));
    const next = this.queue.then(run, run);
    this.queue = next;
    return next;
  }

  /** Re-read the active mode's tap — call after every audio-graph rebuild. */
  refreshTap(): void {
<<<<<<< HEAD
    if (!this.target || !this.bus) return;
    const tap = this.getTap();
    this.bus.attach(tap);
    if (tap?.order !== this.status.sourceOrder) {
      this.publish({ ...this.status, sourceOrder: tap?.order });
    }
=======
    if (this.target) this.bus?.attach(this.getTap());
>>>>>>> 9145e6a (dvs update)
  }

  setOrientation(orientation: Orientation): void {
    this.orientation = orientation;
    this.bus?.setOrientation(orientation);
  }

  setRotateWithListener(enabled: boolean): void {
    this.rotateWithListener = enabled;
    this.bus?.setRotateWithListener(enabled);
  }

  setVolume(volume: number): void {
    this.volume = volume;
    this.bus?.setVolume(volume);
  }

  getStatus(): AmbisonicSendStatus {
    return this.status;
  }

  onStatus(listener: StatusListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    this.context.removeEventListener?.('sinkchange', this.onSinkChange);
    this.bridge?.dispose();
    this.bridge = null;
    this.bus?.dispose();
    this.bus = null;
    this.listeners.clear();
  }

  private async enable(target: AmbisonicSendTarget, order: AmbisonicOrder): Promise<AmbisonicSendStatus> {
    // Changing transport: undo the previous route (sink override / bridge) first.
    if (this.target && this.target.kind !== target.kind) {
      await this.teardown();
    }
    this.order = order;
    const channels = ambisonicChannelCount(order);
    const sinkSelectable = isSinkSelectionSupported();

    let deviceChannels: number | null = null;
    if (target.kind === 'device') {
      if (sinkSelectable) {
        await setOutputDeviceOverride(this.context, target.deviceId);
      }
      try {
        // maxChannelCount reflects the new sink only once setSinkId has resolved.
        deviceChannels = enableMultichannelDestination(this.context, channels);
      } catch (error) {
        if (!(error instanceof InsufficientChannelsError)) throw error;
        return this.disable(error.message, error.deviceChannels);
      }
    }

    // The bus width is fixed per instance: rebuild it when the order changes.
    if (this.bus && this.bus.getOrder() !== order) {
      this.bus.dispose();
      this.bus = null;
    }
    if (!this.bus) {
      this.bus = await AmbisonicSendBus.create(this.context, order);
    }
    this.bus.setRotateWithListener(this.rotateWithListener);
    this.bus.setOrientation(this.orientation);
    this.bus.setVolume(this.volume);

    let sink: AudioNode = this.context.destination;
    if (target.kind === 'bridge') {
      if (!this.bridge || !this.bridge.matches(target.url, channels)) {
        this.bridge?.dispose();
        this.bridgeState = { connected: false };
        this.bridge = await BridgeSendTransport.create(this.context, channels, target.url, (state) =>
          this.onBridgeState(state)
        );
        if (!this.bridge) return this.disable('AudioWorklet is not supported in this browser');
      }
      sink = this.bridge.input;
    } else if (this.bridge) {
      this.bridge.dispose();
      this.bridge = null;
    }

    if (!this.target) {
      // One sink per context: binaural stops while the send is on.
      try {
        this.binauralOutput.disconnect(this.context.destination);
      } catch {
        // Already disconnected
      }
    }
    this.bus.disconnect();
    this.bus.connect(sink);
    this.target = target;
<<<<<<< HEAD
    const tap = this.getTap();
    this.bus.attach(tap);

    console.log(`[AmbisonicSend] Enabled via ${target.kind}: order ${order}, ${channels} ch`);
    const status: AmbisonicSendStatus = {
      enabled: true,
      transport: target.kind,
      order,
      sourceOrder: tap?.order,
      deviceChannels,
      sinkSelectable,
    };
=======
    this.bus.attach(this.getTap());

    console.log(`[AmbisonicSend] Enabled via ${target.kind}: order ${order}, ${channels} ch`);
    const status: AmbisonicSendStatus = { enabled: true, transport: target.kind, order, deviceChannels, sinkSelectable };
>>>>>>> 9145e6a (dvs update)
    return this.publish(target.kind === 'bridge' ? this.withBridgeState(status) : status);
  }

  private async disable(error?: string, deviceChannels: number | null = null): Promise<AmbisonicSendStatus> {
    // Already off and nothing failed: keep the last status (and its error) visible.
    if (!this.target && error === undefined) return this.status;

    const transport = this.target?.kind ?? this.status.transport;
    await this.teardown();
    return this.publish({
      enabled: false,
      transport,
      order: this.order,
      deviceChannels,
      sinkSelectable: isSinkSelectionSupported(),
      error,
    });
  }

  /** Undo every route the send may have set up and restore binaural playback. */
  private async teardown(): Promise<void> {
    if (this.target) {
      this.bus?.attach(null);
      this.bus?.disconnect();
    }
    this.target = null;

    this.bridge?.dispose();
    this.bridge = null;

    restoreStereoDestination(this.context);
    try {
      this.binauralOutput.connect(this.context.destination);
    } catch {
      // Context closed
    }
    if (isSinkSelectionSupported()) {
      await setOutputDeviceOverride(this.context, null);
    }
  }

  /** Live bridge connection updates (the send stays on and keeps reconnecting). */
  private onBridgeState(state: BridgeState): void {
    this.bridgeState = state;
    if (this.target?.kind !== 'bridge') return;
    this.publish(this.withBridgeState(this.status));
  }

  private withBridgeState(status: AmbisonicSendStatus): AmbisonicSendStatus {
    const state = this.bridgeState;
    return {
      ...status,
      bridgeConnected: state.connected,
      bridgeDevice: state.device,
      deviceChannels: state.deviceChannels ?? null,
      error: state.error,
    };
  }

  private publish(status: AmbisonicSendStatus): AmbisonicSendStatus {
    this.status = status;
    this.listeners.forEach((listener) => listener(status));
    return status;
  }
}
