/**
 * useAutoHideUnassignedObjects
 *
 * Hides the acoustic-region objects that carry no material (not part of the
 * simulation) through the Object Explorer's acoustic "hide" state, so each one
 * can be re-shown with its eye button. `cardKey` names the simulation card the
 * rule currently applies to (null = inactive: every auto-hide is restored).
 * Switching cards restores the previous card's auto-hides and applies the new
 * card's.
 *
 * Assignment source: the live material store when the card owns it (expanded
 * card — includes unsaved Object Explorer edits), otherwise the card's persisted
 * `speckleMaterialAssignments` (e.g. a powered-on card that is not expanded).
 */

'use client';

import { useEffect, useMemo } from 'react';
import { useAcousticLayerStore, useAcousticMaterialStore, useSpeckleStore } from '@/store';
import { buildAssignmentIdMaps, expandSavedAssignments } from '@/utils/speckle-assignment-ids';

interface UseAutoHideUnassignedObjectsOptions {
  /** Owning simulation card id, or null when the rule is inactive. */
  cardKey: string | null;
  /**
   * The card's persisted assignments (applicationId / geometry id → material id),
   * or null to read the live material store (the card owns it).
   */
  savedAssignments: Record<string, string> | null;
  /** Viewer world tree — maps persisted applicationIds to current geometry ids. */
  worldTree: unknown;
}

export function useAutoHideUnassignedObjects({
  cardKey,
  savedAssignments,
  worldTree,
}: UseAutoHideUnassignedObjectsOptions): void {
  // Resolved acoustic-region geometry leaves (empty for "whole model", where the
  // acoustic explorer hide is not applied — the rule stays inactive there).
  const regionIds = useAcousticLayerStore((s) => s.selectedAcousticGeometryIds);
  const storeAssignments = useAcousticMaterialStore((s) => s.materialAssignments);

  // Whole-tree walk — only needed (and only rebuilt) when reading persisted assignments.
  const needsIdMaps = savedAssignments !== null;
  const idMaps = useMemo(
    () => (needsIdMaps ? buildAssignmentIdMaps(worldTree) : null),
    [needsIdMaps, worldTree],
  );
  const assignedIds = useMemo<ReadonlyMap<string, string>>(
    () => savedAssignments === null || idMaps === null
      ? storeAssignments
      : expandSavedAssignments(savedAssignments, idMaps.geometryIdToAppId, idMaps.appIdToGeometryIds),
    [savedAssignments, storeAssignments, idMaps],
  );

  const unassignedIds = useMemo(
    () => regionIds.filter((id) => !assignedIds.has(id)),
    [regionIds, assignedIds],
  );

  const effectiveKey = cardKey !== null && regionIds.length > 0 ? cardKey : null;

  useEffect(() => {
    useSpeckleStore.getState().syncAutoHiddenIds(effectiveKey, effectiveKey ? unassignedIds : []);
  }, [effectiveKey, unassignedIds]);

  useEffect(() => () => useSpeckleStore.getState().syncAutoHiddenIds(null, []), []);
}
