/**
 * Home-stage → model import
 *
 * "Import elements into the model" (ImportSandboxModal) snapshots the Home stage,
 * opens the model on its own saved soundscape, then appends the Home work on top.
 * The import keeps the scene structure intact:
 *
 * - Home analysis/scene cards are appended after the model's own, and every link
 *   that addresses a card by index (sound → usage parent, usage → context, results,
 *   card-flow lineage, active scene) is shifted by the model's card count.
 * - Sound cards are appended after the model's own; event `prompt_index` and the
 *   card-flow usage → sound links are shifted by the model's sound-card count.
 * - Event ids are kept as they are (the `{prefix}_{card}_{copy}` shape parsed by
 *   lib/audio/utils/variant-sound-id.ts must survive). A card is re-keyed only on
 *   a real collision with the model, and all its variants get the same new key.
 * - DAW state (schedules, volumes, links, trims, mute/solo, exclusions) is carried
 *   over, re-keyed for any renamed event id.
 *
 * `remapHomeElements` is pure; `captureHomeElements` / `mergeHomeElements` read
 * and write the stores.
 */

import {
  useAnalysisStore,
  useAreaDrawingStore,
  useAudioControlsStore,
  useCardFlowStore,
  useGridListenersStore,
  useReceiversStore,
  useSoundscapeStore,
  useUIStore,
} from '@/store';
import type { SoundEvent, SoundGenerationConfig } from '@/types';
import type { AnalysisConfig, AnalysisResult } from '@/types/analysis';
import type { IterationLink, TrimRange } from '@/types/audio';
import type { GridListenerData, ReceiverData } from '@/types/receiver';
import { newConfigId } from '@/utils/config-id';
import {
  remapCardLinks,
  remapIndexKeyedMap,
  remapIndexSet,
  remapParentUsageIndex,
  type IndexMapper,
} from '@/utils/cardIndexRemap';
import { AUDIO_TIMELINE, HOME_IMPORT } from '@/utils/constants';

const MS_PER_SECOND = 1000;

// ─── Snapshot types ─────────────────────────────────────────────────────────────

/** DAW state of the Home sounds (wiped by the domain reset before the model loads). */
export interface HomeAudioControlsSnapshot {
  soundVolumes: Record<string, number>;
  soundTimestamps: Record<string, number[]>;
  iterationLinks: Record<string, IterationLink>;
  iterationTrims: Record<string, TrimRange>;
  excludedIterations: Record<string, number[]>;
  exclusionReasons: Record<string, string>;
  mutedSounds: string[];
  soloedSounds: string[];
}

/** Card-flow lineage of the Home cards (indices are Home card / sound-card indices). */
export interface HomeCardFlowSnapshot {
  contextAdvanced: Set<number>;
  usageAdvanced: Set<number>;
  contextToUsageMap: Map<number, number[]>;
  usageToSoundMap: Map<number, number[]>;
}

export interface HomeElementsSnapshot {
  configs: SoundGenerationConfig[];
  events: SoundEvent[];
  receivers: ReceiverData[];
  gridListeners: GridListenerData[];
  analysisConfigs: AnalysisConfig[];
  analysisResults: AnalysisResult[];
  cardFlow: HomeCardFlowSnapshot;
  audio: HomeAudioControlsSnapshot;
  activeSoundParentIndex: number | null;
}

/** What the model already holds when the Home elements are appended. */
export interface HomeImportBase {
  soundConfigCount: number;
  analysisConfigCount: number;
  configIds: ReadonlySet<string>;
  eventIds: ReadonlySet<string>;
}

export type RemappedHomeElements = Omit<HomeElementsSnapshot, 'receivers' | 'gridListeners'> & {
  /** Home event id → its new id, only for the ids renamed to avoid a collision. */
  renamedEventIds: Map<string, string>;
};

// ─── Pure remapping ─────────────────────────────────────────────────────────────

/** Shift an event's `prompt_index` by `offset` sound cards (speech lines encode `card * factor + line`). */
function shiftPromptIndex(promptIndex: number | undefined, offset: number): number | undefined {
  if (promptIndex === undefined || promptIndex === null) return promptIndex;
  const factor = HOME_IMPORT.SPEECH_LINE_PROMPT_INDEX_FACTOR;
  if (promptIndex >= factor) {
    const card = Math.floor(promptIndex / factor);
    return (card + offset) * factor + (promptIndex % factor);
  }
  return promptIndex + offset;
}

/** Card key segment of an event id (see `cardEventId` in utils/config-id.ts). */
function toCardKey(configId: string): string {
  return configId.replace(/_/g, '-');
}

