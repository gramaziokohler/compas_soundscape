/**
 * Shared assembly of a Speckle simulation request.
 *
 * The pyroomacoustics run and the geometry preflight must send
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
import { customMaterialDefinitions, isCustomMaterialId } from '@/store/customMaterialStore';
import { directivityLabel, isResolvableDirectivityId } from '@/store/directivityStore';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import { collapseVariantsToOne, groupSoundsByPosition, isOmniDirectivity } from '@/utils/positionKey';
import type { SoundDirectivity } from '@/types/directivity';
import type { CustomMaterialCoefficients } from '@/types/materials';
import type { SimulationEngine, SimulationMeshSettings } from '@/types/simulationPreflight';

export interface SourceReceiverPair {
  source_position: number[];
  receiver_position: number[];
  source_id: string;
  receiver_id: string;
  /** Radiation pattern + orientation of the source (absent = omnidirectional). */
  source_directivity?: SoundDirectivity;
}

export interface SimulationGeometryRequest {
  projectId: string;
  modelId: string;
  /** Speckle version the viewer shows — what the engine must simulate (see resolveSimulationVersionId). */
  versionId: string;
  layerName: string;
  objectMaterials: Record<string, string>;
  /** Coefficients of the user-defined materials in objectMaterials (resolved inline by the backend). */
  customMaterials: Record<string, CustomMaterialCoefficients>;
  geometryObjectIds?: string[];
  objectScattering: Record<string, number>;
  sourceReceiverPairs: SourceReceiverPair[];
  /** posKey → simulated source position (stored as simulationPositions.sources). */
  uniqueSourcePositions: Map<string, [number, number, number]>;
  /** sound id → posKey (stored as simulationPositions.soundToPosKey). */
  sourceSoundToPosKey: Map<string, string>;
  /** posKey → directivity of the directional sources (stored as simulationPositions.sourceDirectivities). */
  uniqueSourceDirectivities: Record<string, SoundDirectivity>;
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
  sounds: Array<{
    id: string;
    position: [number, number, number];
    prompt_index?: number;
    copy_index?: number;
    directivity?: SoundDirectivity;
  }>;
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

/**
 * Speckle id the backend resolves the simulated geometry from: the version
 * loaded in the viewer. Sending the bare model id makes the backend fall back
 * to the model's LATEST version, which silently diverges from the viewer as
 * soon as an older version is open. The model id is only a fallback when no
 * version is known yet (local sandbox).
 */
export function resolveSimulationVersionId(modelId: string): string {
  return useSpeckleEngineStore.getState().loadedModelVersionId || modelId;
}

/** Build the geometry inputs of a simulation / preflight from a card's state. */
export function buildSimulationGeometryRequest(args: BuildArgs): BuildResult {
  const { speckleUrl, receivers, sounds, selectedVariants, materialPrefix } = args;
  const assignments = args.materialAssignments ?? {};
  if (Object.keys(assignments).length === 0) return { ok: false, error: 'Assign materials first' };

  const urlMatch = speckleUrl.match(SPECKLE_MODEL_URL);
  if (!urlMatch) return { ok: false, error: 'Invalid Speckle URL' };

  // Variants of one source (same prompt_index) collapse to a single simulated source;
  // co-located sounds with different directivities stay separate sources (key suffix).
  const sourceSounds = collapseVariantsToOne(sounds, selectedVariants);
  const { uniquePositions, soundToPosKey, sourceDirectivities } = groupSoundsByPosition(sourceSounds);

  const uniqueSourceDirectivities: Record<string, SoundDirectivity> = {};
  for (const [posKey, directivity] of sourceDirectivities) {
    if (isOmniDirectivity(directivity)) continue;
    const d = directivity as SoundDirectivity;
    if (!isResolvableDirectivityId(d.id)) {
      return { ok: false, error: `The directivity "${directivityLabel(d.id)}" of a sound is no longer available — pick another one` };
    }
    uniqueSourceDirectivities[posKey] = { id: d.id, yaw: d.yaw ?? 0, pitch: d.pitch ?? 0, roll: d.roll ?? 0 };
  }

  const pairs: SourceReceiverPair[] = [];
  for (const [posKey, pos] of uniquePositions) {
    for (const receiver of receivers) {
      if (!receiver.position || receiver.position.length !== 3) {
        return { ok: false, error: `Receiver "${receiver.id}" has an invalid position.` };
      }
      pairs.push({
        source_position: pos,
        receiver_position: receiver.position,
        source_id: posKey,
        receiver_id: receiver.id,
        ...(uniqueSourceDirectivities[posKey] ? { source_directivity: uniqueSourceDirectivities[posKey] } : {}),
      });
    }
  }
  if (pairs.length === 0) return { ok: false, error: 'Add at least one sound source and one listener' };

  const objectMaterials: Record<string, string> = {};
  for (const [objectId, materialId] of Object.entries(assignments)) {
    objectMaterials[objectId] = materialId.replace(materialPrefix, '');
  }
  const customMaterials = customMaterialDefinitions(Object.values(objectMaterials));
  const missingCustom = Object.values(objectMaterials).find(
    (id) => isCustomMaterialId(id) && !customMaterials[id],
  );
  if (missingCustom) {
    return { ok: false, error: 'A custom material assigned to this model was deleted — reassign those surfaces' };
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
      versionId: resolveSimulationVersionId(urlMatch[2]),
      layerName: resolveSimulationLayerName(args.layerName),
      objectMaterials,
      customMaterials,
      geometryObjectIds,
      objectScattering: args.scatteringAssignments ?? {},
      sourceReceiverPairs: pairs,
      uniqueSourcePositions: uniquePositions,
      sourceSoundToPosKey: soundToPosKey,
      uniqueSourceDirectivities,
    },
  };
}

