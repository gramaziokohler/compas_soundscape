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
