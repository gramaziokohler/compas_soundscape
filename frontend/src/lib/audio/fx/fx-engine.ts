/**
 * Live Foley FX preview engine.
 *
 * Owns a dedicated AudioContext, an FxGraph, and a BufferSource. Play / pause /
 * stop match the sound-card transport. Param writes hit AudioParams in place.
 * Structural chain changes duck the output, rebuild, and unduck so the playing
 * source is never interrupted.
 */

import { SOUND_FX } from '@/utils/constants';
import { registerOutputDeviceTarget } from '@/lib/audio/output-device';
import { FxGraph } from './fx-graph';
import { mergeFxRegions, type FxChain, type FxParams } from './fx-types';

export type FxEngineListener = () => void;

interface ScheduledSegment {
  /** Buffer position (seconds) where this segment starts. */
  bufferStart: number;
  /** Buffer position (seconds) where this segment ends. */
  bufferEnd: number;
  /** Elapsed play time (seconds) at which this segment starts. */
  cumStart: number;
  /** Elapsed play time (seconds) at which this segment ends. */
  cumEnd: number;
}

export class FxEngine {
  private ctx: AudioContext | null = null;
  private graph: FxGraph | null = null;
  private segSources: AudioBufferSourceNode[] = [];
  private analyser: AnalyserNode | null = null;
  private meterSplitter: ChannelSplitterNode | null = null;
  private meterL: AnalyserNode | null = null;
  private meterR: AnalyserNode | null = null;
  private meterSink: GainNode | null = null;
  private meterBuf: Float32Array<ArrayBuffer> | null = null;
  private buffer: AudioBuffer | null = null;
  private chain: FxChain;
  private unregisterSink: (() => void) | null = null;
  private playing = false;
  private pausedAt = 0;
  private startedAt = 0;
  private loop = true;
  private listeners = new Set<FxEngineListener>();
  private rebuildTimer: ReturnType<typeof setTimeout> | null = null;
  private schedule: ScheduledSegment[] = [];
  private totalSegDur = 0;
  private scheduledRegionKey = '';
  private rebuilding = false;
  private chainDirty = false;
  /** Serializes source swaps so rapid toggles can't interleave fades. */
  private swapChain: Promise<void> = Promise.resolve();

  constructor(chain: FxChain) {
    this.chain = chain;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get currentTime(): number {
    if (!this.ctx || !this.buffer) return this.pausedAt;
    if (!this.playing) return this.pausedAt;
    if (this.totalSegDur <= 0 || this.schedule.length === 0) return this.pausedAt;
    const elapsed = this.ctx.currentTime - this.startedAt;
    if (elapsed <= 0) return this.schedule[0].bufferStart;
    if (elapsed >= this.totalSegDur) {
      return this.schedule[this.schedule.length - 1].bufferEnd;
    }
    const seg =
      this.schedule.find((s) => elapsed >= s.cumStart && elapsed < s.cumEnd) ??
      this.schedule[this.schedule.length - 1];
    return seg.bufferStart + (elapsed - seg.cumStart);
  }

  get duration(): number {
    return this.buffer?.duration ?? 0;
  }

  getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  /** Linear peak of the post-FX stereo output (can exceed 1.0 when clipping). */
  getOutputLevels(): { left: number; right: number } {
    const read = (an: AnalyserNode | null): number => {
      if (!an || !this.meterBuf) return 0;
      an.getFloatTimeDomainData(this.meterBuf);
      let peak = 0;
      for (let i = 0; i < this.meterBuf.length; i++) {
        const a = Math.abs(this.meterBuf[i]);
        if (a > peak) peak = a;
      }
      return peak;
    };
    const left = read(this.meterL);
    const right = this.buffer && this.buffer.numberOfChannels < 2 ? left : read(this.meterR);
    return { left, right };
  }

  subscribe(fn: FxEngineListener): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  async init(buffer: AudioBuffer): Promise<void> {
    this.buffer = buffer;
    if (!this.ctx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
      this.unregisterSink = registerOutputDeviceTarget(this.ctx);
    }
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
    if (!this.graph) {
      this.graph = new FxGraph(this.ctx);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = SOUND_FX.EQ_FFT_BINS;
      this.analyser.smoothingTimeConstant = 0.7;
      this.graph.output.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);

      // Stereo output meter taps (post-FX, including output gain).
      this.meterSplitter = this.ctx.createChannelSplitter(2);
      this.meterL = this.ctx.createAnalyser();
      this.meterR = this.ctx.createAnalyser();
      this.meterL.fftSize = 1024;
      this.meterR.fftSize = 1024;
      this.meterBuf = new Float32Array(1024);
      // Analyser leaves are only processed when they reach the destination, so
      // route them through a silent gain sink.
      this.meterSink = this.ctx.createGain();
      this.meterSink.gain.value = 0;
      this.meterSink.connect(this.ctx.destination);
      this.graph.output.connect(this.meterSplitter);
      this.meterSplitter.connect(this.meterL, 0);
      this.meterSplitter.connect(this.meterR, 1);
      this.meterL.connect(this.meterSink);
      this.meterR.connect(this.meterSink);

      await this.graph.buildChain(this.chain);
    }
  }

