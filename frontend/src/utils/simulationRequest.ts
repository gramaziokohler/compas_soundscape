/**
 * Shared assembly of a Speckle simulation request.
 *
 * The pyroomacoustics run, the Choras run and the geometry preflight must send
 * EXACTLY the same geometry inputs (model, acoustic region, materials,
 * scattering, source/receiver pairs, mesh settings) — the preflight shows the
 * mesh the simulation will use only if its inputs match. This module is the
 * single place those inputs are built, and `simulationRequestSignature`
 * fingerprints them so a stale preflight can be detected.
 */

import {
  resolveSimulationGeometryObjectIds,
  resolveSimulationLayerName,
  toBackendGeometryIds,
} from '@/store/acousticLayerStore';
import { collapseVariantsToOne, groupSoundsByPosition } from '@/utils/positionKey';
import type { SimulationEngine, SimulationMeshSettings } from '@/types/simulationPreflight';

export interface SourceReceiverPair {
  source_position: number[];
  receiver_position: number[];
  source_id: string;
  receiver_id: string;
}

export interface SimulationGeometryRequest {
  projectId: string;
  modelId: string;
  layerName: string;
  objectMaterials: Record<string, string>;
  geometryObjectIds?: string[];
  objectScattering: Record<string, number>;
  sourceReceiverPairs: SourceReceiverPair[];
  /** posKey → simulated source position (stored as simulationPositions.sources). */
  uniqueSourcePositions: Map<string, [number, number, number]>;
  /** sound id → posKey (stored as simulationPositions.soundToPosKey). */
  sourceSoundToPosKey: Map<string, string>;
}

interface BuildArgs {
  /** Card material assignments: object id → frontend material id. */
  materialAssignments: Record<string, string> | undefined;
  /** Card scattering assignments: object id → coefficient. */
  scatteringAssignments: Record<string, number> | undefined;
  /** Card acoustic layer name (resolved against the live acoustic region). */
  layerName: string | null | undefined;
  /** Persisted geometry ids, used only when no live acoustic region exists. */
  persistedGeometryIds: string[] | undefined;
  speckleUrl: string;
  receivers: Array<{ id: string; position: [number, number, number] }>;
  sounds: Array<{ id: string; position: [number, number, number]; prompt_index?: number; copy_index?: number }>;
  selectedVariants: Record<number, number>;
  /** Frontend material-id prefix stripped before sending (e.g. /^pyroom_/). */
  materialPrefix: RegExp;
}

/** Speckle geometry fields stored on simulation cards (untyped on some configs). */
export interface SpeckleCardFields {
  speckleMaterialAssignments?: Record<string, string>;
  speckleScatteringAssignments?: Record<string, number>;
  speckleLayerName?: string | null;
  speckleGeometryObjectIds?: string[];
}

/** Read the Speckle geometry fields of any simulation card config. */
export function speckleCardFields(config: object): SpeckleCardFields {
  return config as SpeckleCardFields;
}

export type BuildResult =
  | { ok: true; request: SimulationGeometryRequest }
  | { ok: false; error: string };

const SPECKLE_MODEL_URL = /\/projects\/([^/]+)\/models\/([^/?#]+)/;

/** Build the geometry inputs of a simulation / preflight from a card's state. */
export function buildSimulationGeometryRequest(args: BuildArgs): BuildResult {
  const { speckleUrl, receivers, sounds, selectedVariants, materialPrefix } = args;
  const assignments = args.materialAssignments ?? {};
  if (Object.keys(assignments).length === 0) return { ok: false, error: 'Assign materials first' };

  const urlMatch = speckleUrl.match(SPECKLE_MODEL_URL);
  if (!urlMatch) return { ok: false, error: 'Invalid Speckle URL' };

  // Variants of one source (same prompt_index) collapse to a single simulated source.
  const sourceSounds = collapseVariantsToOne(sounds, selectedVariants);
  const { uniquePositions, soundToPosKey } = groupSoundsByPosition(sourceSounds);

  const pairs: SourceReceiverPair[] = [];
  for (const [posKey, pos] of uniquePositions) {
    for (const receiver of receivers) {
      if (!receiver.position || receiver.position.length !== 3) {
        return { ok: false, error: `Receiver "${receiver.id}" has an invalid position.` };
      }
      pairs.push({ source_position: pos, receiver_position: receiver.position, source_id: posKey, receiver_id: receiver.id });
    }
  }
  if (pairs.length === 0) return { ok: false, error: 'Add at least one sound source and one listener' };

  const objectMaterials: Record<string, string> = {};
  for (const [objectId, materialId] of Object.entries(assignments)) {
    objectMaterials[objectId] = materialId.replace(materialPrefix, '');
  }

  // Scope to the live acoustic region; fall back to the persisted ids only
  // when no region is defined.
  const regionIds = resolveSimulationGeometryObjectIds();
  const persisted = args.persistedGeometryIds;
  const geometryObjectIds = regionIds.length > 0
    ? regionIds
    : (persisted ? toBackendGeometryIds(persisted) : persisted);

  return {
    ok: true,
    request: {
      projectId: urlMatch[1],
      modelId: urlMatch[2],
      layerName: resolveSimulationLayerName(args.layerName),
      objectMaterials,
      geometryObjectIds,
      objectScattering: args.scatteringAssignments ?? {},
      sourceReceiverPairs: pairs,
      uniqueSourcePositions: uniquePositions,
      sourceSoundToPosKey: soundToPosKey,
    },
  };
}

/**
 * Fingerprint of everything that changes the prepared simulation mesh or its
 * diagnostics. Equal signatures ⇒ a preflight result is still valid.
 */
export function simulationRequestSignature(
  engine: SimulationEngine,
  request: SimulationGeometryRequest,
  meshSettings: SimulationMeshSettings,
  extra: { maxOrder?: number; rayTracing?: boolean } = {},
): string {
  const sortedEntries = <T,>(o: Record<string, T>) =>
    Object.keys(o).sort().map((k) => [k, o[k]] as const);
  return JSON.stringify([
    engine,
    request.projectId,
    request.modelId,
    request.layerName,
    sortedEntries(request.objectMaterials),
    [...(request.geometryObjectIds ?? [])].sort(),
    sortedEntries(request.objectScattering),
    request.sourceReceiverPairs.map((p) => [p.source_id, p.receiver_id, p.source_position, p.receiver_position]),
    meshSettings,
    extra.maxOrder ?? null,
    extra.rayTracing ?? null,
  ]);
}