/**
 * Rebuild an event id around a new card key, keeping its shape:
 * `{prefix}_{card}_{copy}[_{suffix}]` (current and legacy index-keyed ids) gets its
 * card segment replaced; ids embedding the raw config id (`duplicate-{id}-{v}`,
 * `sed-{id}-{vi}`) get it swapped; any other id gets the new key appended.
 */
function rekeyEventId(id: string, oldConfigId: string | undefined, newConfigIdValue: string): string {
  const newKey = toCardKey(newConfigIdValue);
  const parts = id.split('_');
  if (oldConfigId) {
    const segment = parts.indexOf(toCardKey(oldConfigId));
    if (segment > 0) {
      parts[segment] = newKey;
      return parts.join('_');
    }
    if (id.includes(oldConfigId)) return id.split(oldConfigId).join(newConfigIdValue);
  }
  if (parts.length >= 3) {
    parts[1] = newKey;
    return parts.join('_');
  }
  return `${id}-${newKey}`;
}

/** Variants of one card share a group: they must be re-keyed together. */
function eventGroup(event: SoundEvent): string {
  return event.config_id ?? `prompt:${event.prompt_index}`;
}

/** Re-key a soundId-keyed record, keeping only the Home sounds' entries. */
function rekeySoundRecord<V>(
  record: Readonly<Record<string, V>>,
  homeIds: ReadonlySet<string>,
  rename: (id: string) => string,
): Record<string, V> {
  const next: Record<string, V> = {};
  for (const [id, value] of Object.entries(record)) {
    if (homeIds.has(id)) next[rename(id)] = value;
  }
  return next;
}

/** Re-key a `${soundId}-${iterationIndex}`-keyed record, keeping only the Home sounds' entries. */
function rekeyIterationRecord<V>(
  record: Readonly<Record<string, V>>,
  homeIds: ReadonlySet<string>,
  rename: (id: string) => string,
): Record<string, V> {
  const next: Record<string, V> = {};
  for (const [key, value] of Object.entries(record)) {
    const match = /^(.*)-(\d+)$/.exec(key);
    if (match && homeIds.has(match[1])) next[`${rename(match[1])}-${match[2]}`] = value;
  }
  return next;
}

/**
 * Remap the Home elements for appending after `base`. Pure: config ids are only
 * minted (`newConfigId`) for cards whose ids collide with the model's.
 */
export function remapHomeElements(home: HomeElementsSnapshot, base: HomeImportBase): RemappedHomeElements {
  const shiftCard: IndexMapper = (i) => i + base.analysisConfigCount;
  const shiftSound = (i: number) => i + base.soundConfigCount;

  // 1. Cards whose config_id the model already uses get a fresh one.
  const configIdMap = new Map<string, string>();
  for (const c of home.configs) {
    if (c.config_id && base.configIds.has(c.config_id) && !configIdMap.has(c.config_id)) {
      configIdMap.set(c.config_id, newConfigId());
    }
  }

  // 2. Any card whose (re-keyed) event ids still collide with the model's is re-keyed
  //    as a whole, so `resolveVariantSoundId` keeps finding its sibling variants.
  const candidateId = (e: SoundEvent) => {
    const mapped = e.config_id ? configIdMap.get(e.config_id) : undefined;
    return mapped ? rekeyEventId(e.id, e.config_id, mapped) : e.id;
  };
  const collidingGroups = new Set(home.events.filter((e) => base.eventIds.has(candidateId(e))).map(eventGroup));
  const legacyGroupKeys = new Map<string, string>();
  for (const e of home.events) {
    const group = eventGroup(e);
    if (!collidingGroups.has(group)) continue;
    collidingGroups.delete(group);
    if (e.config_id) configIdMap.set(e.config_id, newConfigId());
    else legacyGroupKeys.set(group, newConfigId());
  }

  const renamedEventIds = new Map<string, string>();
  const events = home.events.map((e) => {
    const mappedConfigId = e.config_id ? configIdMap.get(e.config_id) : undefined;
    const legacyKey = legacyGroupKeys.get(eventGroup(e));
    const id = mappedConfigId
      ? rekeyEventId(e.id, e.config_id, mappedConfigId)
      : legacyKey ? rekeyEventId(e.id, undefined, legacyKey) : e.id;
    if (id !== e.id) renamedEventIds.set(e.id, id);
    return {
      ...e,
      id,
      ...(mappedConfigId ? { config_id: mappedConfigId } : {}),
      prompt_index: shiftPromptIndex(e.prompt_index, base.soundConfigCount),
    };
  });

  const configs = home.configs.map((c) => {
    const mappedConfigId = c.config_id ? configIdMap.get(c.config_id) : undefined;
    return {
      ...c,
      ...(mappedConfigId ? { config_id: mappedConfigId } : {}),
      parentUsageOriginalIndex: remapParentUsageIndex(c.parentUsageOriginalIndex, shiftCard),
    };
  });

  const homeIds = new Set(home.events.map((e) => e.id));
  const rename = (id: string) => renamedEventIds.get(id) ?? id;
  const a = home.audio;
  const audio: HomeAudioControlsSnapshot = {
    soundVolumes: rekeySoundRecord(a.soundVolumes, homeIds, rename),
    soundTimestamps: rekeySoundRecord(a.soundTimestamps, homeIds, rename),
    excludedIterations: rekeySoundRecord(a.excludedIterations, homeIds, rename),
    iterationLinks: rekeyIterationRecord(a.iterationLinks, homeIds, rename),
    iterationTrims: rekeyIterationRecord(a.iterationTrims, homeIds, rename),
    exclusionReasons: rekeyIterationRecord(a.exclusionReasons, homeIds, rename),
    mutedSounds: a.mutedSounds.filter((id) => homeIds.has(id)).map(rename),
    soloedSounds: a.soloedSounds.filter((id) => homeIds.has(id)).map(rename),
  };

  const cf = home.cardFlow;
  const cardFlow: HomeCardFlowSnapshot = {
    contextAdvanced: remapIndexSet(cf.contextAdvanced, shiftCard),
    usageAdvanced: remapIndexSet(cf.usageAdvanced, shiftCard),
    contextToUsageMap: remapIndexKeyedMap(cf.contextToUsageMap, shiftCard, (usages) => usages.map((u) => u + base.analysisConfigCount)),
    usageToSoundMap: remapIndexKeyedMap(cf.usageToSoundMap, shiftCard, (sounds) => sounds.map(shiftSound)),
  };

  return {
    configs,
    events,
    analysisConfigs: remapCardLinks(home.analysisConfigs, shiftCard),
    analysisResults: home.analysisResults.map((r) => ({ ...r, configIndex: r.configIndex + base.analysisConfigCount })),
    cardFlow,
    audio,
    activeSoundParentIndex: home.activeSoundParentIndex === null
      ? null
      : remapParentUsageIndex(home.activeSoundParentIndex, shiftCard) ?? null,
    renamedEventIds,
  };
}

