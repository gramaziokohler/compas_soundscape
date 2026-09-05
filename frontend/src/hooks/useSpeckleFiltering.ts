/**
 * Speckle Filtering Hook
 *
 * Thin wrapper over the unified visibility model in speckleStore. All hide /
 * isolate intent is recorded in the store and applied to the FilteringExtension
 * atomically by `applyVisibility()` (single stateKey, no per-frame re-apply).
 *
 * FilteringExtension keeps ONE global hiddenObjects array and ONE global
 * isolatedObjects array, and hide/isolate are mutually exclusive (verified
 * against @speckle/viewer@2.26.9). The store derives a single coherent target
 * from the user's intent + view mode + acoustic layer, so ObjectExplorer,
 * SceneContextMenu and the acoustic layer no longer fight over the same
 * extension state.
 */

import { useMemo } from 'react';
import { useSpeckleStore } from '@/store';

/**
 * Hook for managing object filtering (hide/isolate).
 *
 * @param _viewerRef - kept for signature compatibility; the store owns the viewer.
 * @param _stateKey - legacy parameter; the unified model uses one fixed stateKey.
 */
export function useSpeckleFiltering(
  _viewerRef?: React.RefObject<unknown> | null,
  _stateKey?: string,
) {
  const appliedHiddenIds = useSpeckleStore((s) => s.appliedHiddenIds);
  const appliedIsolatedIds = useSpeckleStore((s) => s.appliedIsolatedIds);

  const hiddenObjects = useMemo(() => new Set(appliedHiddenIds), [appliedHiddenIds]);
  const isolatedObjects = useMemo(() => new Set(appliedIsolatedIds), [appliedIsolatedIds]);

  const hideObjects = (objectIds: string[]) => {
    useSpeckleStore.getState().hideUserObjects(objectIds);
  };

  const showObjects = (objectIds: string[]) => {
    useSpeckleStore.getState().showUserObjects(objectIds);
  };

  const isolateObjects = (objectIds: string[]) => {
    useSpeckleStore.getState().isolateUserObjects(objectIds);
  };

  const unIsolateObjects = (objectIds: string[]) => {
    useSpeckleStore.getState().unIsolateUserObjects(objectIds);
  };

  const clearFilters = () => {
    useSpeckleStore.getState().resetUserVisibility();
  };

  const areObjectsHidden = (objectIds: string[]): boolean =>
    objectIds.every((id) => hiddenObjects.has(id));

  const areObjectsIsolated = (objectIds: string[]): boolean =>
    objectIds.every((id) => isolatedObjects.has(id));

  return {
    hiddenObjects,
    isolatedObjects,
    hideObjects,
    showObjects,
    isolateObjects,
    unIsolateObjects,
    areObjectsHidden,
    areObjectsIsolated,
    clearFilters,
  };
}
