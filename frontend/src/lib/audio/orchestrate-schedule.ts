/**
 * Strict constraint resolver for orchestrate parametric schedules.
 *
 * Each (entry, iteration) slot is a node. Its timing relation is one of:
 *   - absolute `MM:SS`
 *   - `after(ref[, ref…])`   → start = max(ref.end) + delay
 *   - `alignEnd(ref[, …])`   → end   = min(ref.start) − delay
 *   - `overlap(ref[, …])`    → start = max(ref.start) + delay   (parallel)
 *   - unanchored (empty expression) → keeps a manual timestamp, else excluded.
 *
 * The resolver is exact and single-pass over the (acyclic) graph. It NEVER
 * silently falls back to authored MM:SS times. Instead, anything that cannot be
 * satisfied strictly is EXCLUDED (per iteration) and reported:
 *   - unknown / out-of-range reference
 *   - dependency cycle (the iteration closing the cycle is dropped)
 *   - dependency on an excluded/unresolved iteration
 *   - missing measured duration (once durations are known)
 *   - no timing anchor at all
 *
 * Entries are scoped by `orchestrateId` so duplicate `entryId`s across scenario
 * sets cannot collide.
 */

import { parseTriggerExpression, isParamExpression, type TriggerOp } from './utils/trigger-ref';

export interface SolverEntryInput {
  /** Scenario/orchestrate run id — references resolve within the same scope. */
  orchestrateId?: string;
  entryId: string;
  expressions: string[];
  delays: number[];
  /** 1-based variant copy index per iteration (parallel to `expressions`). */
  variants: number[];
  /** Duration per 0-based variant copy index; `null` = not available. */
  variantDurations: (number | null)[];
  /** False while durations are still theoretical (pre-generation) → defer. */
  durationsKnown?: boolean;
  /** Existing manual timestamps (seconds) — kept for unanchored iterations. */
  manualTimestamps?: (number | null | undefined)[];
}

export interface SolverEntryResult {
  /** Resolved start time (seconds) per iteration; `null` = excluded/unresolved. */
  timestamps: (number | null)[];
  /** Iteration indices dropped because a constraint could not be satisfied. */
  excludedIndices: number[];
}

export interface SolverExclusion {
  orchestrateId: string;
  entryId: string;
  iterationIndex: number;
  reason: string;
}

export interface SolverFallback {
  orchestrateId: string;
  entryId: string;
  iterationIndex: number;
  reason: string;
  timestamp: number;
}

export interface SolverResult {
  /** Keyed by `scheduleEntryKey(orchestrateId, entryId)`. */
  byEntry: Record<string, SolverEntryResult>;
  /** Human-readable list of unresolvable links (informational). */
  brokenLinks: string[];
  /** Detected dependency cycles (node → parent). */
  cycles: string[];
  /** Iterations excluded from the schedule, with reasons. */
  exclusions: SolverExclusion[];
  /**
   * Iterations that could not be satisfied strictly but were placed from the
   * authored / user-edited fallback timestamp. These ARE scheduled (not
   * ghosted) — the caller surfaces a warning so the deviation is visible.
   */
  fallbacks: SolverFallback[];
  /** True when a real duration is still missing — the caller must not write. */
  deferred: boolean;
  deferReason: string | null;
}

const ABS = /^(\d+):(\d+(?:\.\d+)?)$/;
const UNRESOLVED_SENTINEL = 999999;

export function scheduleEntryKey(orchestrateId: string | undefined, entryId: string): string {
  return `${orchestrateId ?? ''}::${entryId}`;
}

function parseAbsolute(expr: string): number | null {
  const m = expr.match(ABS);
  if (m) return parseInt(m[1], 10) * 60 + parseFloat(m[2]);
  const n = parseFloat(expr);
  return Number.isNaN(n) ? null : n;
}

function durationAt(entry: SolverEntryInput, iterIdx: number): number | null {
  const variantIdx = (entry.variants[iterIdx] ?? 1) - 1;
  const d = entry.variantDurations[variantIdx] ?? entry.variantDurations[0];
  return d === null || d === undefined ? null : d;
}

interface ParentEdge {
  key: string; // parent node key
  op: TriggerOp;
}

interface Node {
  entry: SolverEntryInput;
  iterIdx: number;
  key: string;
  absValue: number | null;
  parents: ParentEdge[];
  /** True when the expression is a malformed/unknown param formula. */
  badRef: string | null;
}

