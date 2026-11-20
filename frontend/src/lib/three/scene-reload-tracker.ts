/**
 * Tracks a "scene reload": a sync that removed sound sources AND started loading new
 * ones (a share-link scene or simulation switch replacing the sound set). Consumers
 * pause the timeline and show progress until every new buffer has loaded (or failed),
 * so the new scene never starts half-loaded.
 */
export interface SceneReloadProgress {
  loaded: number;
  total: number;
}

export class SceneReloadTracker {
  private pending = new Set<string>();
  private total = 0;
  private listeners = new Set<(progress: SceneReloadProgress | null) => void>();

  get active(): boolean {
    return this.total > 0;
  }

  /** Start (or extend) a reload with these newly started loads. */
  begin(ids: readonly string[]): void {
    if (ids.length === 0) return;
    for (const id of ids) {
      if (!this.pending.has(id)) {
        this.pending.add(id);
        this.total++;
      }
    }
    this.publish();
  }

  /** A tracked load finished (success or error), or its sound was removed. */
  settle(id: string): void {
    if (!this.pending.delete(id)) return;
    if (this.pending.size === 0) {
      this.total = 0;
      this.notify(null);
      return;
    }
    this.publish();
  }

  /** Progress listener; called with null when the reload completes. */
  subscribe(listener: (progress: SceneReloadProgress | null) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private publish(): void {
    this.notify({ loaded: this.total - this.pending.size, total: this.total });
  }

  private notify(progress: SceneReloadProgress | null): void {
    for (const listener of this.listeners) {
      try {
        listener(progress);
      } catch (error) {
        console.error('[SceneReloadTracker] listener failed:', error);
      }
    }
  }
}
