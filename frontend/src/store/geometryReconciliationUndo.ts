/**
 * Undo coherence for geometry reconciliation.
 *
 * When a model version (re)loads, sounds linked to objects follow moved objects
 * and drop links to deleted ones. That is a LOAD of pre-existing truth, not an
 * edit: it must not be an undo step, and Ctrl+Z / Ctrl+Y must never bring back
 * links or positions that belong to the previous geometry. `runWithoutUndo`
 * alone keeps the old values in the recorded snapshots.
 *
 * So every past / future snapshot is reconciled with the SAME per-entity
 * outcome as the live store: an entity the snapshot links to is updated (moved)
 * or dropped (deleted); a card left with no entity is detached. Snapshots that
 * never linked an object are untouched, so undoing past a link creation still
 * removes the link.
 */

import { rebaseUndoHistory } from './undoRedoRegistry';
import { soundscapePartialize, promptMatchesCard, useSoundscapeStore } from './soundscapeStore';
import { audioControlsPartialize } from './audioControlsStore';
import type { IterationLink } from '@/types/audio';

type SoundscapeSnapshot = ReturnType<typeof soundscapePartialize>;
type AudioControlsSnapshot = ReturnType<typeof audioControlsPartialize>;
type Vec3 = [number, number, number];

/** The entity fields reconciliation reads / rewrites. */
export interface ReconciledEntity {
  id?: string;
  nodeId?: string;
  applicationId?: string;
  index?: number;
  name?: string;
  layer?: string;
  position?: number[];
  bounds?: { center?: number[] } & Record<string, unknown>;
}

/**
 * Outcome of one reconciliation, keyed by EVERY identity of the previous entity
 * (applicationId, nodeId, id): the reconciled entity, or null when deleted.
 */
export type EntityReconciliation = Map<string, ReconciledEntity | null>;

type SoundRecord = Record<string, unknown> & { id?: string; prompt_index?: number; entity_index?: number };

export function entityIdentities(ent: ReconciledEntity): string[] {
  return [ent.applicationId, ent.nodeId, ent.id].filter((k): k is string => typeof k === 'string' && k.length > 0);
}

function centerOf(ent: ReconciledEntity): Vec3 | null {
  const c = ent.bounds?.center ?? ent.position;
  return c && c.length >= 3 ? [c[0], c[1], c[2]] : null;
}

const sameVec = (a: Vec3 | null, b: Vec3 | null) => !!a && !!b && a.every((v, i) => Math.abs(v - b[i]) <= 1e-4);

interface CardOutcome {
  entities: ReconciledEntity[] | undefined;
  detached: boolean;
  /** entity.index → new center, for entities whose object moved. */
  movedCenters: Map<number, Vec3>;
}

function reconcileCard(entities: ReconciledEntity[] | undefined, outcome: EntityReconciliation): CardOutcome | null {
  if (!entities?.length) return null;
  let changed = false;
  const kept: ReconciledEntity[] = [];
  const movedCenters = new Map<number, Vec3>();
  entities.forEach((ent, i) => {
    const key = entityIdentities(ent).find((k) => outcome.has(k));
    if (!key) {
      kept.push(ent);
      return;
    }
    changed = true;
    const next = outcome.get(key);
    if (!next) return; // object deleted → link dropped
    const before = centerOf(ent);
    const after = centerOf(next);
    if (after && !sameVec(before, after)) movedCenters.set(ent.index ?? i, after);
    kept.push({
      ...ent,
      name: next.name ?? ent.name,
      layer: next.layer ?? ent.layer,
      position: next.position ?? ent.position,
      bounds: next.bounds ?? ent.bounds,
      applicationId: next.applicationId ?? ent.applicationId,
    });
  });
  if (!changed) return null;
  return { entities: kept.length > 0 ? kept : undefined, detached: kept.length === 0, movedCenters };
}

