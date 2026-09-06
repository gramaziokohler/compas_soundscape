/**
 * Helpers for mapping a primary timeline sound ID to per-variant copy IDs.
 * Primary ID = lowest copy_index for a prompt (e.g. generated_4_0, tts_9_0_Kore).
 */

/** Parse the 0-based copy/variant index from a sound id or explicit field. */
export function parseSoundCopyIndex(soundId: string, copyIndex?: number | null): number {
  if (copyIndex !== undefined && copyIndex !== null) return copyIndex;

  const parts = soundId.split('_');
  if (parts[0] === 'tts' && parts.length >= 4) {
    const n = parseInt(parts[2], 10);
    return Number.isNaN(n) ? 0 : n;
  }
  if (parts[0] === 'generated' && parts.length >= 3) {
    const n = parseInt(parts[parts.length - 1], 10);
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

/**
 * Build the sound ID for a specific variant copy from the primary timeline sound ID,
 * by PARSING the id's string shape (`generated_{card}_{copy}`, `tts_{card}_{copy}_{voice}`).
 *
 * This only works for ids with one of those two shapes. Duplicated/copied tracks get
 * ids like `duplicate-{n}-{v}-{ts}` or `sed-{pi}-{vi}-{ts}` — this function silently
 * returns `primarySoundId` unchanged for those, which is why applying a variant to a
 * copied track appeared to "revert": the id shape didn't match either branch.
 *
 * Prefer `resolveVariantSoundIdByPrompt` (below) wherever the full generated-sound
 * list is available — it resolves by explicit `prompt_index` + `copy_index` grouping
 * instead of id shape, so it works for every id shape uniformly.
 */
export function resolveVariantSoundId(primarySoundId: string, variantIndex: number): string {
  const parts = primarySoundId.split('_');
  if (parts[0] === 'generated' && parts.length >= 3) {
    const p = [...parts];
    p[p.length - 1] = String(variantIndex);
    return p.join('_');
  }
  if (parts[0] === 'tts' && parts.length >= 4) {
    const p = [...parts];
    p[2] = String(variantIndex);
    return p.join('_');
  }
  return primarySoundId;
}

/**
 * Resolve a variant sound id by explicit `prompt_index` + `copy_index` grouping,
 * instead of parsing the primary id's string shape. This is what makes variant
 * resolution correct for EVERY id shape — including `duplicate-*`/`sed-*` ids from
 * copied or AI-detected tracks — because it never inspects the id's characters at
 * all: it just looks up the Nth-lowest-copy_index sibling that shares this track's
 * `prompt_index`.
 *
 * @param primarySoundId - the track's primary (lowest copy_index) sound id, used as
 *   the fallback when no sibling is found (e.g. the variant hasn't generated yet)
 * @param variantIndex - 0-based variant index to resolve
 * @param promptIndex - the track's `prompt_index` (groups all its variants together)
 * @param allEvents - every generated sound event (or any superset containing this
 *   track's siblings) — typically the full `soundscapeData` / `generatedSounds` array
 */
export function resolveVariantSoundIdByPrompt(
  primarySoundId: string,
  variantIndex: number,
  promptIndex: number | undefined,
  allEvents: ReadonlyArray<{ id: string; prompt_index?: number | null; copy_index?: number | null }>,
): string {
  if (promptIndex === undefined || promptIndex === null || variantIndex === 0) {
    // Variant 0 IS the primary by definition (lowest copy_index) — no lookup needed,
    // and this keeps the function a safe no-op when prompt_index is unknown.
    return primarySoundId;
  }

  const siblings = allEvents
    .filter((e) => e.prompt_index === promptIndex)
    .map((e) => ({ id: e.id, copyIdx: parseSoundCopyIndex(e.id, e.copy_index) }))
    .sort((a, b) => a.copyIdx - b.copyIdx);

  return siblings[variantIndex]?.id ?? primarySoundId;
}
