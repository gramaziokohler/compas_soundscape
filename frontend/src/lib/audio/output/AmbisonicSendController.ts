/**
 * AmbisonicSendController
 *
 * Owns the lifecycle of the multichannel ambisonic send for the orchestrator's
 * AudioContext, so AudioOrchestrator only forwards calls:
 *
 * - pins the context to the send device (others keep the regular output)
 * - switches the destination to (order+1)² discrete channels (or reports why not)
 * - swaps the binaural output for the send bus, and back (rebuilds it on an order change)
 * - follows the active mode's tap, the listener orientation and master volume
 * - disables itself if the device stops exposing enough channels (`sinkchange`)
 *
 * Nothing here is OS-specific: sink selection, channel count and `sinkchange`
 * are feature-detected, so the same code runs on Windows and macOS.
 */

import type { AmbisonicOrder, AmbisonicSendStatus, AmbisonicSendTap, Orientation } from '@/types/audio';
import { AMBISONIC_SEND } from '@/utils/constants';
import { isSinkSelectionSupported, setOutputDeviceOverride } from '../output-device';
import { ambisonicChannelCount } from '../utils/ambisonic-utils';
import { AmbisonicSendBus } from './AmbisonicSendBus';
import {
  InsufficientChannelsError,
  enableMultichannelDestination,
  restoreStereoDestination,
} from './destination-layout';

type StatusListener = (status: AmbisonicSendStatus) => void;

export class AmbisonicSendController {
  private bus: AmbisonicSendBus | null = null;
  private enabled = false;
  private order: AmbisonicOrder = AMBISONIC_SEND.DEFAULT_ORDER;
  private status: AmbisonicSendStatus;
  private listeners = new Set<StatusListener>();

  private volume = 1;
  private rotateWithListener: boolean = AMBISONIC_SEND.DEFAULT_ROTATE_WITH_LISTENER;
  private orientation: Orientation = { yaw: 0, pitch: 0, roll: 0 };

  // Serializes enable/disable so rapid toggles never interleave sink switches.
  private queue: Promise<unknown> = Promise.resolve();

  private readonly onSinkChange = () => {
    if (!this.enabled) return;
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
      order: this.order,
      deviceChannels: null,
      sinkSelectable: isSinkSelectionSupported(),
    };
    this.context.addEventListener?.('sinkchange', this.onSinkChange);
  }

  /**
   * Turn the send on (routing `order`'s (order+1)² channels to `deviceId`) or
   * off. Calling it again while on with another device or order moves/rebuilds it.
   */
  setEnabled(
    enabled: boolean,
    deviceId: string | null,
    order: AmbisonicOrder,
    error?: string
  ): Promise<AmbisonicSendStatus> {
    const run = () =>
      enabled && deviceId !== null ? this.enable(deviceId, order) : this.disable(error);
    const next = this.queue.then(run, run);
    this.queue = next;
    return next;
  }

  /** Re-read the active mode's tap — call after every audio-graph rebuild. */
  refreshTap(): void {
    if (this.enabled) this.bus?.attach(this.getTap());
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
    this.bus?.dispose();
    this.bus = null;
    this.listeners.clear();
  }

  private async enable(deviceId: string, order: AmbisonicOrder): Promise<AmbisonicSendStatus> {
    this.order = order;
    const channels = ambisonicChannelCount(order);
    const sinkSelectable = isSinkSelectionSupported();
    if (sinkSelectable) {
      await setOutputDeviceOverride(this.context, deviceId);
    }

    let deviceChannels: number;
    try {
      // maxChannelCount reflects the new sink only once setSinkId has resolved.
      deviceChannels = enableMultichannelDestination(this.context, channels);
    } catch (error) {
      if (!(error instanceof InsufficientChannelsError)) throw error;
      return this.disable(error.message, error.deviceChannels);
    }

    // The bus width is fixed per instance: rebuild it when the order changes.
    if (this.bus && this.bus.getOrder() !== order) {
      this.bus.dispose();
      this.bus = null;
    }
    if (!this.bus) {
      this.bus = await AmbisonicSendBus.create(this.context, order);
      if (this.enabled) this.bus.connect(this.context.destination);
    }
    this.bus.setRotateWithListener(this.rotateWithListener);
    this.bus.setOrientation(this.orientation);
    this.bus.setVolume(this.volume);

    if (!this.enabled) {
      // The context has a single sink: binaural stops while the send is on.
      try {
        this.binauralOutput.disconnect(this.context.destination);
      } catch {
        // Already disconnected
      }
      this.bus.connect(this.context.destination);
      this.enabled = true;
    }
    this.bus.attach(this.getTap());

    console.log(`[AmbisonicSend] Enabled: order ${order}, ${channels} ch → device with ${deviceChannels} ch`);
    return this.publish({ enabled: true, order, deviceChannels, sinkSelectable });
  }

  private async disable(error?: string, deviceChannels: number | null = null): Promise<AmbisonicSendStatus> {
    // Already off and nothing failed: keep the last status (and its error) visible.
    if (!this.enabled && error === undefined) return this.status;

    if (this.enabled) {
      this.bus?.attach(null);
      this.bus?.disconnect();
      this.enabled = false;
    }

    restoreStereoDestination(this.context);
    try {
      this.binauralOutput.connect(this.context.destination);
    } catch {
      // Context closed
    }

    const sinkSelectable = isSinkSelectionSupported();
    if (sinkSelectable) {
      await setOutputDeviceOverride(this.context, null);
    }

    return this.publish({ enabled: false, order: this.order, deviceChannels, sinkSelectable, error });
  }

  private publish(status: AmbisonicSendStatus): AmbisonicSendStatus {
    this.status = status;
    this.listeners.forEach((listener) => listener(status));
    return status;
  }
}
