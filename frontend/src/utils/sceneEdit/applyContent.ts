/**
 * Content and speech ops of the scene edit chat. The synchronous part edits the
 * cards; audio work (new cards, new prompts, extra variants, rewritten lines) is
 * queued in `ctx.regen` and run by sceneEditStore after the undo step closes.
 */

import { useSoundscapeStore } from '@/store';
import type { SceneEditOp } from '@/types/sceneEdit';
import type { SoundGenerationConfig } from '@/types';
import type { ScenarioSource } from '@/types/analysis';
import {
  DEFAULT_BACKGROUND_DURATION_SECONDS,
  DEFAULT_DBFS,
  SCENE_EDIT,
  SIMPLE_MODE,
  TTS_VOICES,
  resolveVoiceForCharacter,
} from '@/utils/constants';
import { newConfigId } from '@/utils/config-id';
import { cleanStyle } from '@/utils/ttsStyle';
import { applyMixOp } from './applyMix';
import { configAt, patchConfig, resolveTargets, type SceneEditApplyContext } from './applyContext';
import { resolvePlacement } from './applySpace';
import {
  cardEvents,
  cardSpeechLines,
  formatMmSs,
  isBackgroundCategory,
  isSpeechCard,
  sceneScenarioAt,
  type Vec3,
} from './sceneCards';

/** Guidance used for scenario-derived cards (page.tsx handleSendAnalysisToGeneration). */
const SCENARIO_CARD_GUIDANCE = 0.9;
const SPEECH_CATEGORY = 'speech';
const ENTRY_ID_PREFIX = 'edit';

function entryIdFor(name: string, existing: Set<string>): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'sound';
  let n = 1;
  while (existing.has(`${ENTRY_ID_PREFIX}_${slug}_${n}`)) n += 1;
  return `${ENTRY_ID_PREFIX}_${slug}_${n}`;
}

function sceneEntryIds(usageIndex: number): Set<string> {
  return new Set(
    useSoundscapeStore.getState().soundConfigs
      .filter((c) => c.parentUsageOriginalIndex === usageIndex)
      .map((c) => c.scenarioSource?.entryId)
      .filter((id): id is string => !!id),
  );
}

/** Place for a new card: the agent's position (the backend drops add ops without one). */
function newCardPosition(op: SceneEditOp): Vec3 | undefined {
  return resolvePlacement(op) ?? undefined;
}

/** Append a scenario-derived card to the scene and register its ref. */
function addCard(ctx: SceneEditApplyContext, op: SceneEditOp, config: SoundGenerationConfig, name: string): void {
  useSoundscapeStore.getState().appendSoundConfigs([config]);
  const configId = config.config_id as string;
  ctx.refMap.cards[op.new_ref] = configId;
  ctx.names[op.new_ref] = name;
  ctx.regen.generateNew.add(configId);
  ctx.needsOrchestrate = true;
}

function baseSource(ctx: SceneEditApplyContext, entryId: string): ScenarioSource | undefined {
  const scenarioId = sceneScenarioAt(ctx.usageIndex)?.scenarioId;
  if (!scenarioId) return undefined;
  return {
    scenarioId,
    foleyId: null,
    speechId: null,
    entryId,
    isSpeech: false,
    copyCount: 1,
    soundName: '',
    description: '',
    category: '',
    duration: '',
    timestamps: [],
    objectsInvolved: [],
    position: [],
    character: '',
    script: '',
    speechLines: [],
  };
}

function addSound(ctx: SceneEditApplyContext, op: SceneEditOp): boolean {
  const background = isBackgroundCategory(op.category);
  const durationS = background
    ? DEFAULT_BACKGROUND_DURATION_SECONDS
    : op.duration_s ?? SCENE_EDIT.DEFAULT_SOUND_DURATION_S;
  const copies = background ? 1 : Math.max(1, op.count ?? 1);
  const timestamps = background ? [] : op.times_s.map(formatMmSs);
  const position = newCardPosition(op);
  const base = baseSource(ctx, entryIdFor(op.name, sceneEntryIds(ctx.usageIndex)));
  const config: SoundGenerationConfig = {
    config_id: newConfigId(),
    prompt: op.prompt,
    duration: durationS,
    guidance_scale: SCENARIO_CARD_GUIDANCE,
    negative_prompt: '',
    seed_copies: copies,
    steps: SIMPLE_MODE.DIFFUSION_STEPS,
    dbfs: DEFAULT_DBFS,
    interval_seconds: background ? 0 : SCENE_EDIT.DEFAULT_SOUND_DURATION_S,
    display_name: op.name,
    category: op.category,
    parentUsageOriginalIndex: ctx.usageIndex,
    ...(position ? { position } : {}),
    ...(timestamps.length ? { timestamps } : {}),
    ...(base ? {
      scenarioSource: {
        ...base,
        copyCount: copies,
        soundName: op.name,
        description: op.prompt,
        category: op.category,
        duration: formatMmSs(durationS),
        timestamps,
        position: position ?? [],
      },
    } : {}),
  };
  addCard(ctx, op, config, op.name);
  return true;
}

