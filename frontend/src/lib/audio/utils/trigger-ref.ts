/**
 * Shared parser for orchestrate parametric triggers — `after(<ref>)` and
 * `alignEnd(<ref>)`.
 *
 * WHY THIS EXISTS
 * ---------------
 * The previous parser (`/^(after|alignEnd)\((.+)_(\d+)\)$/`) always peeled the
 * trailing `_<n>` off the argument and treated it as the iteration index. Entry
 * ids themselves end in `_<scenarioIndex>` (e.g. `Marcus_1`, `footsteps_concrete_1`),
 * so a bare reference to a single-occurrence entry (`after(Marcus_1)`) was
 * silently dereferenced to a nonexistent entry (`"Marcus"`), the link was
 * dropped, and the schedule fell back to the authored MM:SS timestamps — which
 * overlap once real audio durations are known.
 *
 * Resolution is therefore LOOKUP-FIRST: the whole argument is tried as an
 * entry id before any `_<n>` suffix is peeled. This disambiguates `after(Marcus_1)`
 * (entry `Marcus_1`, iteration 1) from `after(footsteps_concrete_1_2)`
 * (entry `footsteps_concrete_1`, iteration 2).
 *
 * A new canonical form `entryId#iteration` (1-based) is also accepted so the
 * backend prompt can emit references that are unambiguous even when an entry id
 * happens to end in `_<n>` and another entry shares its base.
 */

export type TriggerOp = 'after' | 'alignEnd';

export interface TriggerRef {
  op: TriggerOp;
  entryId: string;
  /** 0-based iteration index into the referenced entry's timestamps array. */
  iterIdx: number;
}

const PAREN = /^(after|alignEnd)\((.+)\)$/;
const TRAILING_ITER = /^(.*)_(\d+)$/;
const HASH_ITER = /^(.*)#(\d+)$/;

/**
 * Resolve an `after(...)` / `alignEnd(...)` expression to a concrete
 * `{ op, entryId, iterIdx }`.
 *
 * @param expr          Raw trigger expression (may be `''`, `null`, or `undefined`).
 * @param knownEntryIds Every entry id present in the schedule (used for lookup-first).
 * @returns The resolved reference, or `null` when the expression is not a param
 *          formula or points at an unknown entry (a broken link the caller should
 *          report — never silently fall back).
 */
export function parseTriggerRef(
  expr: string | null | undefined,
  knownEntryIds: ReadonlySet<string>,
): TriggerRef | null {
  if (!expr) return null;
  const outer = expr.match(PAREN);
  if (!outer) return null;
  const op = outer[1] as TriggerOp;
  const arg = outer[2].trim();
  if (!arg) return null;

  // 1) Whole argument is an entry id → first (only) iteration.
  //    Resolves `after(Marcus_1)`, `alignEnd(Lucas_1)`.
  if (knownEntryIds.has(arg)) return { op, entryId: arg, iterIdx: 0 };

  // 2) Canonical explicit iteration marker `entryId#N` (1-based).
  const hash = arg.match(HASH_ITER);
  if (hash && knownEntryIds.has(hash[1])) {
    return { op, entryId: hash[1], iterIdx: Math.max(0, parseInt(hash[2], 10) - 1) };
  }

  // 3) Legacy explicit suffix `entryId_N` (1-based). Only applies when the base
  //    is a known entry — otherwise the reference is broken.
  const trailing = arg.match(TRAILING_ITER);
  if (trailing && knownEntryIds.has(trailing[1])) {
    return { op, entryId: trailing[1], iterIdx: Math.max(0, parseInt(trailing[2], 10) - 1) };
  }

  return null;
}

/** True when the expression is a (well-formed or broken) `after()`/`alignEnd()` formula. */
export function isParamExpression(expr: string | null | undefined): boolean {
  return !!expr && PAREN.test(expr);
}
