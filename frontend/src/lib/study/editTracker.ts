import { STUDY_LOG } from '@/utils/constants';
import { logStudyEvent } from '@/lib/study/studyLogger';
import { diffStudyState } from '@/lib/study/stateDiff';
import { scheduleIdle } from '@/lib/study/idle';
import type { UndoStepNotice } from '@/store';

/**
 * Edit log from the global undo registry (risk gate R3 — feature `state_diff`).
 *
 * The registry already turns every user interaction into exactly one step and
 * holds the snapshots before / after it, so every edit is logged once without
 * per-component calls:
 *   state.change {store, source: 'user'|'system', changes[], truncated}
 *   state.undo / state.redo {store, changes[]}
 *
 * The registry listener only QUEUES the notice (references, no work); diffs
 * run on idle. 'system' notices (job results, streamed LLM output) for the
 * same store are merged until the flush, so a stream is one event.
 */

const MAX_PENDING = 100;

interface PendingNotice {
  storeId: string;
  source: UndoStepNotice['source'];
  before: unknown;
  after: unknown;
}

let _pending: PendingNotice[] = [];
let _flushScheduled = false;

function eventType(source: UndoStepNotice['source']): string {
  if (source === 'undo') return 'state.undo';
  if (source === 'redo') return 'state.redo';
  return 'state.change';
}

function flush(): void {
  _flushScheduled = false;
  const batch = _pending;
  _pending = [];
  for (const notice of batch) {
    const diff = diffStudyState(notice.before, notice.after);
    if (diff.changes.length === 0) continue;
    logStudyEvent(eventType(notice.source), {
      store: notice.storeId,
      source: notice.source,
      changes: diff.changes,
      truncated: diff.truncated,
    });
  }
}

function onStep(notice: UndoStepNotice): void {
  if (notice.source === 'system') {
    const open = _pending.find((p) => p.storeId === notice.storeId && p.source === 'system');
    if (open) {
      open.after = notice.after; // keep the earliest `before`, latest `after`
      return;
    }
  }
  if (_pending.length >= MAX_PENDING) return;
  _pending.push({ ...notice });
  if (!_flushScheduled) {
    _flushScheduled = true;
    scheduleIdle(flush, STUDY_LOG.DIFF_IDLE_TIMEOUT_MS);
  }
}

/**
 * Start observing undo steps. `subscribe` is the registry's
 * `addUndoStepListener` (injected so this module never imports the store
 * barrel). Returns the unsubscribe fn.
 */
export function installStudyEditTracker(
  subscribe: (listener: (notice: UndoStepNotice) => void) => () => void,
): () => void {
  const unsubscribe = subscribe(onStep);
  return () => {
    unsubscribe();
    _pending = [];
  };
}
