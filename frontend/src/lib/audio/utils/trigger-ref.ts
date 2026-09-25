/**
 * Shared parser for orchestrate parametric triggers.
 *
 * Operators:
 *   after(a#1 [, b#2 …])    → sequential: start = max(ref.end) + delay
 *   alignEnd(a#1 [, …])     → pre-action: end = min(ref.start) − delay
 *   overlap(a#1 [, …])      → parallel:  start = max(ref.start) + delay (may overlap)
 *
 * `afterAll` / `overlapAll` / `beforeAll` are accepted aliases for the explicit
 * multi-reference (join) intent — they normalize to `after` / `overlap` /
 * `alignEnd` respectively. Multiple comma-separated refs are always allowed.
 *
 * Reference resolution is LOOKUP-FIRST: the whole argument is tried as an entry
 * id before any `_<n>` suffix is peeled. Entry ids themselves end in
 * `_<scenarioIndex>` (e.g. `Marcus_1`), so a bare `after(Marcus_1)` must resolve
 * to entry `Marcus_1`, iteration 1 — not to a nonexistent entry `Marcus`.
 * `entryId#<iteration>` (1-based) is the unambiguous canonical form.
 */

export type TriggerOp = 'after' | 'alignEnd' | 'overlap';

export interface TriggerRef {
  op: TriggerOp;
  entryId: string;
  /** 0-based iteration index into the referenced entry's timestamps array. */
  iterIdx: number;
}

export interface TriggerExpression {
  op: TriggerOp;
  refs: TriggerRef[];
}

const OPS = /^(afterAll|overlapAll|beforeAll|after|alignEnd|overlap)\((.+)\)$/;
const TRAILING_ITER = /^(.*)_(\d+)$/;
const HASH_ITER = /^(.*)#(\d+)$/;

const ALIASES: Record<string, TriggerOp> = {
  after: 'after',
  afterAll: 'after',
  alignEnd: 'alignEnd',
  beforeAll: 'alignEnd',
  overlap: 'overlap',
  overlapAll: 'overlap',
};

function parseRefArg(arg: string, knownEntryIds: ReadonlySet<string>): TriggerRef | null {
  const trimmed = arg.trim();
  if (!trimmed) return null;

  // 1) Whole argument is an entry id → first (only) iteration.
  if (knownEntryIds.has(trimmed)) return { op: 'after', entryId: trimmed, iterIdx: 0 };

  // 2) Canonical explicit iteration marker `entryId#N` (1-based).
  const hash = trimmed.match(HASH_ITER);
  if (hash && knownEntryIds.has(hash[1])) {
    return { op: 'after', entryId: hash[1], iterIdx: Math.max(0, parseInt(hash[2], 10) - 1) };
  }

  // 3) Legacy explicit suffix `entryId_N` (1-based).
  const trailing = trimmed.match(TRAILING_ITER);
  if (trailing && knownEntryIds.has(trailing[1])) {
    return { op: 'after', entryId: trailing[1], iterIdx: Math.max(0, parseInt(trailing[2], 10) - 1) };
  }

  return null;
}

/**
 * Resolve an `after(...)` / `alignEnd(...)` / `overlap(...)` expression to its
 * operator and concrete reference list.
 *
 * @returns The parsed expression, or `null` when it is not a param formula or
 *          any reference is unknown (a broken link the caller must report /
 *          exclude — never silently fall back).
 */
export function parseTriggerExpression(
  expr: string | null | undefined,
  knownEntryIds: ReadonlySet<string>,
): TriggerExpression | null {
  if (!expr) return null;
  const outer = expr.match(OPS);
  if (!outer) return null;
  const op = ALIASES[outer[1]];
  if (!op) return null;

  const rawRefs = outer[2].split(',');
  const refs: TriggerRef[] = [];
  for (const raw of rawRefs) {
    const ref = parseRefArg(raw, knownEntryIds);
    if (!ref) return null;
    refs.push({ ...ref, op });
  }
  if (refs.length === 0) return null;
  return { op, refs };
}

/** First reference of a param expression (single-ref convenience). */
export function parseTriggerRef(
  expr: string | null | undefined,
  knownEntryIds: ReadonlySet<string>,
): TriggerRef | null {
  const parsed = parseTriggerExpression(expr, knownEntryIds);
  return parsed?.refs[0] ?? null;
}

/** True when the expression is a (well-formed or broken) param formula. */
export function isParamExpression(expr: string | null | undefined): boolean {
  return !!expr && OPS.test(expr);
}
