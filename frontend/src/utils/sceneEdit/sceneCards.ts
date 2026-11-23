/**
 * Shared helpers for the scene edit chat: a scene's sound cards, their generated
 * variants and DAW track ids, and the model-analysis object groups they can sit on.
 */

import { promptMatchesCard, useAnalysisStore, useFileUploadStore, useSoundscapeStore, useUIStore } from '@/store';
import type { AnalysisConfig, ScenarioConfig } from '@/types/analysis';
import type { SceneEditBounds } from '@/types/sceneEdit';
import type { SoundEvent, SoundGenerationConfig } from '@/types';
import { orderVariants } from '@/lib/audio/utils/variant-sound-id';
import { getSceneSoundIndices } from '@/utils/sceneWorkflow';

export type Vec3 = [number, number, number];

/** The scenario (scene) card at `usageIndex`, or null. */
export function sceneScenarioAt(usageIndex: number): ScenarioConfig | null {
  const cfg = useAnalysisStore.getState().analysisConfigs[usageIndex];
  return cfg?.type === 'scenario' ? cfg : null;
}

/** Indices of the scene's sound cards. */
export function sceneCardIndices(usageIndex: number): number[] {
  return getSceneSoundIndices(useSoundscapeStore.getState().soundConfigs, usageIndex);
}

/** Index of the sound card with `configId`, or -1. */
export function cardIndexByConfigId(configId: string): number {
  return useSoundscapeStore.getState().soundConfigs.findIndex((c) => c.config_id === configId);
}

/** Generated variants of card `index`, in canonical variant order. */
export function cardEvents(index: number): SoundEvent[] {
  const { soundConfigs, generatedSounds } = useSoundscapeStore.getState();
  const configId = soundConfigs[index]?.config_id;
  const events = (generatedSounds as SoundEvent[]).filter((e) =>
    configId && e.config_id ? e.config_id === configId : promptMatchesCard(e.prompt_index, index),
  );
  return orderVariants(events);
}

/** DAW track id of a card (its first variant) — the key of timestamps / trims / loop state. */
export function cardTrackId(index: number): string | null {
  return cardEvents(index)[0]?.id ?? null;
}

export function isSpeechCard(config: SoundGenerationConfig | undefined): boolean {
  return !!config && (config.type === 'text-to-speech' || !!config.scenarioSource?.isSpeech);
}

export function isBackgroundCategory(category: string | undefined): boolean {
  const norm = (category ?? '').toLowerCase().replace(/[\s_-]+/g, '_');
  return norm === 'background' || norm === 'background_sound';
}

/** Current speech lines of a speech card (orchestrate meta first, then the scenario source). */
export function cardSpeechLines(config: SoundGenerationConfig): string[] {
  const lines = config.orchestrateMeta?.speechLines ?? config.scenarioSource?.speechLines;
  if (lines?.length) return lines;
  return config.prompt ? [config.prompt] : [];
}

/** "MM:SS" (one decimal when needed) — the authored timestamp format of the agents. */
export function formatMmSs(seconds: number): string {
  const s = Math.max(0, seconds);
  const mm = Math.floor(s / 60);
  const rest = s - mm * 60;
  const ss = Number.isInteger(rest) ? String(rest).padStart(2, '0') : rest.toFixed(1).padStart(4, '0');
  return `${String(mm).padStart(2, '0')}:${ss}`;
}

/** The model-analysis context card a scene reads its objects from. */
function sceneContext(sc: ScenarioConfig): AnalysisConfig | undefined {
  const idx = sc.parentContextOriginalIndex;
  return idx === undefined ? undefined : useAnalysisStore.getState().analysisConfigs[idx];
}

export interface ObjectGroup {
  name: string;
  description: string;
  ids: string[];
  min: Vec3;
  max: Vec3;
  center: Vec3;
}

/** Object groups of the scene's model analysis that carry bounds. */
export function sceneObjectGroups(sc: ScenarioConfig): ObjectGroup[] {
  const ctx = sceneContext(sc);
  if (ctx?.type !== 'model-analysis') return [];
  const objects = ctx.analysisResult?.architecturalObjects ?? [];
  const groups: ObjectGroup[] = [];
  for (const obj of objects) {
    const entries = Object.entries(obj.object_ids ?? {});
    const mins = entries.map(([, b]) => b.min_bounds).filter((b): b is number[] => !!b && b.length >= 3);
    const maxs = entries.map(([, b]) => b.max_bounds).filter((b): b is number[] => !!b && b.length >= 3);
    if (mins.length === 0 || maxs.length === 0) continue;
    const min = [0, 1, 2].map((i) => Math.min(...mins.map((v) => v[i]))) as Vec3;
    const max = [0, 1, 2].map((i) => Math.max(...maxs.map((v) => v[i]))) as Vec3;
    const center = [0, 1, 2].map((i) => (min[i] + max[i]) / 2) as Vec3;
    groups.push({ name: obj.name, description: obj.description, ids: entries.map(([id]) => id), min, max, center });
  }
  return groups;
}

/** Room the scene's sounds live in: the loaded model / geometry, else the object groups' union. */
export function sceneRoomBounds(groups: ObjectGroup[]): SceneEditBounds | null {
  const { globalSpeckleData, speckleBounds } = useUIStore.getState();
  if (globalSpeckleData && speckleBounds) return speckleBounds;
  const geometry = useFileUploadStore.getState().geometryBounds;
  if (geometry) return geometry;
  if (groups.length === 0) return null;
  return {
    min: [0, 1, 2].map((i) => Math.min(...groups.map((g) => g.min[i]))) as Vec3,
    max: [0, 1, 2].map((i) => Math.max(...groups.map((g) => g.max[i]))) as Vec3,
  };
}

export const round = (v: number, digits = 2): number => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};
