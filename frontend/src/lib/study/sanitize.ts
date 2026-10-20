import { STUDY_LOG } from '@/utils/constants';
import type { StudyJson, StudyPayload } from '@/types/study';

/**
 * Plain-JSON clone with hard caps, used on every study payload AT ENQUEUE TIME.
 *
 * Guarantees for callers (risks C1/C2 in the study plan):
 * - never throws (cycles, getters that throw, exotic objects are all handled);
 * - keeps no reference to the input (AudioBuffers, store objects, THREE nodes
 *   are replaced by a `"<TypeName>"` marker, so nothing large stays alive);
 * - bounded output (depth, keys, array items and string length are capped).
 */

function typeName(value: object): string {
  const ctor = (value as { constructor?: { name?: unknown } }).constructor;
  return typeof ctor?.name === 'string' && ctor.name ? ctor.name : 'Object';
}

/** True for `{}` / `Object.create(null)` — the only objects walked into. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…[+${text.length - max}]` : text;
}

function cloneValue(value: unknown, depth: number, seen: WeakSet<object>): StudyJson {
  if (value === null || value === undefined) return null;
  switch (typeof value) {
    case 'string':
      // Inline images / audio (data URLs) never belong in the event log.
      if (value.startsWith('data:')) return `<data-url ${value.length} chars>`;
      return clip(value, STUDY_LOG.MAX_STRING_CHARS);
    case 'number':
      return Number.isFinite(value) ? value : String(value);
    case 'boolean':
      return value;
    case 'bigint':
      return value.toString();
    case 'function':
    case 'symbol':
      return null;
  }
  const obj = value as object;
  if (seen.has(obj)) return '<cycle>';
  if (depth >= STUDY_LOG.MAX_DEPTH) return `<${typeName(obj)} depth-capped>`;

  if (Array.isArray(obj)) {
    seen.add(obj);
    const out = obj.slice(0, STUDY_LOG.MAX_ARRAY_ITEMS).map((v) => cloneValue(v, depth + 1, seen));
    if (obj.length > STUDY_LOG.MAX_ARRAY_ITEMS) out.push(`<+${obj.length - STUDY_LOG.MAX_ARRAY_ITEMS} items>`);
    seen.delete(obj);
    return out;
  }
  if (obj instanceof Date) return obj.toISOString();
  if (obj instanceof Map || obj instanceof Set) {
    // Small collections are common in stores (assignments, mute sets): keep them readable.
    seen.add(obj);
    const entries = obj instanceof Map ? Object.fromEntries(obj) : [...obj];
    const out = cloneValue(entries, depth + 1, seen);
    seen.delete(obj);
    return out;
  }
  if (!isPlainObject(obj)) return `<${typeName(obj)}>`;

  seen.add(obj);
  const out: { [key: string]: StudyJson } = {};
  let count = 0;
  for (const key of Object.keys(obj)) {
    if (count >= STUDY_LOG.MAX_OBJECT_KEYS) {
      out['<truncated>'] = `${Object.keys(obj).length - count} keys`;
      break;
    }
    let child: unknown;
    try {
      child = obj[key];
    } catch {
      child = '<unreadable>';
    }
    if (child === undefined) continue;
    out[key] = cloneValue(child, depth + 1, seen);
    count++;
  }
  seen.delete(obj);
  return out;
}

/** Sanitise any value into JSON-safe data. Never throws. */
export function toStudyJson(value: unknown): StudyJson {
  try {
    return cloneValue(value, 0, new WeakSet());
  } catch {
    return '<unserializable>';
  }
}

/** Sanitise an event payload (always returns an object). */
export function toStudyPayload(payload: Record<string, unknown> | undefined): StudyPayload {
  const json = toStudyJson(payload ?? {});
  return isPlainObject(json) ? (json as StudyPayload) : { value: json };
}
