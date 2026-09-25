/**
 * Same-track overlap serialization.
 *
 * A single sound track can never have two iterations playing at once, so any
 * two resolved iterations whose intervals overlap are serialized: the later one
 * is pushed to the previous one's end. This applies to parametric slots too —
 * two iterations of one entry anchored to the same reference would otherwise
 * stack silently.
 *
 * Pure and side-effect free so it can be unit-tested; the DAW bake applies the
 * returned starts and counts how many PARAM slots it had to nudge (those deviate
 * from the LLM's formula and are surfaced as a warning).
 */

export interface SerializeOverlapsResult {
  /** Adjusted start per slot; `null` slots are left untouched. */
  starts: (number | null)[];
  /** Number of parametric slots that were nudged (their formula was not honoured). */
  paramNudges: number;
}

export function serializeTrackOverlaps(
  starts: (number | null)[],
  durations: number[],
  paramFlags: boolean[],
  maxPasses = 100,
): SerializeOverlapsResult {
  const out = [...starts];
  // Count each parametric SLOT once, even if a later pass nudges it again.
  const nudgedParams = new Set<number>();
  let changed = true;
  let pass = 0;

  while (changed && pass++ < maxPasses) {
    changed = false;
    const order = out
      .map((s, i) => ({ i, s, d: durations[i] ?? 0, p: paramFlags[i] ?? false }))
      .filter((o) => o.s !== null && o.d > 0)
      .sort((a, b) => (a.s as number) - (b.s as number));

    for (let k = 1; k < order.length; k++) {
      const prev = order[k - 1];
      const curr = order[k];
      const prevEnd = (prev.s as number) + prev.d;
      if (prevEnd > (curr.s as number) + 0.001) {
        out[curr.i] = parseFloat(prevEnd.toFixed(3));
        if (curr.p) nudgedParams.add(curr.i);
        changed = true;
      }
    }
  }

  return { starts: out, paramNudges: nudgedParams.size };
}