  async setBuffer(buffer: AudioBuffer): Promise<void> {
    const wasPlaying = this.playing;
    const t = this.currentTime;
    this.stop();
    this.buffer = buffer;
    this.pausedAt = Math.min(t, buffer.duration);
    if (wasPlaying) await this.play();
  }

  /**
   * Swap the previewed source (e.g. original ↔ Stable Audio result) WITHOUT
   * interrupting playback: the output fades out over SWITCH_XFADE_SEC, the new
   * buffer starts at the SAME playhead position, and the output fades back in.
   * The old source is stopped before the new one starts, so the two never sound
   * together. When paused, the buffer is swapped silently.
   */
  crossfadeToBuffer(buffer: AudioBuffer): Promise<void> {
    // Serialize: each queued swap reads the playhead when it actually runs, so a
    // burst of toggles resolves to one clean fade into the final source.
    this.swapChain = this.swapChain.then(() => this.doCrossfade(buffer));
    return this.swapChain;
  }

  private async doCrossfade(buffer: AudioBuffer): Promise<void> {
    const pos = this.currentTime;
    if (!this.playing || !this.graph || !this.ctx) {
      this.buffer = buffer;
      this.pausedAt = Math.min(pos, buffer.duration);
      this.notify();
      return;
    }
    const out = this.graph.output;
    const now = this.ctx.currentTime;
    try {
      out.gain.cancelAndHoldAtTime(now);
    } catch {
      out.gain.setValueAtTime(out.gain.value, now);
    }
    out.gain.linearRampToValueAtTime(0, now + SOUND_FX.SWITCH_XFADE_SEC);
    await new Promise((r) => setTimeout(r, SOUND_FX.SWITCH_XFADE_SEC * 1000 + 4));

    this.stopSource();
    this.buffer = buffer;
    this.pausedAt = Math.min(pos, buffer.duration);
    this.playing = false;
    await this.play();

    const t = this.ctx.currentTime;
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(1, t + SOUND_FX.SWITCH_XFADE_SEC);
  }

  async setChain(chain: FxChain): Promise<void> {
    this.chain = chain;
    if (!this.graph || !this.ctx) return;
    // Region drags (and rapid add/remove) fire many setChain calls; coalesce
    // them so only one duck-swap rebuild runs at a time and the final chain wins.
    if (this.rebuilding) {
      this.chainDirty = true;
      return;
    }
    this.rebuilding = true;
    try {
      do {
        this.chainDirty = false;
        await this.rebuild();
      } while (this.chainDirty);
    } finally {
      this.rebuilding = false;
    }
  }

  setInstanceBypass(instanceId: string, enabled: boolean): void {
    this.graph?.setInstanceBypass(instanceId, enabled);
  }

  updateInstanceParams(instanceId: string, params: FxParams): void {
    this.graph?.updateInstanceParams(instanceId, params);
  }

  setOutputGainDb(db: number): void {
    this.graph?.setOutputGainDb(db);
  }

  async play(): Promise<void> {
    if (!this.ctx || !this.graph || !this.buffer) return;
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.stopSource();
    this.buildSchedule();
    const when0 = this.ctx.currentTime + 0.02;
    let last: AudioBufferSourceNode | null = null;
    for (const seg of this.schedule) {
      const dur = seg.bufferEnd - seg.bufferStart;
      if (dur <= 0) continue;
      const src = this.ctx.createBufferSource();
      src.buffer = this.buffer;
      src.connect(this.graph.input);
      src.start(when0 + seg.cumStart, seg.bufferStart, dur);
      this.segSources.push(src);
      last = src;
    }
    if (last) {
      last.onended = () => {
        // Segments are scheduled back-to-back with no silence between them; when
        // the pass ends, restart from the top to keep a continuous preview loop.
        if (this.playing && this.loop) {
          this.pausedAt = 0;
          void this.play();
        }
      };
    }
    this.startedAt = when0;
    this.playing = true;
    this.notify();
  }

  pause(): void {
    if (!this.playing) return;
    this.pausedAt = this.currentTime;
    this.stopSource();
    this.playing = false;
    this.notify();
  }

