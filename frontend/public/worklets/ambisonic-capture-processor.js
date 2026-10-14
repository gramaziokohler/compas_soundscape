/**
 * Ambisonic capture processor.
 *
 * Interleaves the node's N discrete input channels into Float32 frames and
 * posts them to the main thread in fixed-size chunks (transferred, no copy),
 * which forwards them over a WebSocket to the local ASIO bridge
 * (scripts/ambisonic_bridge). Missing/silent inputs are written as zeros so
 * the stream stays continuous.
 *
 * processorOptions: { channels: number, framesPerMessage: number }
 * Contract mirrored in frontend/src/lib/audio/output/BridgeSendTransport.ts.
 */
class AmbisonicCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { channels, framesPerMessage } = options.processorOptions;
    this._channels = channels;
    this._chunkLength = channels * framesPerMessage;
    this._chunk = new Float32Array(this._chunkLength);
    this._offset = 0;
    this._active = true;
    this.port.onmessage = (event) => {
      if (event.data === 'stop') this._active = false;
    };
  }

  process(inputs) {
    const input = inputs[0] || [];
    const channels = this._channels;
    const frames = input.length > 0 ? input[0].length : 128;

    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < channels; c++) {
        const data = input[c];
        this._chunk[this._offset++] = data ? data[i] : 0;
      }
      if (this._offset === this._chunkLength) {
        this.port.postMessage(this._chunk, [this._chunk.buffer]);
        this._chunk = new Float32Array(this._chunkLength);
        this._offset = 0;
      }
    }
    return this._active;
  }
}

registerProcessor('ambisonic-capture-processor', AmbisonicCaptureProcessor);
