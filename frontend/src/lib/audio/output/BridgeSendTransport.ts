/**
 * BridgeSendTransport
 *
 * Streams the ambisonic send to the local ASIO bridge
 * (`scripts/ambisonic_bridge/ambisonic_bridge.py`) over a localhost WebSocket.
 * Used where the browser cannot reach a wide enough audio device itself — on
 * Windows, Dante Virtual Soundcard only exposes stereo pairs to browsers (WDM),
 * while the bridge plays all channels through its ASIO driver.
 *
 *   send bus ─▶ AudioWorkletNode (ambisonic-capture-processor, 0 outputs)
 *            ─▶ Float32 interleaved chunks ─▶ WebSocket ─▶ bridge ─▶ ASIO
 *
 * The node has no outputs, so it is pulled by the engine without touching
 * the destination. The socket reconnects automatically while the transport
 * lives; state changes are reported through `onState`.
 *
 * Protocol: see the bridge's module docstring (hello → ready/stats/error).
 */

import { AMBISONIC_SEND } from '@/utils/constants';
import { ensureWorkletModules } from '../utils/worklet-loader';

export interface BridgeState {
  connected: boolean;
  /** ASIO device the bridge plays to, once it reported `ready`. */
  device?: string;
  deviceChannels?: number;
  error?: string;
}

interface BridgeMessage {
  type: 'ready' | 'stats' | 'error';
  device?: string;
  deviceChannels?: number;
  message?: string;
}

export class BridgeSendTransport {
  private socket: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private disposed = false;

  private constructor(
    private readonly node: AudioWorkletNode,
    private readonly url: string,
    private readonly channels: number,
    private readonly sampleRate: number,
    private readonly onState: (state: BridgeState) => void
  ) {
    this.node.port.onmessage = (event: MessageEvent<Float32Array>) => this.forward(event.data);
    this.connect();
  }

  /** @returns null when AudioWorklet is unavailable in this browser */
  static async create(
    context: AudioContext,
    channels: number,
    url: string,
    onState: (state: BridgeState) => void
  ): Promise<BridgeSendTransport | null> {
    const ok = await ensureWorkletModules(context, [AMBISONIC_SEND.BRIDGE.WORKLET_URL]);
    if (!ok) return null;
    const node = new AudioWorkletNode(context, AMBISONIC_SEND.BRIDGE.PROCESSOR_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: channels,
      channelCountMode: 'explicit',
      channelInterpretation: 'discrete',
      processorOptions: { channels, framesPerMessage: AMBISONIC_SEND.BRIDGE.FRAMES_PER_MESSAGE },
    });
    return new BridgeSendTransport(node, url, channels, context.sampleRate, onState);
  }

  /** Connect the send bus here (instead of the destination). */
  get input(): AudioNode {
    return this.node;
  }

  matches(url: string, channels: number): boolean {
    return this.url === url && this.channels === channels;
  }

  dispose(): void {
    this.disposed = true;
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    this.node.port.postMessage('stop');
    this.node.port.onmessage = null;
    this.node.disconnect();
    this.socket?.close();
    this.socket = null;
  }

  private connect(): void {
    if (this.disposed) return;
    let socket: WebSocket;
    try {
      socket = new WebSocket(this.url);
    } catch (error) {
      this.scheduleReconnect(`Invalid bridge URL ${this.url}: ${String(error)}`);
      return;
    }
    socket.binaryType = 'arraybuffer';
    this.socket = socket;

    socket.onopen = () => {
      socket.send(JSON.stringify({
        type: 'hello',
        channels: this.channels,
        sampleRate: this.sampleRate,
      }));
    };
    socket.onmessage = (event: MessageEvent) => {
      if (typeof event.data !== 'string') return;
      const message = JSON.parse(event.data) as BridgeMessage;
      if (message.type === 'ready') {
        this.onState({ connected: true, device: message.device, deviceChannels: message.deviceChannels });
      } else if (message.type === 'error') {
        this.onState({ connected: false, error: `Bridge: ${message.message ?? 'unknown error'}` });
      }
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.scheduleReconnect(`Bridge not reachable at ${this.url} — is ambisonic_bridge.py running?`);
    };
  }

  private scheduleReconnect(error: string): void {
    if (this.disposed) return;
    this.onState({ connected: false, error });
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, AMBISONIC_SEND.BRIDGE.RECONNECT_MS);
  }

  private forward(chunk: Float32Array): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    // Never queue unboundedly: if the bridge falls behind, drop instead of
    // building latency (the bridge's drift buffer re-primes on the gap).
    if (socket.bufferedAmount > AMBISONIC_SEND.BRIDGE.MAX_BUFFERED_BYTES) return;
    socket.send(chunk);
  }
}