function addSpeaker(ctx: SceneEditApplyContext, op: SceneEditOp): boolean {
  const voiceName = resolveVoiceForCharacter(op.character) ?? TTS_VOICES[0].value;
  const timestamps = op.times_s.map(formatMmSs);
  const position = newCardPosition(op);
  const base = baseSource(ctx, entryIdFor(op.character, sceneEntryIds(ctx.usageIndex)));
  const style = cleanStyle(op.style);
  const config: SoundGenerationConfig = {
    config_id: newConfigId(),
    type: 'text-to-speech',
    prompt: op.lines[0],
    duration: SCENE_EDIT.DEFAULT_SOUND_DURATION_S,
    guidance_scale: SCENARIO_CARD_GUIDANCE,
    negative_prompt: '',
    seed_copies: op.lines.length,
    steps: SIMPLE_MODE.DIFFUSION_STEPS,
    // The backend proposes a level for a styled speaker (a whisper plays quieter).
    dbfs: op.db ?? DEFAULT_DBFS,
    interval_seconds: SCENE_EDIT.DEFAULT_SOUND_DURATION_S,
    display_name: op.character,
    category: SPEECH_CATEGORY,
    voice_name: voiceName,
    ...(style ? { voice_style: style } : {}),
    parentUsageOriginalIndex: ctx.usageIndex,
    ...(position ? { position } : {}),
    ...(timestamps.length ? { timestamps } : {}),
    ...(base ? {
      scenarioSource: {
        ...base,
        isSpeech: true,
        copyCount: op.lines.length,
        soundName: op.character,
        description: op.lines.join('; '),
        category: SPEECH_CATEGORY,
        timestamps,
        position: position ?? [],
        character: op.character,
        script: op.lines.join('; '),
        speechLines: op.lines,
        voiceName,
        ...(style ? { voiceStyle: style } : {}),
      },
    } : {}),
  };
  addCard(ctx, op, config, op.character);
  return true;
}

function remove(ctx: SceneEditApplyContext, op: SceneEditOp): boolean {
  const indices = resolveTargets(ctx, op);
  if (indices.length === 0) return false;
  useSoundscapeStore.getState().handleRemoveConfigs(indices);
  ctx.needsOrchestrate = true;
  return true;
}

function changeSound(ctx: SceneEditApplyContext, op: SceneEditOp): boolean {
  let applied = false;
  resolveTargets(ctx, op).forEach((index) => {
    const config = configAt(index);
    if (!config?.config_id) return;
    if (isSpeechCard(config)) {
      ctx.warnings.push(`${config.display_name ?? 'A speaker'} is speech — its lines are edited instead`);
      return;
    }
    const patch: Partial<SoundGenerationConfig> = {};
    if (op.prompt) patch.prompt = op.prompt;
    if (op.duration_s !== null) patch.duration = op.duration_s;
    if (config.scenarioSource) {
      patch.scenarioSource = {
        ...config.scenarioSource,
        description: op.prompt || config.scenarioSource.description,
        duration: op.duration_s !== null ? formatMmSs(op.duration_s) : config.scenarioSource.duration,
      };
    }
    patchConfig(index, patch);
    ctx.regen.force.add(config.config_id);
    applied = true;
  });
  if (applied) ctx.needsOrchestrate = true;
  return applied;
}

function regenerate(ctx: SceneEditApplyContext, op: SceneEditOp): boolean {
  const indices = resolveTargets(ctx, op);
  indices.forEach((index) => {
    const id = configAt(index)?.config_id;
    if (id) ctx.regen.force.add(id);
  });
  if (indices.length > 0) ctx.needsOrchestrate = true;
  return indices.length > 0;
}

