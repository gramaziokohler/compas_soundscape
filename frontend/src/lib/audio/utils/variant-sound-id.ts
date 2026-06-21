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

/** Build the sound ID for a specific variant copy from the primary timeline sound ID. */
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