export function solveOrchestrateSchedule(entries: SolverEntryInput[]): SolverResult {
  const byEntry: Record<string, SolverEntryResult> = {};
  const brokenLinks: string[] = [];
  const cycles: string[] = [];
  const exclusions: SolverExclusion[] = [];
  const fallbacks: SolverFallback[] = [];
  let deferred = false;
  let deferReason: string | null = null;

  // Group entries by orchestrate scope.
  const groups = new Map<string, SolverEntryInput[]>();
  for (const e of entries) {
    const scope = e.orchestrateId ?? '';
    const list = groups.get(scope) ?? [];
    list.push(e);
    groups.set(scope, list);
  }

  for (const [scope, group] of groups) {
    const entryMap = new Map<string, SolverEntryInput>();
    for (const e of group) entryMap.set(e.entryId, e);
    const knownIds = new Set(entryMap.keys());

    const nodeKey = (entryId: string, i: number): string => `${entryId}::${i}`;
    const nodes = new Map<string, Node>();

    // ── Classify every slot ───────────────────────────────────────────────────
    for (const entry of group) {
      entry.expressions.forEach((expr, i) => {
        const key = nodeKey(entry.entryId, i);
        const node: Node = { entry, iterIdx: i, key, absValue: null, parents: [], badRef: null };
        const delay = entry.delays[i] ?? 0;

        const abs = parseAbsolute(expr);
        if (abs !== null) {
          node.absValue = abs + delay;
          nodes.set(key, node);
          return;
        }

        const parsed = parseTriggerExpression(expr, knownIds);
        if (parsed) {
          for (const ref of parsed.refs) {
            const refEntry = entryMap.get(ref.entryId);
            if (!refEntry || ref.iterIdx < 0 || ref.iterIdx >= refEntry.expressions.length) {
              node.badRef = `${expr} → unknown/out-of-range reference`;
              continue;
            }
            node.parents.push({ key: nodeKey(ref.entryId, ref.iterIdx), op: parsed.op });
          }
          nodes.set(key, node);
          return;
        }

        // Any non-empty expression that is neither a parseable absolute time nor a
        // valid op(...) formula is a malformed link (e.g. the literal "absolute"
        // the LLM sometimes emits). Report it so it is excluded + surfaced instead
        // of silently falling through to "no timing anchor". An EMPTY expression is
        // not malformed — it means the user cleared the trigger (manual schedule).
        if (expr.trim()) {
          node.badRef = isParamExpression(expr)
            ? `${expr} → could not be parsed`
            : `${expr} → malformed expression`;
        }
        nodes.set(key, node);
      });
    }

    const excluded = new Map<string, string>(); // nodeKey → reason
    // Resolved start time per node, declared before cycle detection because
    // fallback placement can resolve a node mid-traversal.
    const resolved = new Map<string, number>();

    /** Authored / user-edited timestamp available as a fallback for a slot. */
    const fallbackTimestamp = (node: Node): number | null => {
      const m = node.entry.manualTimestamps?.[node.iterIdx];
      if (m != null && m < UNRESOLVED_SENTINEL && m >= 0) return m;
      return null;
    };

    const exclude = (key: string, reason: string): void => {
      if (excluded.has(key)) return;
      excluded.set(key, reason);
      const node = nodes.get(key);
      exclusions.push({
        orchestrateId: scope,
        entryId: node?.entry.entryId ?? key.split('::')[0],
        iterationIndex: node?.iterIdx ?? parseInt(key.split('::')[1], 10),
        reason,
      });
    };

    /**
     * A slot that cannot be satisfied strictly is placed from its authored /
     * user-edited fallback timestamp when one exists (recorded as a fallback —
     * still scheduled, but surfaced as a warning). Only slots with no fallback
     * at all are truly excluded (dropped + ghosted).
     */
    const placeOrExclude = (key: string, reason: string): void => {
      if (excluded.has(key) || resolved.has(key)) return;
      const node = nodes.get(key);
      const fb = node ? fallbackTimestamp(node) : null;
      if (node && fb !== null) {
        resolved.set(key, fb);
        fallbacks.push({
          orchestrateId: scope,
          entryId: node.entry.entryId,
          iterationIndex: node.iterIdx,
          reason,
          timestamp: fb,
        });
        return;
      }
      exclude(key, reason);
    };

    // Bad references → exclude immediately (or fall back to the authored time).
    for (const [key, node] of nodes) {
      if (node.badRef) {
        placeOrExclude(key, node.badRef);
        brokenLinks.push(`${node.entry.entryId}[${node.iterIdx}] ${node.badRef}`);
      }
    }

    // ── Cycle detection (DFS colouring over parent edges) ─────────────────────
    // A back-edge child closes a cycle → exclude that child iteration.
    {
      const colour = new Map<string, 0 | 1 | 2>();
      const dfs = (key: string): void => {
        if (excluded.has(key)) return;
        colour.set(key, 1);
        const node = nodes.get(key);
        if (node) {
          for (const parent of node.parents) {
            if (excluded.has(parent.key)) continue;
            const c = colour.get(parent.key) ?? 0;
            if (c === 1) {
              cycles.push(`${key} → ${parent.key}`);
              // Both endpoints of the cycle are unsatisfiable. Placing BOTH at
              // their authored times keeps the authored order intact (falling
              // back only the child would let the ancestor resolve strictly from
              // an unrelated parent and invert/overlap the authored sequence).
              placeOrExclude(key, `cycle broken (${key} → ${parent.key})`);
              placeOrExclude(parent.key, `cycle broken (${key} → ${parent.key})`);
            } else if (c === 0) {
              dfs(parent.key);
            }
          }
        }
        colour.set(key, 2);
      };
      for (const key of nodes.keys()) {
        if ((colour.get(key) ?? 0) === 0) dfs(key);
      }
    }

    // ── Propagate exclusions: a node depending on an excluded node is excluded ─
    {
      let changed = true;
      while (changed) {
        changed = false;
        for (const [key, node] of nodes) {
          if (excluded.has(key) || resolved.has(key)) continue;
          const badParent = node.parents.find((p) => excluded.has(p.key));
          if (badParent) {
            placeOrExclude(key, `dependency excluded (${badParent.key})`);
            changed = true;
          }
        }
      }
    }

    // ── Resolve the remaining DAG (multi-parent, single pass fixpoint) ────────
    const endOf = (key: string): number => {
      const start = resolved.get(key);
      const node = nodes.get(key);
      if (start === undefined || !node) return 0;
      return start + (durationAt(node.entry, node.iterIdx) ?? 0);
    };

    const resolveNode = (node: Node): number | 'wait' | 'exclude' | 'defer' => {
      if (node.absValue !== null) return node.absValue;

      if (node.parents.length === 0) {
        const manual = node.entry.manualTimestamps?.[node.iterIdx];
        if (manual != null && manual < UNRESOLVED_SENTINEL && manual >= 0) return manual;
        // No anchor at all — cannot place this iteration.
        return 'exclude';
      }

      const delay = node.entry.delays[node.iterIdx] ?? 0;
      const op = node.parents[0].op;

      const starts: number[] = [];
      const ends: number[] = [];
      for (const parent of node.parents) {
        const ps = resolved.get(parent.key);
        if (ps === undefined) return 'wait';
        starts.push(ps);
        ends.push(endOf(parent.key));
      }

      if (op === 'overlap') return Math.max(...starts) + delay;

      if (op === 'after') {
        for (const parent of node.parents) {
          const parentNode = nodes.get(parent.key);
          if (!parentNode) return 'wait';
          if (parentNode.entry.durationsKnown === false) return 'defer';
          if (durationAt(parentNode.entry, parentNode.iterIdx) === null) return 'exclude';
        }
        return Math.max(...ends) + delay;
      }

      // alignEnd: this iteration ends `delay` before the earliest referenced start.
      if (node.entry.durationsKnown === false) return 'defer';
      const thisDur = durationAt(node.entry, node.iterIdx);
      if (thisDur === null) return 'exclude';
      return Math.max(0, Math.min(...starts) - thisDur - delay);
    };

    let changed = true;
    let guard = 0;
    while (changed && guard++ < nodes.size * 4) {
      changed = false;
      for (const [key, node] of nodes) {
        if (excluded.has(key) || resolved.has(key)) continue;
        const result = resolveNode(node);
        if (result === 'wait') continue;
        if (result === 'defer') {
          // A real duration is still missing, but if the slot has an authored /
          // user-edited time, place it there (scheduled + warning) instead of
          // deferring the whole bake.
          const fb = fallbackTimestamp(node);
          if (fb !== null) {
            resolved.set(key, fb);
            fallbacks.push({
              orchestrateId: scope,
              entryId: node.entry.entryId,
              iterationIndex: node.iterIdx,
              reason: 'missing measured duration — authored time used',
              timestamp: fb,
            });
            changed = true;
            continue;
          }
          deferred = true;
          deferReason = deferReason ?? `missing measured duration for ${node.entry.entryId}[${node.iterIdx}]`;
          continue;
        }
        if (result === 'exclude') {
          const hasRealParents = node.parents.length > 0;
          const reason = hasRealParents
            ? 'missing measured duration'
            : 'no timing anchor';
          placeOrExclude(key, reason);
          changed = true;
          continue;
        }
        resolved.set(key, result);
        changed = true;
      }
    }

    if (deferred) {
      // Do not persist a partial schedule; the caller re-bakes once durations exist.
      break;
    }

    // Leftovers that neither resolved nor were excluded: place from the authored
    // fallback if available, otherwise exclude.
    for (const [key, node] of nodes) {
      if (resolved.has(key) || excluded.has(key)) continue;
      placeOrExclude(key, node.parents.length > 0 ? 'unresolved dependency' : 'no timing anchor');
    }

    // ── Project per-entry results ─────────────────────────────────────────────
    for (const entry of group) {
      const timestamps: (number | null)[] = entry.expressions.map(
        (_, i) => resolved.get(nodeKey(entry.entryId, i)) ?? null,
      );
      const excludedIndices: number[] = [];
      entry.expressions.forEach((_, i) => {
        if (excluded.has(nodeKey(entry.entryId, i))) excludedIndices.push(i);
      });
      byEntry[scheduleEntryKey(scope, entry.entryId)] = { timestamps, excludedIndices };
    }
  }

  return { byEntry, brokenLinks, cycles, exclusions, fallbacks, deferred, deferReason };
}