function setVariants(ctx: SceneEditApplyContext, op: SceneEditOp): boolean {
  const count = op.count ?? 1;
  let applied = false;
  resolveTargets(ctx, op).forEach((index) => {
    const config = configAt(index);
    if (!config?.config_id) return;
    if (isSpeechCard(config)) {
      ctx.warnings.push(`${config.display_name ?? 'A speaker'}: speech has one take per line`);
      return;
    }
    const events = cardEvents(index);
    const sourcePatch = config.scenarioSource ? { scenarioSource: { ...config.scenarioSource, copyCount: count } } : {};
    if (events.length === 0) {
      patchConfig(index, { seed_copies: count, ...sourcePatch });
    } else if (count > events.length) {
      // seed_copies follows once the extra copies exist (sceneEditStore).
      if (config.scenarioSource) patchConfig(index, sourcePatch);
      ctx.regen.addCopies.set(config.config_id, count - events.length);
    } else if (count < events.length) {
      const store = useSoundscapeStore.getState();
      for (let v = events.length - 1; v >= count; v -= 1) void store.handleDeleteVariant(index, v);
      if (config.scenarioSource) patchConfig(index, sourcePatch);
    } else {
      return;
    }
    applied = true;
  });
  if (applied) ctx.needsOrchestrate = true;
  return applied;
}

function editLines(ctx: SceneEditApplyContext, op: SceneEditOp): boolean {
  let applied = false;
  resolveTargets(ctx, op).forEach((index) => {
    const config = configAt(index);
    if (!config?.config_id || !isSpeechCard(config)) return;
    const before = cardSpeechLines(config);
    const lines = op.lines;
    const patch: Partial<SoundGenerationConfig> = { prompt: lines[0] };
    if (config.scenarioSource) {
      patch.scenarioSource = {
        ...config.scenarioSource,
        speechLines: lines,
        script: lines.join('; '),
        description: lines.join('; '),
        copyCount: lines.length,
      };
    }
    if (config.orchestrateMeta) patch.orchestrateMeta = { ...config.orchestrateMeta, speechLines: lines };
    if (lines.length !== before.length) patch.seed_copies = lines.length;
    patchConfig(index, patch);
    if (lines.length !== before.length || cardEvents(index).length !== before.length) {
      ctx.regen.force.add(config.config_id);
    } else {
      const changed = lines.flatMap((l, i) => (l !== before[i] ? [i] : []));
      if (changed.length) ctx.regen.inPlaceLines.set(config.config_id, changed);
    }
    applied = true;
  });
  if (applied) ctx.needsOrchestrate = true;
  return applied;
}

function changeVoice(ctx: SceneEditApplyContext, op: SceneEditOp): boolean {
  const voiceName = resolveVoiceForCharacter(op.character);
  if (!voiceName) return false;
  let applied = false;
  resolveTargets(ctx, op).forEach((index) => {
    const config = configAt(index);
    if (!config?.config_id || !isSpeechCard(config)) return;
    const patch: Partial<SoundGenerationConfig> = { voice_name: voiceName };
    if (config.scenarioSource) {
      patch.scenarioSource = { ...config.scenarioSource, character: op.character, voiceName };
    }
    if (config.orchestrateMeta) patch.orchestrateMeta = { ...config.orchestrateMeta, voiceName };
    patchConfig(index, patch);
    ctx.regen.force.add(config.config_id);
    applied = true;
  });
  if (applied) ctx.needsOrchestrate = true;
  return applied;
}

/** New delivery style for every line of the targeted speakers, at the backend's proposed level. */
function setStyle(ctx: SceneEditApplyContext, op: SceneEditOp): boolean {
  const style = cleanStyle(op.style);
  const changed: string[] = []; // refs whose style changed (they get the proposed level)
  op.targets.forEach((ref) => {
    const [index] = resolveTargets(ctx, { ...op, targets: [ref] });
    const config = index === undefined ? undefined : configAt(index);
    if (!config?.config_id || !isSpeechCard(config)) return;
    if (cleanStyle(config.voice_style) === style) return;
    patchConfig(index, { voice_style: style });
    ctx.regen.force.add(config.config_id);
    changed.push(ref);
  });
  if (changed.length === 0) return false;
  if (op.db !== null) applyMixOp(ctx, { ...op, op: 'set_level', targets: changed, delta_db: null });
  ctx.needsOrchestrate = true;
  return true;
}

/** Apply a content / speech op; returns false when nothing changed. */
export function applyContentOp(ctx: SceneEditApplyContext, op: SceneEditOp): boolean {
  switch (op.op) {
    case 'add_sound': return addSound(ctx, op);
    case 'add_speaker': return addSpeaker(ctx, op);
    case 'remove': return remove(ctx, op);
    case 'change_sound': return changeSound(ctx, op);
    case 'regenerate': return regenerate(ctx, op);
    case 'set_variants': return setVariants(ctx, op);
    case 'edit_lines': return editLines(ctx, op);
    case 'change_voice': return changeVoice(ctx, op);
    case 'set_style': return setStyle(ctx, op);
    default: return false;
  }
}
