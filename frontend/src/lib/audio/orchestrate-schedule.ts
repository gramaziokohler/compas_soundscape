/**
 * Strict constraint resolver for orchestrate parametric schedules.
 *
 * Each (entryId, iteration) slot is a node with at most ONE parent dependency:
 * an absolute `MM:SS` anchor, an `after(ref)` edge, an `alignEnd(ref)` edge, or
 * nothing. Resolution is:
 *
 *   1. Parse every reference with `parseTriggerRef` (lookup-first — see its doc).
 *   2. Detect dependency cycles (DFS colouring) and deterministically cut one
 *      edge per cycle, anchoring the cut node at its authored timestamp (or the
 *      current timeline frontier when none exists).
 *   3. Topologically resolve the remaining DAG in a single pass:
 *        after(ref)      → refStart + refDuration + delay
 *        alignEnd(ref)   → refStart − thisDuration − delay   (ends `delay` before ref)
 *   4. Validate every parametric slot equals its formula and report deviations.
 *
 * This replaces the previous 30-pass fixed-point + speculative safety-net, which
 * silently fell back to authored MM:SS times (that overlap once real audio
 * durations are known) whenever a link failed to resolve.
 */

import { parseTriggerRef, isParamExpression } from './utils/trigger-ref';

export interface SolverEntryInput {
  entryId: string;
  expressions: string[];
  delays: number[];
  /** 1-based variant copy index per iteration (parallel to `expressions`). */
  variants: number[];
  /** Duration per 0-based variant copy index; `null` = not yet known. */
  variantDurations: (number | null)[];
  /** Authored MM:SS (or numeric seconds) hint per iteration — cycle/anchor fallback. */
  authoredTimestamps?: (string | null | undefined)[];
}

export interface SolverEntryResult {
  /** Resolved start time (seconds) per iteration; `null` = unresolved (caller falls back). */
  timestamps: (number | null)[];
  /** Iteration indices whose parent edge was cut to break a cycle. */
  cutIndices: number[];
}

export interface SolverResult {
  byEntry: Record<string, SolverEntryResult>;
  /** Human-readable list of links that could not be honoured. */
  brokenLinks: string[];
  /** Human-readable list of detected cycles (node → parent). */
  cycles: string[];
}

const ABS = /^(\d+):(\d+(?:\.\d+)?)$/;
const EPS = 0.01;

function nodeKey(entryId: string, i: number): string {
  return `${entryId}::${i}`;
}

function parseAbsolute(expr: string): number | null {
  const m = expr.match(ABS);
  if (m) return parseInt(m[1], 10) * 60 + parseFloat(m[2]);
  const n = parseFloat(expr);
  return Number.isNaN(n) ? null : n;
}

function parseAuthored(s: string | null | undefined): number | null {
  if (s === null || s === undefined || s === '') return null;
  return parseAbsolute(s);
}

/** Duration of the variant that plays at `iterIdx` of `entry` (null = unknown). */
function durationAt(entry: SolverEntryInput, iterIdx: number): number | null {
  const variantIdx = (entry.variants[iterIdx] ?? 1) - 1;
  const d = entry.variantDurations[variantIdx] ?? entry.variantDurations[0];
  return d === null || d === undefined ? null : d;
}

