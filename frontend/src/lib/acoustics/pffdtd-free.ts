/**
 * Free positioning of the wave-based card (pure helpers, no React/store).
 *
 * After a free-positioning run, a free object (a receiver in 'listener' mode,
 * a sound position in 'source' mode) that moved away from the position its IR
 * was made for gets the nearest grid point's IRs from POST /api/pffdtd/free-ir
 * (hooks/usePffdtdFreeMovement.ts). These helpers find the moved objects and
 * patch the card's IR mapping / simulation positions with the new IRs.
 */

import { PFFDTD } from '@/utils/constants';
import { computePositionKey } from '@/utils/positionKey';
import type { ImpulseResponseMetadata, IRAcousticParameters, SourceReceiverIRMapping } from '@/types/audio';
import type { PffdtdFreeIRResponse, PffdtdFreeMode } from '@/types/pffdtd';

type Vec3 = [number, number, number];

/** The card's `simulationPositions` (positions each IR was made for). */
export interface FreeSimPositions {
  sources: Record<string, Vec3>;
  receivers: Record<string, Vec3>;
  soundToPosKey?: Record<string, string>;
}

/** A free object away from the position its IR was made for. */
export interface MovedFreeObject {
  /** Latest-wins key: receiver id, or the sound group's sim-time position key. */
  objectId: string;
  position: Vec3;
  label: string;
  /** 'source' mode: the sounds that moved together (variants share a position). */
  soundIds: string[];
}

const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Signature of a target position (mm), to skip re-requesting the same move. */
export const positionSignature = (p: Vec3) => p.map((v) => Math.round(v * 1000)).join(',');

export function movedFreeObjects(
  mode: Exclude<PffdtdFreeMode, 'off'>,
  positions: FreeSimPositions,
  receivers: Array<{ id: string; name?: string; position: Vec3 }>,
  sounds: Array<{ id: string; display_name?: string; position: Vec3 }>,
): MovedFreeObject[] {
  const moved: MovedFreeObject[] = [];
  if (mode === 'listener') {
    for (const r of receivers) {
      const simPos = positions.receivers[r.id];
      if (simPos && dist(simPos, r.position) > PFFDTD.FREE_MOVE_EPSILON_M) {
        moved.push({ objectId: r.id, position: [...r.position], label: r.name || r.id, soundIds: [] });
      }
    }
    return moved;
  }
  const groups = new Map<string, MovedFreeObject>();
  for (const s of sounds) {
    const key = positions.soundToPosKey?.[s.id];
    const simPos = key ? positions.sources[key] : undefined;
    if (!key || !simPos || dist(simPos, s.position) <= PFFDTD.FREE_MOVE_EPSILON_M) continue;
    const group = groups.get(key);
    if (group) {
      group.soundIds.push(s.id);
    } else {
      groups.set(key, { objectId: key, position: [...s.position], label: s.display_name || s.id, soundIds: [s.id] });
    }
  }
  return [...groups.values()];
}

/** IR metadata of one re-derived WAV (served next to the run's IRs, copied on save like them). */
export function freeIRMetadata(
  file: string,
  data: PffdtdFreeIRResponse,
  name: string,
  acousticParameters?: IRAcousticParameters | null,
): ImpulseResponseMetadata {
  const foa = data.num_channels === 4;
  return {
    id: `pffdtd-free:${file}`,
    url: `${PFFDTD.RIR_URL_PREFIX}/${file}`,
    name,
    format: foa ? 'foa' : 'mono',
    channels: data.num_channels,
    originalChannels: data.num_channels,
    sampleRate: data.sample_rate,
    duration: data.duration_s,
    fileSize: 0,
    ...(acousticParameters ? { acoustic_parameters: acousticParameters } : {}),
    ...(foa ? { normalizationConvention: 'SN3D' as const, channelOrdering: 'AmbiX' as const } : {}),
  };
}

/** Every IR id referenced by a mapping. */
export function mappingIRIds(mapping: SourceReceiverIRMapping): Set<string> {
  const ids = new Set<string>();
  for (const receivers of Object.values(mapping)) for (const ir of Object.values(receivers)) ids.add(ir.id);
  return ids;
}

/** `importedIRIds` without the IRs a move replaced (no longer in the mapping). */
export function dropReplacedIRIds(
  importedIRIds: string[] | undefined,
  before: SourceReceiverIRMapping,
  after: SourceReceiverIRMapping,
): string[] | undefined {
  if (!importedIRIds) return importedIRIds;
  const kept = mappingIRIds(after);
  const replaced = mappingIRIds(before);
  return importedIRIds.filter((id) => kept.has(id) || !replaced.has(id));
}

/**
 * New mapping + positions after a move: the IRs of the nearest grid point,
 * recorded at the object's actual position (so it no longer counts as moved).
 */
export function applyFreeIRs(
  mode: Exclude<PffdtdFreeMode, 'off'>,
  moved: MovedFreeObject,
  data: PffdtdFreeIRResponse,
  mapping: SourceReceiverIRMapping,
  positions: FreeSimPositions,
): { mapping: SourceReceiverIRMapping; positions: FreeSimPositions; newSourceKey: string | null } {
  const next: SourceReceiverIRMapping = { ...mapping };
  const metadata = (ir: PffdtdFreeIRResponse['irs'][number]) =>
    freeIRMetadata(ir.ir_file, data, `${moved.label} (free) – ${ir.fixed_id}`, ir.acoustic_parameters);
  if (mode === 'listener') {
    for (const ir of data.irs) {
      next[ir.fixed_id] = { ...(next[ir.fixed_id] ?? {}), [moved.objectId]: metadata(ir) };
    }
    return {
      mapping: next,
      positions: { ...positions, receivers: { ...positions.receivers, [moved.objectId]: moved.position } },
      newSourceKey: null,
    };
  }
  const key = computePositionKey(moved.position);
  next[key] = Object.fromEntries(data.irs.map((ir) => [ir.fixed_id, metadata(ir)]));
  const soundToPosKey = { ...(positions.soundToPosKey ?? {}) };
  for (const id of moved.soundIds) soundToPosKey[id] = key;
  return {
    mapping: next,
    positions: { ...positions, sources: { ...positions.sources, [key]: moved.position }, soundToPosKey },
    newSourceKey: key,
  };
}

/** Drop source keys this session derived that no sound uses any more. */
export function pruneDerivedSourceKeys(
  derived: Set<string>,
  mapping: SourceReceiverIRMapping,
  positions: FreeSimPositions,
): { mapping: SourceReceiverIRMapping; positions: FreeSimPositions } {
  const used = new Set(Object.values(positions.soundToPosKey ?? {}));
  const stale = [...derived].filter((k) => !used.has(k));
  if (stale.length === 0) return { mapping, positions };
  const nextMapping = { ...mapping };
  const sources = { ...positions.sources };
  for (const k of stale) {
    delete nextMapping[k];
    delete sources[k];
    derived.delete(k);
  }
  return { mapping: nextMapping, positions: { ...positions, sources } };
}