function reconcileSounds(sounds: SoundRecord[] | null, outcomes: Map<number, CardOutcome>): SoundRecord[] | null {
  if (!sounds) return sounds;
  return sounds.map((s) => {
    for (const [cardIndex, outcome] of outcomes) {
      if (!promptMatchesCard(s.prompt_index, cardIndex)) continue;
      if (outcome.detached) {
        const { entity_index: _i, entity_indices: _is, ...rest } = s;
        return rest as SoundRecord;
      }
      if (outcome.movedCenters.size === 0) return s;
      const center = (s.entity_index !== undefined && outcome.movedCenters.get(s.entity_index))
        || outcome.movedCenters.values().next().value;
      return center ? { ...s, position: center } : s;
    }
    return s;
  });
}

/**
 * Apply one reconciliation outcome to the undo history of the soundscape and
 * audio-controls stores. Call right after the live reconciliation writes
 * (which run inside runWithoutUndo).
 */
export function rebaseGeometryReconciliation(outcome: EntityReconciliation): void {
  if (outcome.size === 0) return;

  rebaseUndoHistory<SoundscapeSnapshot>('soundscape', (snap) => {
    const outcomes = new Map<number, CardOutcome>();
    const soundConfigs = snap.soundConfigs.map((config, index) => {
      const result = reconcileCard(config.entities as ReconciledEntity[] | undefined, outcome);
      if (!result) return config;
      outcomes.set(index, result);
      return { ...config, entities: result.entities as typeof config.entities };
    });
    if (outcomes.size === 0) return snap;
    return {
      ...snap,
      soundConfigs,
      generatedSounds: reconcileSounds(snap.generatedSounds as SoundRecord[], outcomes) ?? [],
      soundscapeData: reconcileSounds(snap.soundscapeData as SoundRecord[] | null, outcomes),
    };
  });

  // Per-iteration entity links (DAW markers): drop links to deleted objects and
  // move links to moved ones; variant overrides on the same iteration stay.
  const sounds = useSoundscapeStore.getState().generatedSounds as SoundRecord[];
  const configs = useSoundscapeStore.getState().soundConfigs;
  const cardBySoundId = new Map<string, number>();
  for (const s of sounds) {
    if (s.id === undefined || s.prompt_index === undefined) continue;
    cardBySoundId.set(s.id, s.prompt_index >= 10000 ? Math.floor(s.prompt_index / 10000) : s.prompt_index);
  }
  rebaseUndoHistory<AudioControlsSnapshot>('audioControls', (snap) => {
    let changed = false;
    const links: Record<string, IterationLink> = {};
    for (const [key, link] of Object.entries(snap.iterationLinks)) {
      const linkKey = link.entityNodeId && outcome.has(link.entityNodeId) ? link.entityNodeId : null;
      if (!linkKey) {
        links[key] = link;
        continue;
      }
      changed = true;
      const next = outcome.get(linkKey);
      if (next) {
        const center = centerOf(next);
        links[key] = center ? { ...link, entityPosition: center } : link;
        continue;
      }
      const { entityNodeId: _n, entityPosition: _p, entityIndex: _e, ...rest } = link;
      if (Object.keys(rest).length > 0) links[key] = rest;
    }
    // Links addressed by entity index follow the live card's entity.
    for (const [key, link] of Object.entries(links)) {
      if (link.entityIndex === undefined || link.entityNodeId) continue;
      const dash = key.lastIndexOf('-');
      const card = cardBySoundId.get(dash > 0 ? key.slice(0, dash) : key);
      const ent = card !== undefined ? (configs[card]?.entities?.[link.entityIndex] as ReconciledEntity | undefined) : undefined;
      const center = ent ? centerOf(ent) : null;
      if (center && !sameVec(link.entityPosition ?? null, center)) {
        links[key] = { ...link, entityPosition: center };
        changed = true;
      }
    }
    return changed ? { ...snap, iterationLinks: links } : snap;
  });
}
