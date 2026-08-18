/**
 * Concurrency-safe backend job polling.
 *
 * Each call to `startPolling` owns its own setInterval handle (never shared
 * module state), so multiple jobs of the same type can be polled in parallel
 * without clobbering each other — the previous singleton `_*PollInterval`
 * pattern caused a newer invocation's `finally` to clear an older job's poll,
 * silently dropping its results.
 *
 * A `PollRegistry` lets a store cancel ALL of its own in-flight polls from a
 * single "stop" handler without touching other stores' jobs.
 */

export interface PollOptions {
  /** Fetches one status snapshot (e.g. apiService.getSoundGenerationStatus). */
  fetchStatus: () => Promise<any>;
  /** Milliseconds between polls. Default 1500. */
  intervalMs?: number;
  /** Invoked after each non-terminal status (progress / partial streaming). */
  onStatus?: (status: any) => void;
  /**
   * Decides whether `status` is terminal-success. Defaults to
   * `completed && !error && !cancelled` — the falsy-`[]` result bug is avoided
   * by not requiring a truthy `result`.
   */
  isTerminal?: (status: any) => boolean;
  /** Extracts the resolved value from a terminal status. Default `status.result ?? []`. */
  resolveValue?: (status: any) => any;
}

export interface PollController {
  /** Promise that resolves with the terminal value, rejects on error/stop. */
  done: Promise<any>;
  /**
   * Clears the interval and rejects the pending `done` promise with `reason`
   * (defaults to an `Error('AbortError')`). Idempotent.
   */
  stop: (reason?: Error) => void;
}

const DEFAULT_INTERVAL_MS = 1500;

/**
 * Start polling a backend job. The returned controller's `done` promise is the
 * only way the caller learns the outcome; the interval handle is private.
 */
export function startPolling(options: PollOptions): PollController {
  const {
    fetchStatus,
    intervalMs = DEFAULT_INTERVAL_MS,
    onStatus,
    isTerminal = (s: any) =>
      !!s && s.completed === true && s.error == null && s.cancelled !== true,
    resolveValue = (s: any) => s.result ?? [],
  } = options;

  let interval: ReturnType<typeof setInterval> | null = null;
  let settled = false;

  const stop = (reason: Error = new Error('AbortError')) => {
    if (settled) return;
    settled = true;
    if (interval !== null) {
      clearInterval(interval);
      interval = null;
    }
    reject(reason);
  };

  let resolve!: (value: any) => void;
  let reject!: (reason?: any) => void;
  const done = new Promise<any>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  interval = setInterval(async () => {
    try {
      const status = await fetchStatus();
      if (settled) return;

      if (isTerminal(status)) {
        settled = true;
        if (interval !== null) {
          clearInterval(interval);
          interval = null;
        }
        resolve(resolveValue(status));
        return;
      }
      if (status?.cancelled) {
        stop();
        return;
      }
      if (status?.error) {
        stop(new Error(status.error));
        return;
      }
      onStatus?.(status);
    } catch (pollErr) {
      stop(pollErr instanceof Error ? pollErr : new Error(String(pollErr)));
    }
  }, intervalMs);

  return { done, stop };
}

/**
 * A per-store registry of active poll controllers. Enables "cancel everything
 * I started" semantics (e.g. handleStopGeneration) while keeping each job's
 * poll loop independent.
 */
export function createPollRegistry() {
  const controllers = new Set<PollController>();

  return {
    /** Register a controller so `stopAll` can reach it. Returns the controller. */
    track(controller: PollController): PollController {
      controllers.add(controller);
      return controller;
    },
    /** Stop tracking (called implicitly by `stopAll`). */
    release(controller: PollController): void {
      controllers.delete(controller);
    },
    /** Stop every tracked poll, clearing intervals and rejecting their promises. */
    stopAll(reason: Error = new Error('AbortError')): void {
      for (const controller of [...controllers]) {
        controller.stop(reason);
      }
      controllers.clear();
    },
  };
}
