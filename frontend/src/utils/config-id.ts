/**
 * Stable identity for a sound-generation card.
 *
 * Array position (`prompt_index`) is NOT a valid identity: it is reshuffled by
 * removals, duplicates and model-scene switches, and a fresh card can inherit
 * the index of an already-generated card — making it render as "already
 * generated". Every config (and every event it produces) carries a `config_id`
 * so generated-state is matched by identity, never by position.
 */
export function newConfigId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `cfg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Sound-event id keyed on the owning card's `config_id`:
 * `{prefix}_{cardKey}_{copy}`, or `{prefix}_{cardKey}_{copy}_{suffix}` (TTS voice).
 *
 * Ids must never embed the card index: removals shift `prompt_index` but not
 * ids, so a card created later at a recycled index would produce the same id
 * and the id-keyed merges would silently replace another card's sounds.
 *
 * Parsers split ids on `_` (copy = last segment, TTS copy = third segment —
 * see lib/audio/utils/variant-sound-id.ts), so `_` in the key is replaced.
 * A card without a `config_id` (should not happen — every creation path and
 * the loader stamp one) gets a fresh key: unique, so it can never collide.
 */
export function cardEventId(
  prefix: string,
  configId: string | undefined,
  copyIndex: number,
  suffix?: string,
): string {
  const cardKey = (configId || newConfigId()).replace(/_/g, '-');
  const id = `${prefix}_${cardKey}_${copyIndex}`;
  return suffix ? `${id}_${suffix}` : id;
}

/**
 * Re-key a sound-event id onto a copied card's `config_id`, keeping the id's
 * shape (prefix, copy segment, TTS voice suffix, `sed-` / `duplicate-` forms)
 * so every id parser reads the copy exactly like the source.
 *
 * - The source card key appears in the id → swapped for the new key.
 * - Legacy `{prefix}_{cardIndex}_{copy}…` ids → the card segment is replaced.
 * - Anything else → a fresh `generated_{newKey}_{copy}` id.
 */
export function remapEventIdToConfig(
  id: string,
  oldConfigId: string | undefined,
  newConfigId: string,
  copyIndex: number,
): string {
  const newKey = newConfigId.replace(/_/g, '-');
  const oldKey = oldConfigId?.replace(/_/g, '-');
  if (oldKey && id.includes(oldKey)) return id.replace(oldKey, newKey);
  const parts = id.split('_');
  if (parts.length >= 3) {
    parts[1] = newKey;
    return parts.join('_');
  }
  return cardEventId('generated', newConfigId, copyIndex);
}

/**
 * `prompt_index → config_id` map stored on an in-flight job record, so job
 * recovery can re-key backend results with `cardEventId`. Entries without a
 * `config_id` are skipped.
 */
export function configIdsByPromptIndex(
  entries: ReadonlyArray<readonly [number, string | undefined]>,
): Record<number, string> {
  const map: Record<number, string> = {};
  for (const [promptIndex, configId] of entries) {
    if (configId) map[promptIndex] = configId;
  }
  return map;
}
