/**
 * Emergency guard — the last resort before the tab dies ("Aw, Snap") on a very large
 * model. A subscriber of the shared performance monitor (1 Hz, no frame tracking).
 *
 * Triggers (only these, all above the meter's red so ordinary switches never fire it):
 * - estimated app memory > the meter's red × CRITICAL_MEMORY_FACTOR for CONSECUTIVE_SAMPLES samples
 * - the WebGL context is lost
 * - main-thread blocks ≥ CRITICAL_STALL_MS, STALL_REPEAT_COUNT times within the window
 *
 * Action: release cached IRs, shrink the IR budget, cancel the IR swap in progress and
 * pause playback (if it was playing). Playback resumes on its own after RECOVERY_SAMPLES
 * healthy samples.
 */
import { EMERGENCY_GUARD } from '@/utils/constants';
import type { PerformanceSample } from '@/types';
import { subscribePerformance } from './performance-monitor';
import { memoryThresholds } from './performance-levels';
import { reportClientDiagnostic } from './crash-reporter';

export interface EmergencyGuardActions {
  releaseAudioMemory: () => void;
  isPlaying: () => boolean;
  pause: () => void;
  resume: () => void;
  notify: (message: string, type: 'warning' | 'info') => void;
}

export function startEmergencyGuard(actions: EmergencyGuardActions): () => void {
  let overMemory = 0;
  let healthy = 0;
  let stalls: number[] = [];
  let inEmergency = false;
  let pausedByGuard = false;

  const trigger = (reason: string, data?: Record<string, unknown>) => {
    if (inEmergency) return;
    inEmergency = true;
    healthy = 0;
    reportClientDiagnostic('emergency', { reason, ...data });
    console.warn('[emergency-guard] triggered:', reason, data ?? '');
    actions.releaseAudioMemory();
    if (actions.isPlaying()) {
      actions.pause();
      pausedByGuard = true;
    }
    actions.notify(EMERGENCY_GUARD.RECOVERING_MESSAGE, 'warning');
  };

  const isHealthy = (sample: PerformanceSample) =>
    !sample.contextLost &&
    sample.memoryMB < memoryThresholds(sample).warn &&
    sample.longTasks.worstMs < EMERGENCY_GUARD.CRITICAL_STALL_MS;

  return subscribePerformance({
    intervalMs: EMERGENCY_GUARD.SAMPLE_INTERVAL_MS,
    onSample: (sample) => {
      const criticalMB = memoryThresholds(sample).crit * EMERGENCY_GUARD.CRITICAL_MEMORY_FACTOR;
      overMemory = sample.memoryMB > criticalMB ? overMemory + 1 : 0;
      if (overMemory >= EMERGENCY_GUARD.CONSECUTIVE_SAMPLES) {
        trigger('memory', { memoryMB: Math.round(sample.memoryMB) });
        return;
      }
      if (!inEmergency) return;
      healthy = isHealthy(sample) ? healthy + 1 : 0;
      if (healthy < EMERGENCY_GUARD.RECOVERY_SAMPLES) return;
      inEmergency = false;
      if (pausedByGuard) {
        pausedByGuard = false;
        actions.resume();
        actions.notify(EMERGENCY_GUARD.RECOVERED_MESSAGE, 'info');
      }
    },
    onEvent: ({ name, data }) => {
      if (name === 'webglcontextlost') {
        trigger('webgl-context-lost');
        return;
      }
      if (name !== 'longtask') return;
      const ms = typeof data?.ms === 'number' ? data.ms : 0;
      if (ms < EMERGENCY_GUARD.CRITICAL_STALL_MS) return;
      const now = performance.now();
      stalls = [...stalls.filter((t) => now - t <= EMERGENCY_GUARD.STALL_REPEAT_WINDOW_MS), now];
      if (stalls.length >= EMERGENCY_GUARD.STALL_REPEAT_COUNT) trigger('main-thread-stalls', { ms, count: stalls.length });
    },
  });
}
