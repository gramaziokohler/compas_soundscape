/**
 * speckle-assignment-ids
 *
 * Whole-model id maps between the Object Explorer's geometry ids and the
 * applicationIds persisted assignments are keyed by.
 *
 * The Object Explorer keys assignments by the viewer's UNIQUE node id
 * (model.id — duplicate-id nodes carry a `#N` suffix so each duplicate surface
 * is addressable independently). Persistence uses applicationId (stable across
 * model republishes). Both directions are built across the ENTIRE model.
 */

import { getExplorerNodeId } from '@/hooks/useSpeckleTree';

export interface AssignmentIdMaps {
  geometryIdToAppId: Map<string, string>;
  /** Plural: a carrier and its display meshes share an applicationId. */
  appIdToGeometryIds: Map<string, string[]>;
}

function getRootChildren(worldTree: any): any[] {
  if (!worldTree) return [];
  if (worldTree.tree?._root?.children) return worldTree.tree._root.children;
  if (worldTree._root?.children) return worldTree._root.children;
  if (worldTree.root?.children) return worldTree.root.children;
  if (worldTree.children) return worldTree.children;
  return [];
}

function walkCollectIdMaps(nodes: any[], maps: AssignmentIdMaps): void {
  for (const node of nodes) {
    const raw = node?.raw || node?.model?.raw || {};
    const geometryId: string | undefined = getExplorerNodeId(node);
    const appId: string | undefined = raw.applicationId;
    if (geometryId && appId) {
      maps.geometryIdToAppId.set(geometryId, appId);
      // A Brep/BIM object and its display mesh(es) share the SAME applicationId
      // (verified against live Speckle data). Persisted assignments are keyed by
      // applicationId, so record EVERY geometry id that carries it — otherwise the
      // remap resolves only the first (the carrier) and the display-mesh tree rows
      // in the Object Explorer keep showing "Select...".
      const existing = maps.appIdToGeometryIds.get(appId);
      if (existing) {
        if (!existing.includes(geometryId)) existing.push(geometryId);
      } else {
        maps.appIdToGeometryIds.set(appId, [geometryId]);
      }
    }
    const children = node?.model?.children || node?.children || [];
    if (children.length > 0) walkCollectIdMaps(children, maps);
  }
}

/** Build the geometry-id ↔ applicationId maps for a viewer world tree. */
export function buildAssignmentIdMaps(worldTree: any): AssignmentIdMaps {
  const maps: AssignmentIdMaps = { geometryIdToAppId: new Map(), appIdToGeometryIds: new Map() };
  if (worldTree) walkCollectIdMaps(getRootChildren(worldTree), maps);
  return maps;
}

/**
 * Expand persisted assignments (keyed by applicationId or a current geometry id)
 * into a Map keyed by EVERY current geometry id that shares the source
 * applicationId. This keeps the Object Explorer's mesh rows in sync with the
 * carrier rows and with the colors the viewer renders.
 */
export function expandSavedAssignments<T extends string | number>(
  source: Record<string, T> | undefined,
  geometryIdToAppId: Map<string, string>,
  appIdToGeometryIds: Map<string, string[]>,
): Map<string, T> {
  const out = new Map<string, T>();
  if (!source) return out;
  for (const [key, value] of Object.entries(source)) {
    if (geometryIdToAppId.has(key)) {
      // Already a current geometry id.
      out.set(key, value);
      continue;
    }
    const raws = appIdToGeometryIds.get(key);
    if (raws && raws.length > 0) {
      for (const id of raws) out.set(id, value);
      continue;
    }
    // Unknown — keep as-is (best effort) until the id maps are ready.
    out.set(key, value);
  }
  return out;
}
