import { STUDY_LOG } from '@/utils/constants';
import { logStudyEvent } from '@/lib/study/studyLogger';

/**
 * Self-monitoring during the study: main-thread long tasks over
 * STUDY_LOG.LONG_TASK_MIN_MS are logged as `perf.longtask`, so any jank
 * (including jank caused by the logger) shows up in the data. Chromium only;
 * a no-op where the `longtask` entry type is unsupported. Returns a disposer.
 */
export function installStudyLongTaskMonitor(): () => void {
  try {
    if (typeof PerformanceObserver === 'undefined') return () => {};
    if (!PerformanceObserver.supportedEntryTypes?.includes('longtask')) return () => {};
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration < STUDY_LOG.LONG_TASK_MIN_MS) continue;
        logStudyEvent('perf.longtask', { duration_ms: Math.round(entry.duration), name: entry.name });
      }
    });
    observer.observe({ type: 'longtask', buffered: false });
    return () => observer.disconnect();
  } catch {
    return () => {};
  }
}
