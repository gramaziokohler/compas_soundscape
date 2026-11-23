/**
 * Compact snapshot of a generated scene for the edit agent (POST /api/scene-edit).
 * Sound cards become refs "S1", "S2"… and model-analysis object groups "O1"…; the
 * returned ref map turns the agent's refs back into card ids / object positions.
 */

import { useAudioControlsStore, useDirectivityStore, useSoundscapeStore } from '@/store';
import type { SceneEditRefMap, SceneEditSnapshot, SceneEditSnapshotCard } from '@/types/sceneEdit';
import type { SoundGenerationConfig } from '@/types';
import { parseAuthoredSeconds } from '@/lib/audio/utils/timeline-utils';
import { DEFAULT_DBFS, SCENE_EDIT, SIMPLE_MODE, TTS_VOICE_TO_CHARACTER } from '@/utils/constants';
import { formatScenarioPeople } from '@/utils/scenarioSpeech';
import { getSceneTitle, MS_PER_SECOND } from '@/utils/sceneWorkflow';
import {
  cardEvents,
  cardSpeechLines,
  isSpeechCard,
  round,
  sceneCardIndices,
  sceneObjectGroups,
  sceneRoomBounds,
  sceneScenarioAt,
  type ObjectGroup,
} from './sceneCards';

/** Start times (s) of a card's occurrences: the DAW schedule, else its authored times. */
export function cardTimes(config: SoundGenerationConfig, trackId: string | null): number[] {
  const scheduled = trackId ? useAudioControlsStore.getState().soundTimestamps[trackId] : undefined;
  if (scheduled?.length) return scheduled;
  const authored = config.orchestrateMeta?.timestamps ?? config.scenarioSource?.timestamps ?? config.timestamps ?? [];
  return authored.map(parseAuthoredSeconds);
}

/** Current playback level (dBFS) of a card: the user's override, else the event / card level. */
export function cardLevelDb(config: SoundGenerationConfig, trackId: string | null, eventLevel?: number): number {
  const override = trackId ? useAudioControlsStore.getState().soundVolumes[trackId] : undefined;
  return override ?? eventLevel ?? config.dbfs ?? DEFAULT_DBFS;
}

function anchorRefs(config: SoundGenerationConfig, groups: ObjectGroup[]): string[] {
  const ids = new Set(
    (config.entities ?? []).flatMap((e) => [e.id, e.applicationId, e.nodeId]).filter((v): v is string => !!v),
  );
  if (ids.size === 0) return [];
  return groups.flatMap((g, i) => (g.ids.some((id) => ids.has(id)) ? [`O${i + 1}`] : []));
}

function scenarioNarrative(usageIndex: number): string {
  const events = sceneScenarioAt(usageIndex)?.scenarioResult?.scenarios?.[0]?.events ?? [];
  const text = events.map((e) => `${e.timestamp} ${e.description}`).join('\n');
  return text.slice(0, SCENE_EDIT.SCENARIO_TEXT_MAX_CHARS);
}

/** Build the snapshot of scene `usageIndex`, or null when it is not a scenario scene. */
export function buildSceneEditSnapshot(
  usageIndex: number,
  language: string,
): { snapshot: SceneEditSnapshot; refMap: SceneEditRefMap } | null {
  const sc = sceneScenarioAt(usageIndex);
  if (!sc) return null;
  const { soundConfigs } = useSoundscapeStore.getState();
  const audio = useAudioControlsStore.getState();
  const groups = sceneObjectGroups(sc).slice(0, SCENE_EDIT.MAX_OBJECTS);
  const refMap: SceneEditRefMap = { cards: {}, objects: {} };

  const cards: SceneEditSnapshotCard[] = [];
  sceneCardIndices(usageIndex).forEach((index) => {
    const config = soundConfigs[index];
    if (!config?.config_id) return;
    const events = cardEvents(index);
    const primary = events[0];
    const trackId = primary?.id ?? null;
    const speech = isSpeechCard(config);
    const ref = `S${cards.length + 1}`;
    refMap.cards[ref] = config.config_id;
    const position = config.position ?? primary?.position ?? config.entities?.[0]?.position ?? [];
    cards.push({
      ref,
      kind: speech ? 'speech' : 'foley',
      name: config.display_name || config.prompt.slice(0, SIMPLE_MODE.TITLE_MAX_CHARS),
      category: config.category ?? (speech ? 'speech' : ''),
      prompt: speech ? '' : config.prompt,
      lines: speech ? cardSpeechLines(config) : [],
      character: speech
        ? config.scenarioSource?.character || TTS_VOICE_TO_CHARACTER[config.voice_name ?? ''] || ''
        : '',
      times_s: cardTimes(config, trackId).map((t) => round(t, 1)),
      level_db: round(cardLevelDb(config, trackId, primary?.volume_dbfs), 1),
      muted: !!trackId && audio.mutedSounds.has(trackId),
      soloed: !!trackId && audio.soloedSounds.has(trackId),
      loopable: !!trackId && !!audio.soundLoopable[trackId],
      variants: Math.max(events.length, speech ? 1 : config.seed_copies ?? 1),
      duration_s: round((trackId ? audio.soundBufferDurations[trackId] : undefined) ?? config.duration, 1),
      position: position.slice(0, 3).map((v) => round(v)),
      anchors: anchorRefs(config, groups),
      directivity: primary?.directivity?.id ?? config.directivity?.id ?? '',
      generated: events.length > 0,
    });
  });

  const objects = groups.map((g, i) => {
    const ref = `O${i + 1}`;
    refMap.objects[ref] = g.center;
    return {
      ref,
      name: g.name,
      description: g.description,
      center: g.center.map((v) => round(v)),
      extent: [0, 1, 2].map((a) => round(g.max[a] - g.min[a])),
    };
  });

  const snapshot: SceneEditSnapshot = {
    title: getSceneTitle(sc, SIMPLE_MODE.SCENE_FALLBACK_TITLE),
    prompt: sc.userContext ?? '',
    scenario: scenarioNarrative(usageIndex),
    duration_s: sc.timelineDurationMs / MS_PER_SECOND,
    people: formatScenarioPeople(sc),
    language,
    room: sceneRoomBounds(groups),
    space_title: '',
    cards,
    objects,
    directivity_presets: useDirectivityStore.getState().presets.map((p) => p.id),
  };
  return { snapshot, refMap };
}