  stop(): void {
    this.stopSource();
    this.playing = false;
    this.pausedAt = 0;
    this.notify();
  }

  seek(timeSec: number): void {
    const dur = this.buffer?.duration ?? 0;
    this.pausedAt = Math.max(0, Math.min(timeSec, dur));
    if (this.playing) {
      void this.play();
    } else {
      this.notify();
    }
  }

  dispose(): void {
    this.stop();
    if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
    this.graph?.dispose();
    this.graph = null;
    this.analyser?.disconnect();
    this.analyser = null;
    this.meterSplitter?.disconnect();
    this.meterL?.disconnect();
    this.meterR?.disconnect();
    this.meterSink?.disconnect();
    this.meterSplitter = null;
    this.meterL = null;
    this.meterR = null;
    this.meterSink = null;
    this.meterBuf = null;
    this.unregisterSink?.();
    this.unregisterSink = null;
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
    this.listeners.clear();
  }

  private stopSource(): void {
    for (const src of this.segSources) {
      try { src.onended = null; } catch { /* ignore */ }
      try { src.stop(); } catch { /* ignore */ }
      try { src.disconnect(); } catch { /* ignore */ }
    }
    this.segSources = [];
  }

  /**
   * Build the ordered list of buffer segments to play. With no regions this is
   * one segment covering the whole buffer. With regions it is their union
   * (merged, so overlapping selections never replay the same audio), scheduled
   * back-to-back so playback jumps straight from one region to the next.
   */
  private buildSchedule(): void {
    if (!this.buffer) {
      this.schedule = [];
      this.totalSegDur = 0;
      this.scheduledRegionKey = '';
      return;
    }
    const dur = this.buffer.duration;
    const merged = mergeFxRegions(this.chain.regions);
    this.scheduledRegionKey = JSON.stringify(merged);
    let regions = merged
      .map((r) => ({ start: r.start * dur, end: r.end * dur }))
      .filter((r) => r.end - r.start > 1e-4);
    if (regions.length === 0) regions = [{ start: 0, end: dur }];

    const pos = Math.max(0, Math.min(this.pausedAt, dur));
    let startIdx = 0;
    let startPos = regions[0].start;
    for (let i = 0; i < regions.length; i++) {
      const r = regions[i];
      if (pos >= r.start && pos < r.end) { startIdx = i; startPos = pos; break; }
      if (pos < r.start) { startIdx = i; startPos = r.start; break; }
    }

    const ordered: { start: number; end: number }[] = [];
    for (let k = 0; k < regions.length; k++) {
      const i = startIdx + k;
      if (i < regions.length) {
        ordered.push(k === 0 ? { start: startPos, end: regions[i].end } : regions[i]);
      } else if (this.loop) {
        ordered.push(regions[i - regions.length]);
      }
    }

    let cum = 0;
    this.schedule = ordered
      .filter((r) => r.end - r.start > 1e-4)
      .map((r) => {
        const seg: ScheduledSegment = {
          bufferStart: r.start,
          bufferEnd: r.end,
          cumStart: cum,
          cumEnd: cum + (r.end - r.start),
        };
        cum += r.end - r.start;
        return seg;
      });
    this.totalSegDur = cum;
  }

  private async rebuild(): Promise<void> {
    if (!this.graph || !this.ctx) return;
    const pos = this.currentTime;
    const regionKey = JSON.stringify(mergeFxRegions(this.chain.regions));
    const regionsChanged = regionKey !== this.scheduledRegionKey;
    const out = this.graph.output;
    const now = this.ctx.currentTime;
    try {
      out.gain.cancelAndHoldAtTime(now);
    } catch {
      out.gain.setValueAtTime(out.gain.value, now);
    }
    out.gain.linearRampToValueAtTime(0, now + SOUND_FX.REBUILD_DUCK_SEC);
    await new Promise((r) => { this.rebuildTimer = setTimeout(r, SOUND_FX.REBUILD_DUCK_SEC * 1000 + 4); });
    await this.graph.buildChain(this.chain);
    const t = this.ctx.currentTime;
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(1, t + SOUND_FX.REBUILD_DUCK_SEC);
    // Effect add/remove/reorder keeps the running segment sources (graph.input is
    // identity-stable), so no restart is needed. A region edit changes *what* is
    // scheduled — reschedule from the current position.
    if (regionsChanged && this.playing) {
      this.pausedAt = pos;
      this.stopSource();
      this.playing = false;
      await this.play();
    }
  }

  private notify(): void {
    this.listeners.forEach((fn) => fn());
  }
}
