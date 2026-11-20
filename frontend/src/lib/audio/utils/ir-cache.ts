/**
 * Decoded simulation-IR cache for the AudioOrchestrator.
 *
 * - One decode per IR id: concurrent requests share the in-flight promise.
 * - Least-recently-used eviction under a byte budget sized from the device RAM
 *   (`navigator.deviceMemory`, coarse and Chromium-only; IR_CACHE.DEFAULT_MB elsewhere),
 *   so switching back to a recently compared simulation stays instant.
 * - Pinned ids (the IRs playing now and the swap being prepared) are never evicted.
 */
import { CRASH_PROBE, IR_CACHE } from '@/utils/constants';

export interface IRCacheStats {
  count: number;
  bytes: number;
  budgetBytes: number;
  pinned: number;
  inFlight: number;
  /** Decodes since load, and how many of them decoded an id seen before (evicted then needed again). */
  decodes: number;
  redecodes: number;
  evictions: number;
}

function bufferBytes(buffer: AudioBuffer): number {
  return buffer.length * buffer.numberOfChannels * CRASH_PROBE.BYTES_PER_SAMPLE;
}

/** Budget in bytes from the device RAM (GB, rounded by the browser), clamped. */
export function defaultIRCacheBudgetBytes(): number {
  const deviceMemoryGB =
    typeof navigator !== 'undefined' ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory : undefined;
  const mb = deviceMemoryGB
    ? Math.min(IR_CACHE.MAX_MB, Math.max(IR_CACHE.MIN_MB, deviceMemoryGB * IR_CACHE.MB_PER_GB))
    : IR_CACHE.DEFAULT_MB;
  return mb * CRASH_PROBE.BYTES_PER_MB;
}

export class IRCache {
  /** Insertion order = recency (a hit re-inserts the entry at the end). */
  private entries = new Map<string, AudioBuffer>();
  private inFlight = new Map<string, Promise<AudioBuffer>>();
  private pinned = new Set<string>();
  private everDecoded = new Set<string>();
  private bytes = 0;
  private decodes = 0;
  private redecodes = 0;
  private evictions = 0;

  constructor(private budgetBytes: number = defaultIRCacheBudgetBytes()) {}

  /** Cached buffer, the shared in-flight decode, or a new `load()` (download + decode). */
  get(id: string, load: () => Promise<AudioBuffer>): Promise<AudioBuffer> {
    const hit = this.entries.get(id);
    if (hit) {
      this.entries.delete(id);
      this.entries.set(id, hit);
      return Promise.resolve(hit);
    }
    const pending = this.inFlight.get(id);
    if (pending) return pending;

    const promise = load()
      .then((buffer) => {
        this.decodes++;
        if (this.everDecoded.has(id)) this.redecodes++;
        this.everDecoded.add(id);
        this.entries.set(id, buffer);
        this.bytes += bufferBytes(buffer);
        this.evict();
        return buffer;
      })
      .finally(() => this.inFlight.delete(id));
    this.inFlight.set(id, promise);
    return promise;
  }

  /** Protect ids from eviction. `merge` adds to the current set (used while a swap prepares). */
  pin(ids: Iterable<string>, merge = false): void {
    if (!merge) this.pinned.clear();
    for (const id of ids) this.pinned.add(id);
    this.evict();
  }

  setBudgetBytes(bytes: number): void {
    this.budgetBytes = bytes;
    this.evict();
  }

  getBudgetBytes(): number {
    return this.budgetBytes;
  }

  /** Drop everything that is not pinned (emergency memory release). */
  shrinkToPinned(): void {
    for (const id of [...this.entries.keys()]) {
      if (!this.pinned.has(id)) this.remove(id);
    }
  }

  clear(): void {
    this.entries.clear();
    this.pinned.clear();
    this.bytes = 0;
  }

  stats(): IRCacheStats {
    return {
      count: this.entries.size,
      bytes: this.bytes,
      budgetBytes: this.budgetBytes,
      pinned: this.pinned.size,
      inFlight: this.inFlight.size,
      decodes: this.decodes,
      redecodes: this.redecodes,
      evictions: this.evictions,
    };
  }

  private remove(id: string): void {
    const buffer = this.entries.get(id);
    if (!buffer) return;
    this.entries.delete(id);
    this.bytes -= bufferBytes(buffer);
    this.evictions++;
  }

  /** Evict least-recently-used, unpinned entries until within budget. */
  private evict(): void {
    if (this.bytes <= this.budgetBytes) return;
    for (const id of [...this.entries.keys()]) {
      if (this.bytes <= this.budgetBytes) return;
      if (!this.pinned.has(id)) this.remove(id);
    }
  }
}