/** `simulationPositions` fields derived from a built request (stored with the result). */
export function simulationSourceSnapshot(request: SimulationGeometryRequest): {
  sources: Record<string, [number, number, number]>;
  soundToPosKey: Record<string, string>;
  sourceDirectivities?: Record<string, SoundDirectivity>;
} {
  const hasDirectional = Object.keys(request.uniqueSourceDirectivities).length > 0;
  return {
    sources: Object.fromEntries(request.uniqueSourcePositions.entries()),
    soundToPosKey: Object.fromEntries(request.sourceSoundToPosKey.entries()),
    ...(hasDirectional ? { sourceDirectivities: { ...request.uniqueSourceDirectivities } } : {}),
  };
}

/** Engine settings that change the check result (pyroom ISM preflight / PFFDTD voxel grid). */
export interface SimulationSignatureExtra {
  maxOrder?: number;
  rayTracing?: boolean;
  fmax?: number;
  ppw?: number;
}

/**
 * Fingerprint of everything that changes the prepared simulation mesh or its
 * diagnostics (geometry preflight), or the PFFDTD voxel grid (voxel preview). Equal signatures ⇒ a preflight result is still valid.
 */
export function simulationRequestSignature(
  engine: SimulationEngine | 'pffdtd',
  request: SimulationGeometryRequest,
  meshSettings: SimulationMeshSettings,
  extra: SimulationSignatureExtra = {},
): string {
  const sortedEntries = <T,>(o: Record<string, T>) =>
    Object.keys(o).sort().map((k) => [k, o[k]] as const);
  return JSON.stringify([
    engine,
    request.projectId,
    request.modelId,
    request.versionId,
    request.layerName,
    sortedEntries(request.objectMaterials),
    sortedEntries(request.customMaterials),
    [...(request.geometryObjectIds ?? [])].sort(),
    sortedEntries(request.objectScattering),
    request.sourceReceiverPairs.map((p) => [
      p.source_id, p.receiver_id, p.source_position, p.receiver_position, p.source_directivity ?? null,
    ]),
    meshSettings,
    extra.maxOrder ?? null,
    extra.rayTracing ?? null,
    extra.fmax ?? null,
    extra.ppw ?? null,
  ]);
}
