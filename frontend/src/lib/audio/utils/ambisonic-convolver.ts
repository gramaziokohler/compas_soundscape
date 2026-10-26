/**
 * AmbisonicConvolver
 *
 * Mono input → (order+1)² discrete ACN channels, one ConvolverNode per IR channel.
 * Same shape as the JSAmbisonics `convolver` (`in`, `out`, `updateFilters`), but a
 * channel whose filter is all zeros gets NO ConvolverNode: its merger input stays
 * unconnected, which is silence. A mono simulation IR stored as FOA (W only) thus
 * costs one convolver instead of four, a global source's omni filter one, and an
 * all-zero mute IR none. Output is identical to convolving every channel.
 */

/** True when every sample of `data` is exactly zero. */
function isSilentChannel(data: Float32Array): boolean {
  for (let i = 0; i < data.length; i++) {
    if (data[i] !== 0) return false;
  }
  return true;
}

export class AmbisonicConvolver {
  readonly in: GainNode;
  readonly out: ChannelMergerNode;
  private readonly ctx: BaseAudioContext;
  private readonly nCh: number;
  private nodes: ConvolverNode[] = [];

  constructor(ctx: BaseAudioContext, order: number) {
    this.ctx = ctx;
    this.nCh = (order + 1) * (order + 1);
    this.in = ctx.createGain();
    this.in.channelCountMode = 'explicit';
    this.in.channelCount = 1;
    this.out = ctx.createChannelMerger(this.nCh);
  }

  /** Number of ConvolverNodes currently rendering (non-silent filter channels). */
  get activeChannels(): number {
    return this.nodes.length;
  }

  /** Load a multichannel filter; channel i feeds ACN output i. */
  updateFilters(filter: AudioBuffer): void {
    this.releaseNodes();
    const channels = Math.min(this.nCh, filter.numberOfChannels);
    for (let i = 0; i < channels; i++) {
      const data = filter.getChannelData(i);
      if (isSilentChannel(data)) continue;

      const mono = this.ctx.createBuffer(1, filter.length, filter.sampleRate);
      mono.getChannelData(0).set(data);
      const node = this.ctx.createConvolver();
      node.normalize = false;
      node.buffer = mono;
      this.in.connect(node);
      node.connect(this.out, 0, i);
      this.nodes.push(node);
    }
  }

  /** True when the filter loaded last has no non-zero channel (renders silence). */
  get isSilent(): boolean {
    return this.nodes.length === 0;
  }

  dispose(): void {
    this.releaseNodes();
    try {
      this.in.disconnect();
      this.out.disconnect();
    } catch {
      // Already disconnected
    }
  }

  private releaseNodes(): void {
    for (const node of this.nodes) {
      try {
        this.in.disconnect(node);
        node.disconnect();
      } catch {
        // Already disconnected
      }
    }
    this.nodes = [];
  }
}