/**
 * Timeline length (ms) that fits every stored schedule, mirroring the soundscape
 * restore path; 0 when there is nothing scheduled. Unresolved solver sentinels are ignored.
 */
export function timelineDurationForTimestamps(timestamps: Readonly<Record<string, number[]>>): number {
  let maxEndSec = 0;
  for (const list of Object.values(timestamps)) {
    for (const ts of list) {
      if (ts >= AUDIO_TIMELINE.UNRESOLVED_TIMESTAMP_SEC) continue;
      maxEndSec = Math.max(maxEndSec, ts + HOME_IMPORT.DEFAULT_CLIP_SECONDS);
    }
  }
  if (maxEndSec <= 0) return 0;
  const step = HOME_IMPORT.TIMELINE_STEP_SECONDS;
  return Math.ceil((maxEndSec + HOME_IMPORT.TIMELINE_TAIL_SECONDS) / step) * step * MS_PER_SECOND;
}

// ─── Store access ───────────────────────────────────────────────────────────────

/** Snapshot the importable Home elements (taken before the domain reset). */
export function captureHomeElements(): HomeElementsSnapshot {
  const sc = useSoundscapeStore.getState();
  const analysis = useAnalysisStore.getState();
  const flow = useCardFlowStore.getState();
  const audio = useAudioControlsStore.getState();
  return {
    configs: [...sc.soundConfigs],
    events: [...(sc.generatedSounds ?? [])] as SoundEvent[],
    receivers: [...useReceiversStore.getState().receivers],
    gridListeners: [...useGridListenersStore.getState().gridListeners],
    analysisConfigs: [...analysis.analysisConfigs],
    analysisResults: [...analysis.analysisResults],
    cardFlow: {
      contextAdvanced: new Set(flow.contextAdvanced),
      usageAdvanced: new Set(flow.usageAdvanced),
      contextToUsageMap: new Map(flow.contextToUsageMap),
      usageToSoundMap: new Map(flow.usageToSoundMap),
    },
    audio: {
      soundVolumes: { ...audio.soundVolumes },
      soundTimestamps: { ...audio.soundTimestamps },
      iterationLinks: { ...audio.iterationLinks },
      iterationTrims: { ...audio.iterationTrims },
      excludedIterations: { ...audio.excludedIterations },
      exclusionReasons: { ...audio.exclusionReasons },
      mutedSounds: [...audio.mutedSounds],
      soloedSounds: [...audio.soloedSounds],
    },
    activeSoundParentIndex: useUIStore.getState().activeSoundParentIndex,
  };
}

