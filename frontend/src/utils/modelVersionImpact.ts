/**
 * Request builders and formatters for model-version impact reports.
 *
 * The acoustic region is sent with every id the backend can match on either
 * version: the live geometry ids (raw hashes of the loaded version) plus the
 * material-assignment keys (applicationIds, stable across versions), and the
 * region's layer names — so objects removed in the new version are still
 * recognised as part of the region in the old one.
 */

import { useAcousticLayerStore, toBackendGeometryIds } from '@/store/acousticLayerStore';
import { useAcousticMaterialStore } from '@/store/acousticMaterialStore';
import { useReceiversStore } from '@/store/receiversStore';
import { useSoundscapeStore, promptMatchesCard } from '@/store/soundscapeStore';
import type { SimulationConfig } from '@/types/acoustics';
import type {
  ModelVersionImpactReport,
  ModelVersionImpactRequest,
  ModelVersionObjectImpact,
  ModelVersionPlacementPoint,
  ModelVersionRegion,
  ModelVersionTolerance,
} from '@/types/modelVersionImpact';

/** Region name used by the Object Explorer for ad-hoc picks (not a real layer). */
const CUSTOM_SELECTION_NAME = 'Custom selection';

const PLACEMENT_RECEIVER_PREFIX = 'receiver:';
const PLACEMENT_SOUND_PREFIX = 'sound:';

function regionFrom(
  isWholeModel: boolean,
  geometryIds: string[],
  layerNames: string[],
  materialKeys: string[],
): ModelVersionRegion | null {
  const layers = layerNames.filter((n) => n && n !== CUSTOM_SELECTION_NAME);
  const ids = Array.from(new Set([...toBackendGeometryIds(geometryIds), ...toBackendGeometryIds(materialKeys)]));
  if (isWholeModel || (ids.length === 0 && layers.length === 0)) return { whole_model: true, ids: [], layers: [] };
  return { whole_model: false, ids, layers };
}

/** The live acoustic region of the loaded model. */
export function buildLiveRegion(): ModelVersionRegion | null {
  const layer = useAcousticLayerStore.getState();
  const materials = useAcousticMaterialStore.getState().materialAssignments;
  return regionFrom(
    layer.isWholeModel,
    layer.selectedAcousticGeometryIds,
    layer.selectedAcousticLayerNames,
    Array.from(materials.keys()),
  );
}

/** The region a simulation card was simulated with (its snapshot + its materials). */
export function buildCardRegion(config: SimulationConfig): ModelVersionRegion | null {
  const sel = config.speckleAcousticSelection;
  const assignments = (config as { speckleMaterialAssignments?: Record<string, string> }).speckleMaterialAssignments ?? {};
  return regionFrom(
    sel?.isWholeModel ?? false,
    sel?.geometryIds ?? [],
    sel?.nodeNames ?? [],
    Object.keys(assignments),
  );
}

/**
 * Impact request for a completed simulation card: from the version it ran on to
 * the loaded one, scoped to its own region. `null` when it ran on the loaded
 * version or predates version tracking.
 */
export function buildSimulationImpactRequest(
  config: SimulationConfig,
  loadedVersionId: string | null,
  tolerance: ModelVersionTolerance,
): ModelVersionImpactRequest | null {
  const from = config.state === 'completed' ? config.simulatedVersionId : undefined;
  if (!from || !loadedVersionId || from === loadedVersionId) return null;
  return { from_version_id: from, to_version_id: loadedVersionId, tolerance, region: buildCardRegion(config), points: [] };
}

/** Listeners and free (not object-linked) sounds, checked against the new geometry. */
export function buildPlacementPoints(): ModelVersionPlacementPoint[] {
  const points: ModelVersionPlacementPoint[] = [];
  for (const r of useReceiversStore.getState().receivers) {
    if (r.position?.length === 3) points.push({ id: `${PLACEMENT_RECEIVER_PREFIX}${r.id}`, position: r.position });
  }
  const { soundConfigs, generatedSounds } = useSoundscapeStore.getState();
  soundConfigs.forEach((config, index) => {
    if (config.entities?.length) return;
    const event = (generatedSounds as Array<{ id: string; prompt_index?: number; position?: number[] }>).find(
      (s) => promptMatchesCard(s.prompt_index, index) && s.position?.length === 3,
    );
    if (event?.position) {
      points.push({
        id: `${PLACEMENT_SOUND_PREFIX}${config.config_id ?? event.id}`,
        position: [event.position[0], event.position[1], event.position[2]],
      });
    }
  });
  return points;
}

/** Split a placement id back into its kind and the receiver / card id. */
export function parsePlacementId(id: string): { kind: 'receiver' | 'sound'; refId: string } | null {
  if (id.startsWith(PLACEMENT_RECEIVER_PREFIX)) return { kind: 'receiver', refId: id.slice(PLACEMENT_RECEIVER_PREFIX.length) };
  if (id.startsWith(PLACEMENT_SOUND_PREFIX)) return { kind: 'sound', refId: id.slice(PLACEMENT_SOUND_PREFIX.length) };
  return null;
}

/** Acoustic-region objects that changed above tolerance, were added or removed. */
export function regionChanges(report: ModelVersionImpactReport): ModelVersionObjectImpact[] {
  return report.objects.filter((o) => o.in_region && o.status !== 'below_tolerance');
}

/** True when the region geometry changed above tolerance (results are outdated). */
export function isRegionOutdated(report: ModelVersionImpactReport): boolean {
  const c = report.region_counts;
  return c.changed + c.added + c.removed > 0;
}

/** Short description of an object change ("moved 0.42 m", "scaled 104 %", "new"…). */
export function describeObjectChange(obj: ModelVersionObjectImpact): string {
  if (obj.status === 'added') return 'new';
  if (obj.status === 'removed') return 'removed';
  const c = obj.change;
  if (!c) return 'changed';
  switch (c.kind) {
    case 'moved':
      return `moved ${c.moved_m.toFixed(2)} m`;
    case 'rotated':
      return c.rotation_deg > 0 ? `rotated ${Math.round(c.rotation_deg)}°` : 'rotated';
    case 'scaled':
      return c.scale ? `scaled ${Math.round(c.scale * 100)} %` : 'scaled';
    default:
      return 'reshaped';
  }
}

/**
 * Material id assigned to an object. Live assignments are keyed by viewer tree /
 * geometry-leaf ids (pass them as `geometryIds`), persisted ones by applicationId.
 */
export function assignedMaterialId(
  obj: ModelVersionObjectImpact,
  assignments: Map<string, string>,
  geometryIds: string[] = [],
): string | null {
  const keys = [obj.application_id, ...obj.raw_ids, ...geometryIds].filter((k): k is string => !!k);
  for (const [id, materialId] of assignments) {
    const bare = id.includes('#') ? id.slice(0, id.indexOf('#')) : id;
    if (keys.includes(id) || keys.includes(bare)) return materialId;
  }
  return null;
}

/** Relative change, e.g. "+6 %", for region totals. */
export function formatRelativeChange(before: number, after: number): string {
  if (before <= 0) return after > 0 ? 'new' : '0 %';
  const pct = Math.round((after / before - 1) * 100);
  return `${pct > 0 ? '+' : ''}${pct} %`;
}
