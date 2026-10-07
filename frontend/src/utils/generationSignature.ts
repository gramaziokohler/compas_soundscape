/**
 * Generation signatures — detect, mark and revert "settings edited since the
 * last generation".
 *
 * A signature is a stable JSON snapshot of a per-card-type whitelist of the
 * inputs that actually shape a generated result. It is captured into
 * `config.generatedSignature` when a result is written (generation, simulation
 * run, project restore) and compared against the live config to decide whether
 * a generated card should offer "Regenerate", which fields to mark as modified,
 * and what to restore on "Revert".
 *
 * Fields that change after generation without a user edit (display_name,
 * position, entities, dbfs, orchestrate trigger, error…) are deliberately
 * excluded so they never mark a card dirty.
 *
 * Card types where regenerating makes no sense (uploads, bundled samples,
 * imported IRs, audio / model analysis, placeholders, listeners) return `null`.
 */

import type { CardType } from '@/types/card';

/** Minimal shape every signable config shares. Fields are read defensively per type. */
interface SignableConfig {
  type?: CardType;
  generatedSignature?: string;
  [key: string]: unknown;
}

type SignatureInputs = Record<string, unknown>;

/** Virtual input key: TTS speech lines live in orchestrateMeta / scenarioSource. */
const SPEECH_LINES_KEY = 'speechLines';

interface SignatureSpec {
  /** Top-level config fields that shape the result (restored verbatim on revert). */
  fields: string[];
  /** Object fields whose sub-keys are marked individually (`settings.max_order`). */
  nested?: string[];
  /** Include the TTS speech lines (virtual `speechLines` input). */
  speechLines?: boolean;
}

const SIGNATURE_SPECS: Partial<Record<CardType, SignatureSpec>> = {
  'text-to-audio': {
    fields: ['prompt', 'duration', 'guidance_scale', 'prompt_influence', 'loop', 'seed_copies', 'steps', 'negative_prompt'],
  },
  'text-to-speech': { fields: ['prompt', 'voice_name', 'seed_copies'], speechLines: true },
  library: { fields: ['selectedLibrarySound'] },
  catalog: { fields: ['selectedCatalogSound'] },
  pyroomacoustics: { fields: ['settings', 'speckleMaterialAssignments', 'speckleScatteringAssignments'], nested: ['settings'] },
  choras: { fields: ['settings', 'speckleMaterialAssignments', 'speckleScatteringAssignments'], nested: ['settings'] },
  text: { fields: ['textInput', 'numSounds', 'useAnalysisResult', 'drawnArea'] },
  scenario: { fields: ['userContext', 'peopleCount', 'likeliness', 'timelineDurationMs', 'useAnalysisResult'] },
};

/**
 * Modified-field keys used by editors to mark labels (`useIsFieldModified`).
 * Input keys not listed map to themselves; nested sub-keys become `<field>.<sub>`.
 */
const MARK_KEY_ALIASES: Record<string, string> = {
  [SPEECH_LINES_KEY]: 'prompt',
  speckleMaterialAssignments: 'materials',
  speckleScatteringAssignments: 'materials',
  selectedLibrarySound: 'sound',
  selectedCatalogSound: 'sound',
};

/** JSON.stringify with recursively sorted object keys (map-like fields have unstable order). */
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, val: unknown) => {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const record = val as Record<string, unknown>;
      return Object.keys(record)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = record[k];
          return acc;
        }, {});
    }
    return val;
  });
}

const sameValue = (a: unknown, b: unknown) => stableStringify(a) === stableStringify(b);

function getSpec(config: SignableConfig): SignatureSpec | null {
  return SIGNATURE_SPECS[config.type ?? 'text-to-audio'] ?? null;
}

function getSpeechLines(config: SignableConfig): string[] | undefined {
  const meta = config.orchestrateMeta as { speechLines?: string[] } | undefined;
  const source = config.scenarioSource as { speechLines?: string[] } | undefined;
  return meta?.speechLines ?? source?.speechLines;
}