/**
 * Append the captured Home elements onto whatever the model now holds.
 * Simulations are intentionally not imported. Arms `suppressOrchestrateBakeRef`
 * when sounds are imported so the orchestrate re-bake keeps their schedules.
 */
export function mergeHomeElements(
  home: HomeElementsSnapshot,
  suppressOrchestrateBakeRef: { current: boolean },
): void {
  const sc = useSoundscapeStore.getState();
  const analysis = useAnalysisStore.getState();
  const baseEvents = (sc.generatedSounds ?? []) as SoundEvent[];
  const remapped = remapHomeElements(home, {
    soundConfigCount: sc.soundConfigs.length,
    analysisConfigCount: analysis.analysisConfigs.length,
    configIds: new Set(sc.soundConfigs.map((c) => c.config_id).filter((id): id is string => !!id)),
    eventIds: new Set(baseEvents.map((e) => e.id)),
  });
  if (remapped.renamedEventIds.size > 0) {
    console.log('[homeImport] renamed colliding event ids:', Object.fromEntries(remapped.renamedEventIds));
  }

  // Scene / analysis cards first: the sound cards' parent links point at them.
  if (remapped.analysisConfigs.length > 0) {
    const analysisConfigs = [...analysis.analysisConfigs, ...remapped.analysisConfigs];
    analysis.restoreAnalysisState({
      analysisConfigs,
      analysisResults: [...analysis.analysisResults, ...remapped.analysisResults],
      activeTab: analysis.activeAnalysisTab,
    });
    useAreaDrawingStore.getState().hydrateFromConfigs(analysisConfigs);
  }

  const flow = useCardFlowStore.getState();
  const rf = remapped.cardFlow;
  useCardFlowStore.setState({
    contextAdvanced: new Set([...flow.contextAdvanced, ...rf.contextAdvanced]),
    usageAdvanced: new Set([...flow.usageAdvanced, ...rf.usageAdvanced]),
    contextToUsageMap: new Map([...flow.contextToUsageMap, ...rf.contextToUsageMap]),
    usageToSoundMap: new Map([...flow.usageToSoundMap, ...rf.usageToSoundMap]),
  });

  // The imported schedules are exact — skip the one-shot orchestrate re-bake
  // the generatedSounds change below would otherwise trigger.
  if (remapped.events.length > 0) suppressOrchestrateBakeRef.current = true;
  const mergedEvents = [...baseEvents, ...remapped.events];
  useSoundscapeStore.setState({
    soundConfigs: [...sc.soundConfigs, ...remapped.configs],
    generatedSounds: mergedEvents,
    soundscapeData: mergedEvents.length > 0 ? mergedEvents : null,
  });

  const audio = useAudioControlsStore.getState();
  const ra = remapped.audio;
  useAudioControlsStore.setState({
    soundVolumes: { ...audio.soundVolumes, ...ra.soundVolumes },
    soundTimestamps: { ...audio.soundTimestamps, ...ra.soundTimestamps },
    iterationLinks: { ...audio.iterationLinks, ...ra.iterationLinks },
    iterationTrims: { ...audio.iterationTrims, ...ra.iterationTrims },
    excludedIterations: { ...audio.excludedIterations, ...ra.excludedIterations },
    exclusionReasons: { ...audio.exclusionReasons, ...ra.exclusionReasons },
    mutedSounds: new Set([...audio.mutedSounds, ...ra.mutedSounds]),
    soloedSounds: new Set([...audio.soloedSounds, ...ra.soloedSounds]),
  });

  // Show the scene the user was working on at Home (null = every sound). Set before
  // the timeline below: an active scene binds the DAW length to its own duration.
  useUIStore.getState().setActiveSoundParentIndex(remapped.activeSoundParentIndex);

  // The re-bake is suppressed, so extend the timeline here (as the restore path does)
  // or imported iterations past the current length would be filtered out.
  const requiredMs = timelineDurationForTimestamps(ra.soundTimestamps);
  if (requiredMs > useAudioControlsStore.getState().timelineDurationMs) {
    useAudioControlsStore.getState().setTimelineDurationMs(requiredMs);
  }

  if (home.receivers.length > 0) {
    const rc = useReceiversStore.getState();
    rc.restoreReceivers([...rc.receivers, ...home.receivers], rc.selectedReceiverId);
  }
  if (home.gridListeners.length > 0) {
    const gl = useGridListenersStore.getState();
    gl.restoreGridListeners([...gl.gridListeners, ...home.gridListeners]);
  }
}