export function solveOrchestrateSchedule(entries: SolverEntryInput[]): SolverResult {
  const entryMap = new Map<string, SolverEntryInput>();
  for (const e of entries) entryMap.set(e.entryId, e);
  const knownIds = new Set(entryMap.keys());

  const brokenLinks: string[] = [];
  const cycles: string[] = [];

  // ── Slot classification ─────────────────────────────────────────────────────
  interface RefEdge { entryId: string; iterIdx: number; op: 'after' | 'alignEnd' }
  const absValue = new Map<string, number>();
  const refEdge = new Map<string, RefEdge>();
  const parentOf = new Map<string, string | null>();
  const allKeys: string[] = [];

  for (const entry of entries) {
    entry.expressions.forEach((expr, i) => {
      const key = nodeKey(entry.entryId, i);
      allKeys.push(key);
      const delay = entry.delays[i] ?? 0;

      const abs = parseAbsolute(expr);
      if (abs !== null) {
        absValue.set(key, abs + delay);
        parentOf.set(key, null);
        return;
      }

      const ref = parseTriggerRef(expr, knownIds);
      if (ref) {
        const refEntry = entryMap.get(ref.entryId)!;
        if (ref.iterIdx < 0 || ref.iterIdx >= refEntry.expressions.length) {
          brokenLinks.push(
            `${entry.entryId}[${i}] ${expr} → iteration ${ref.iterIdx + 1} out of range ` +
            `(${refEntry.expressions.length} timestamp${refEntry.expressions.length === 1 ? '' : 's'})`,
          );
          parentOf.set(key, null);
          return;
        }
        const parent = nodeKey(ref.entryId, ref.iterIdx);
        refEdge.set(key, { entryId: ref.entryId, iterIdx: ref.iterIdx, op: ref.op });
        parentOf.set(key, parent);
        return;
      }

      if (isParamExpression(expr)) {
        brokenLinks.push(`${entry.entryId}[${i}] ${expr} → unknown entry`);
      }
      parentOf.set(key, null);
    });
  }

  // ── Cycle detection (DFS colouring over parent edges) ───────────────────────
  const colour = new Map<string, 0 | 1 | 2>();
  const cutEdges = new Set<string>();

  const dfs = (key: string): void => {
    colour.set(key, 1);
    const parent = parentOf.get(key) ?? null;
    if (parent) {
      const c = colour.get(parent) ?? 0;
      if (c === 1) {
        cutEdges.add(key);
        cycles.push(`${key} → ${parent}`);
      } else if (c === 0) {
        dfs(parent);
      }
    }
    colour.set(key, 2);
  };
  for (const key of allKeys) {
    if ((colour.get(key) ?? 0) === 0) dfs(key);
  }

  // ── Topological resolution (Kahn over the DAG with cut edges removed) ────────
  const children = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const key of allKeys) {
    const parent = parentOf.get(key) ?? null;
    const hasLiveParent = parent !== null && !cutEdges.has(key);
    indegree.set(key, hasLiveParent ? 1 : 0);
    if (parent !== null) {
      const list = children.get(parent) ?? [];
      list.push(key);
      children.set(parent, list);
    }
  }

  const resolved = new Map<string, number>();
  let frontier = 0; // furthest end reached by any resolved slot (seconds)

  const endOf = (key: string): number => {
    const ts = resolved.get(key);
    if (ts === undefined) return 0;
    const entry = entryMap.get(key.split('::')[0])!;
    const i = parseInt(key.split('::')[1], 10);
    const d = durationAt(entry, i) ?? 0;
    return ts + d;
  };

  const startFor = (key: string): number | null => {
    if (absValue.has(key)) return absValue.get(key)!;
    if (cutEdges.has(key)) {
      const entry = entryMap.get(key.split('::')[0])!;
      const i = parseInt(key.split('::')[1], 10);
      return parseAuthored(entry.authoredTimestamps?.[i]) ?? frontier ?? 0;
    }
    const edge = refEdge.get(key);
    if (!edge) return null; // no dependency and no absolute anchor → unresolved
    const refStart = resolved.get(nodeKey(edge.entryId, edge.iterIdx));
    if (refStart === undefined) return null;
    const refEntry = entryMap.get(edge.entryId)!;
    const entry = entryMap.get(key.split('::')[0])!;
    const i = parseInt(key.split('::')[1], 10);
    const delay = entry.delays[i] ?? 0;
    if (edge.op === 'after') {
      const refDur = durationAt(refEntry, edge.iterIdx);
      if (refDur === null) return null;
      return refStart + refDur + delay;
    }
    const thisDur = durationAt(entry, i);
    if (thisDur === null) return null;
    return Math.max(0, refStart - thisDur - delay);
  };

  const queue: string[] = allKeys.filter((k) => (indegree.get(k) ?? 0) === 0);
  let guard = 0;
  while (queue.length > 0 && guard++ < allKeys.length * 4) {
    const key = queue.shift()!;
    const start = startFor(key);
    if (start !== null) {
      resolved.set(key, start);
      frontier = Math.max(frontier, endOf(key));
    }
    for (const child of children.get(key) ?? []) {
      const next = (indegree.get(child) ?? 0) - 1;
      indegree.set(child, next);
      if (next <= 0) queue.push(child);
    }
  }

  // ── Validation: every formula-resolved slot must equal its expected value ────
  for (const entry of entries) {
    entry.expressions.forEach((expr, i) => {
      const key = nodeKey(entry.entryId, i);
      const actual = resolved.get(key);
      if (actual === undefined) return;
      const edge = refEdge.get(key);
      if (!edge) return;
      if (cutEdges.has(key)) {
        brokenLinks.push(
          `${entry.entryId}[${i}] ${expr} → cycle broken; anchored at ${actual.toFixed(2)}s`,
        );
        return;
      }
      const refEntry = entryMap.get(edge.entryId)!;
      const refStart = resolved.get(nodeKey(edge.entryId, edge.iterIdx));
      if (refStart === undefined) return;
      const delay = entry.delays[i] ?? 0;
      const expected = edge.op === 'after'
        ? refStart + (durationAt(refEntry, edge.iterIdx) ?? 0) + delay
        : Math.max(0, refStart - (durationAt(entry, i) ?? 0) - delay);
      if (Math.abs(actual - expected) > EPS) {
        brokenLinks.push(
          `${entry.entryId}[${i}] ${expr} → actual=${actual.toFixed(2)}s expected=${expected.toFixed(2)}s`,
        );
      }
    });
  }

  // ── Project per-entry results ───────────────────────────────────────────────
  const byEntry: Record<string, SolverEntryResult> = {};
  for (const entry of entries) {
    const timestamps: (number | null)[] = entry.expressions.map(
      (_, i) => resolved.get(nodeKey(entry.entryId, i)) ?? null,
    );
    const cutIndices: number[] = [];
    entry.expressions.forEach((_, i) => {
      if (cutEdges.has(nodeKey(entry.entryId, i))) cutIndices.push(i);
    });
    byEntry[entry.entryId] = { timestamps, cutIndices };
  }

  return { byEntry, brokenLinks, cycles };
}
