import { STUDY_LOG } from '@/utils/constants';
import { isPlainObject, toStudyJson } from '@/lib/study/sanitize';
import type { StudyJson } from '@/types/study';

/**
 * Path-level diff between two partialized store snapshots (risk gate R3).
 *
 * Bounded by construction:
 * - reference-equal subtrees are skipped instantly (zundo snapshots share every
 *   unchanged subtree, so the walk is O(changed), not O(state));
 * - only plain objects / arrays / Maps are walked — AudioBuffers, THREE objects,
 *   Files compare by reference and appear as `"<TypeName>"`;
 * - a node budget and a change cap stop pathological inputs.
 */

export interface StudyStateChange {
  [key: string]: StudyJson;
  path: string;
  before: StudyJson;
  after: StudyJson;
}

export interface StudyStateDiff {
  changes: StudyStateChange[];
  /** True when the node budget or change cap cut the diff short. */
  truncated: boolean;
}

function preview(value: unknown): StudyJson {
  const json = toStudyJson(value);
  if (json === null || typeof json !== 'object') {
    return typeof json === 'string' && json.length > STUDY_LOG.DIFF_VALUE_MAX_CHARS
      ? `${json.slice(0, STUDY_LOG.DIFF_VALUE_MAX_CHARS)}…`
      : json;
  }
  const text = JSON.stringify(json);
  return text.length > STUDY_LOG.DIFF_VALUE_MAX_CHARS ? `${text.slice(0, STUDY_LOG.DIFF_VALUE_MAX_CHARS)}…` : json;
}

function childPath(base: string, key: string | number): string {
  if (typeof key === 'number') return `${base}[${key}]`;
  return base ? `${base}.${key}` : key;
}

export function diffStudyState(before: unknown, after: unknown): StudyStateDiff {
  const changes: StudyStateChange[] = [];
  let nodes = 0;
  let truncated = false;

  const walk = (a: unknown, b: unknown, path: string): void => {
    if (truncated || Object.is(a, b)) return;
    if (++nodes > STUDY_LOG.DIFF_MAX_NODES || changes.length >= STUDY_LOG.DIFF_MAX_CHANGES) {
      truncated = true;
      return;
    }
    const aMap = a instanceof Map ? Object.fromEntries(a) : a;
    const bMap = b instanceof Map ? Object.fromEntries(b) : b;
    if (Array.isArray(aMap) && Array.isArray(bMap)) {
      const len = Math.max(aMap.length, bMap.length);
      for (let i = 0; i < len && !truncated; i++) walk(aMap[i], bMap[i], childPath(path, i));
      return;
    }
    if (isPlainObject(aMap) && isPlainObject(bMap)) {
      const keys = new Set([...Object.keys(aMap), ...Object.keys(bMap)]);
      for (const key of keys) {
        if (truncated) return;
        walk(aMap[key], bMap[key], childPath(path, key));
      }
      return;
    }
    if (a instanceof Set && b instanceof Set) {
      if (a.size === b.size && [...a].every((v) => b.has(v))) return;
    }
    changes.push({ path: path || '(root)', before: preview(a), after: preview(b) });
  };

  try {
    walk(before, after, '');
  } catch {
    truncated = true;
  }
  return { changes, truncated };
}