/** Current generation inputs (undefined values are dropped by the stringify). */
function getSignatureInputs(config: SignableConfig, spec: SignatureSpec): SignatureInputs {
  const inputs: SignatureInputs = {};
  for (const field of spec.fields) inputs[field] = config[field];
  if (spec.speechLines) inputs[SPEECH_LINES_KEY] = getSpeechLines(config);
  return inputs;
}

/** Inputs captured at generation time, or null when there is no (valid) snapshot. */
function getSnapshotInputs(config: SignableConfig): SignatureInputs | null {
  if (config.generatedSignature === undefined) return null;
  try {
    return JSON.parse(config.generatedSignature) as SignatureInputs;
  } catch {
    return null;
  }
}

/** Stable signature of a config's generation inputs, or `null` if the type cannot regenerate. */
export function getGenerationSignature(config: object): string | null {
  const spec = getSpec(config as SignableConfig);
  return spec ? stableStringify(getSignatureInputs(config as SignableConfig, spec)) : null;
}

/**
 * `{ generatedSignature }` patch capturing the config's current inputs — spread
 * into the same store write that stores the result. Empty for non-signable types.
 */
export function captureGenerationSignature(config: object): { generatedSignature?: string } {
  const signature = getGenerationSignature(config);
  return signature !== null ? { generatedSignature: signature } : {};
}

/**
 * True when the config's generation inputs differ from the captured snapshot.
 * A missing snapshot counts as clean (nothing to compare against).
 */
export function isGenerationDirty(config: object): boolean {
  const snapshot = (config as SignableConfig).generatedSignature;
  if (snapshot === undefined) return false;
  const current = getGenerationSignature(config);
  return current !== null && current !== snapshot;
}

/**
 * Keys of the inputs edited since generation, for marking editor labels:
 * plain field names (`duration`, `textInput`…), `settings.<key>` for simulation
 * settings, `materials`, `prompt` (incl. TTS speech lines) and `sound`.
 */
export function getModifiedGenerationFields(config: object): Set<string> {
  const c = config as SignableConfig;
  const modified = new Set<string>();
  const spec = getSpec(c);
  const snapshot = getSnapshotInputs(c);
  if (!spec || !snapshot) return modified;

  const current = getSignatureInputs(c, spec);
  for (const key of Object.keys(current)) {
    if (sameValue(current[key], snapshot[key])) continue;
    if (spec.nested?.includes(key)) {
      const now = (current[key] ?? {}) as Record<string, unknown>;
      const then = (snapshot[key] ?? {}) as Record<string, unknown>;
      for (const sub of new Set([...Object.keys(now), ...Object.keys(then)])) {
        if (!sameValue(now[sub], then[sub])) modified.add(`${key}.${sub}`);
      }
    } else {
      modified.add(MARK_KEY_ALIASES[key] ?? key);
    }
  }
  return modified;
}

/**
 * Config patch restoring the generation-time inputs (only the fields that
 * differ), or `null` when there is nothing to revert. TTS speech lines are
 * written back into whichever container holds them.
 */
export function getGenerationRevertPatch(config: object): Record<string, unknown> | null {
  const c = config as SignableConfig;
  const spec = getSpec(c);
  const snapshot = getSnapshotInputs(c);
  if (!spec || !snapshot) return null;

  const patch: Record<string, unknown> = {};
  for (const field of spec.fields) {
    if (!sameValue(c[field], snapshot[field])) patch[field] = snapshot[field];
  }
  if (spec.speechLines && !sameValue(getSpeechLines(c), snapshot[SPEECH_LINES_KEY])) {
    const lines = snapshot[SPEECH_LINES_KEY] as string[] | undefined;
    const meta = c.orchestrateMeta as { speechLines?: string[] } | undefined;
    const source = c.scenarioSource as { speechLines?: string[] } | undefined;
    if (meta?.speechLines) patch.orchestrateMeta = { ...meta, speechLines: lines };
    else if (source) patch.scenarioSource = { ...source, speechLines: lines };
  }
  return Object.keys(patch).length > 0 ? patch : null;
}
