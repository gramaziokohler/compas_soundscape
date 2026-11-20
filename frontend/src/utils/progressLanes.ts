import type { ProgressLane } from '@/types';

/** Key of a compas_acoustics job's `partial` that holds its parallel parts (backend services/ca_progress.py). */
const CA_PROGRESS_PARTIAL_KEY = 'ca_progress';

const LANE_STATES: ReadonlyArray<ProgressLane['state']> = ['queued', 'running', 'done'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toLane(raw: unknown): ProgressLane | null {
  if (!isRecord(raw)) return null;
  const { label, text, fraction, state, elapsed_s: elapsed } = raw;
  if (typeof label !== 'string' || typeof text !== 'string' || typeof fraction !== 'number') return null;
  if (!LANE_STATES.includes(state as ProgressLane['state'])) return null;
  return {
    label,
    text,
    fraction: Math.max(0, Math.min(fraction, 1)),
    state: state as ProgressLane['state'],
    elapsedS: typeof elapsed === 'number' ? elapsed : null,
  };
}

/**
 * The rows of a job's parallel parts from its unified-job `partial`
 * (`{ ca_progress: { lanes: [...] } }`); null when the job reports none.
 */
export function progressLanesFromPartial(partial: unknown): ProgressLane[] | null {
  if (!isRecord(partial)) return null;
  const detail = partial[CA_PROGRESS_PARTIAL_KEY];
  if (!isRecord(detail) || !Array.isArray(detail.lanes)) return null;
  const lanes = detail.lanes.map(toLane).filter((lane): lane is ProgressLane => lane !== null);
  return lanes.length > 0 ? lanes : null;
}

/** `75` → "1:15" */
export function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
