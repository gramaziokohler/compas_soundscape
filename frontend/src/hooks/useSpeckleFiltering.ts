/**
 * Speckle Filtering Hook
 *
 * Manages hide/isolate functionality for Speckle viewer objects using FilteringExtension.
 *
 * Based on Speckle docs:
 * - https://docs.speckle.systems/developers/viewer/examples/filtering-example
 * - https://docs.speckle.systems/developers/viewer/extensions/filtering-extension-api
 *
 * Implementation:
 * - Uses FilteringExtension API (hideObjects, showObjects, isolateObjects, unIsolateObjects)
 * - Tracks state via extension's filteringState accessor
 * - Follows the pattern from VirtualTreeItem.vue
 *
 * stateKey parameter provides independent filtering contexts per caller.
 * Different callers (ObjectExplorer in acoustic vs default mode, SpeckleSurfaceMaterials)
 * use different stateKeys so their hide/isolate states don't conflict.
 */

import { useState, useCallback, useEffect } from 'react';
import { Viewer, FilteringExtension } from '@speckle/viewer';
import type { ObjectColorGroup } from '@/types/speckle-materials';
import { useSpeckleStore } from '@/store';
import { reapplyPostIsolateHides } from '@/store/speckleStore';

/**
 * Hook for managing object filtering (hide/isolate)
 *
 * Follows Vue reference pattern: reads directly from filteringExtension.filteringState
 * instead of maintaining local state copies (which caused stale closure bugs)
 *
 * @param viewerRef - React ref to the Speckle Viewer instance
 * @param stateKey - Unique key to partition filtering state (e.g. 'explorer-default', 'explorer-acoustic')
 */
export function useSpeckleFiltering(viewerRef: React.RefObject<Viewer | null>, stateKey: string = 'explorer-default') {
  const [filteringExtension, setFilteringExtension] = useState<FilteringExtension | null>(null);
  const [, forceUpdate] = useState(0);
  const trackExplorerHide      = useSpeckleStore((s) => s.trackExplorerHide);
  const trackExplorerShow      = useSpeckleStore((s) => s.trackExplorerShow);
  const clearExplorerHidden    = useSpeckleStore((s) => s.clearExplorerHidden);
  const trackExplorerIsolate      = useSpeckleStore((s) => s.trackExplorerIsolate);
  const removeFromExplorerIsolation = useSpeckleStore((s) => s.removeFromExplorerIsolation);
  const clearExplorerIsolation    = useSpeckleStore((s) => s.clearExplorerIsolation);

  useEffect(() => {
    if (!viewerRef.current) {
      if (filteringExtension !== null) {
        setFilteringExtension(null);
        console.log('[useSpeckleFiltering] Viewer ref cleared, resetting extension');
      }
      return;
    }

    try {
      const extension = viewerRef.current.getExtension(FilteringExtension);
      if (extension !== filteringExtension) {
        setFilteringExtension(extension);
        console.log('[useSpeckleFiltering] FilteringExtension obtained:', extension, 'stateKey:', stateKey);
      }
    } catch (error) {
      console.error('[useSpeckleFiltering] Failed to get FilteringExtension:', error);
    }
  }, [viewerRef, viewerRef.current]);

  const triggerUpdate = useCallback(() => {
    forceUpdate(prev => prev + 1);
  }, []);

  const getHiddenObjects = useCallback((): Set<string> => {
    if (!filteringExtension) return new Set();
    const state = filteringExtension.filteringState;
    return new Set(state?.hiddenObjects || []);
  }, [filteringExtension]);

  const getIsolatedObjects = useCallback((): Set<string> => {
    if (!filteringExtension) return new Set();
    const state = filteringExtension.filteringState;
    return new Set(state?.isolatedObjects || []);
  }, [filteringExtension]);

  const hiddenObjects = getHiddenObjects();
  const isolatedObjects = getIsolatedObjects();

  const hideObjects = useCallback((objectIds: string[]) => {
    if (!filteringExtension) {
      console.warn('[useSpeckleFiltering] FilteringExtension not available');
      return;
    }

    try {
      console.log('[useSpeckleFiltering] hideObjects called - IDs:', objectIds, 'stateKey:', stateKey);

      filteringExtension.hideObjects(
        objectIds,
        stateKey,
        true,
        false,
      );

      triggerUpdate();
      viewerRef.current?.requestRender();
      trackExplorerHide(objectIds, stateKey);

      console.log('[useSpeckleFiltering] hideObjects complete - New state:', filteringExtension.filteringState?.hiddenObjects);
    } catch (error) {
      console.error('[useSpeckleFiltering] Failed to hide objects:', error);
    }
  }, [filteringExtension, triggerUpdate, trackExplorerHide, stateKey]);

  const showObjects = useCallback((objectIds: string[]) => {
    if (!filteringExtension) {
      console.warn('[useSpeckleFiltering] FilteringExtension not available');
      return;
    }

    try {
      console.log('[useSpeckleFiltering] showObjects called - IDs:', objectIds, 'stateKey:', stateKey);

      filteringExtension.showObjects(
        objectIds,
        stateKey,
        true,
      );

      triggerUpdate();
      viewerRef.current?.requestRender();
      trackExplorerShow(objectIds, stateKey);

      console.log('[useSpeckleFiltering] showObjects complete - New state:', filteringExtension.filteringState?.hiddenObjects);
    } catch (error) {
      console.error('[useSpeckleFiltering] Failed to show objects:', error);
    }
  }, [filteringExtension, triggerUpdate, trackExplorerShow, stateKey]);

  const isolateObjects = useCallback((objectIds: string[]) => {
    if (!filteringExtension) {
      console.warn('[useSpeckleFiltering] FilteringExtension not available');
      return;
    }

    try {
      const existingIds = useSpeckleStore.getState().getExplorerIsolatedIds(stateKey);
      const idsToIsolate = existingIds
        ? [...new Set([...existingIds, ...objectIds])]
        : objectIds;

      filteringExtension.isolateObjects(
        idsToIsolate,
        stateKey,
        true,
        true,  // ghost=true — visually ghost non-isolated objects
      );

      triggerUpdate();
      // Speckle's isolateObjects and hideObjects are mutually exclusive —
      // the last call wins regardless of stateKey. Compose both states
      // before rendering: isolate → re-hide → re-isolate → render.
      // The rAF re-apply timer will fix any lingering hide loss (<16ms).
      reapplyPostIsolateHides();
      filteringExtension.isolateObjects(
        idsToIsolate,
        stateKey,
        true,
        true,
      );
      viewerRef.current?.requestRender();

      trackExplorerIsolate(idsToIsolate, stateKey);
    } catch (error) {
      console.error('[useSpeckleFiltering] Failed to isolate objects:', error);
    }
  }, [filteringExtension, triggerUpdate, trackExplorerIsolate, stateKey]);

  const unIsolateObjects = useCallback((objectIds: string[]) => {
    if (!filteringExtension) {
      console.warn('[useSpeckleFiltering] FilteringExtension not available');
      return;
    }

    try {
      console.log('[useSpeckleFiltering] unIsolateObjects called - IDs:', objectIds, 'stateKey:', stateKey);

      const existingIds = useSpeckleStore.getState().getExplorerIsolatedIds(stateKey);
      const remainingIds = existingIds
        ? existingIds.filter((id: string) => !objectIds.includes(id))
        : [];

      triggerUpdate();

      if (remainingIds.length > 0) {
        // Speckle's unIsolateObjects clears ALL isolation for the stateKey.
        // Instead, re-isolate with only the remaining IDs to keep them visible.
        filteringExtension.isolateObjects(remainingIds, stateKey, true, true);
        reapplyPostIsolateHides();
        filteringExtension.isolateObjects(remainingIds, stateKey, true, true);
        viewerRef.current?.requestRender();
      } else {
        filteringExtension.unIsolateObjects(objectIds, stateKey, true, false);
        reapplyPostIsolateHides();
        viewerRef.current?.requestRender();
      }

      removeFromExplorerIsolation(objectIds, stateKey);

      console.log('[useSpeckleFiltering] unIsolateObjects complete - remaining isolated:', remainingIds.length);
    } catch (error) {
      console.error('[useSpeckleFiltering] Failed to un-isolate objects:', error);
    }
  }, [filteringExtension, triggerUpdate, removeFromExplorerIsolation, stateKey]);

  const areObjectsHidden = useCallback((objectIds: string[]): boolean => {
    return objectIds.every(id => hiddenObjects.has(id));
  }, [hiddenObjects]);

  const areObjectsIsolated = useCallback((objectIds: string[]): boolean => {
    return objectIds.every(id => isolatedObjects.has(id));
  }, [isolatedObjects]);

  const clearFilters = useCallback(() => {
    if (!filteringExtension) {
      console.warn('[useSpeckleFiltering] FilteringExtension not available');
      return;
    }

    try {
      console.log('[useSpeckleFiltering] clearFilters called - stateKey:', stateKey);

      filteringExtension.resetFilters();

      triggerUpdate();
      viewerRef.current?.requestRender();
      clearExplorerHidden(stateKey);
      clearExplorerIsolation(stateKey);

      console.log('[useSpeckleFiltering] clearFilters complete');
    } catch (error) {
      console.error('[useSpeckleFiltering] Failed to clear filters:', error);
    }
  }, [filteringExtension, triggerUpdate, clearExplorerHidden, clearExplorerIsolation, stateKey]);

  const setUserObjectColors = useCallback((groups: ObjectColorGroup[]) => {
    if (!filteringExtension) {
      console.warn('[useSpeckleFiltering] FilteringExtension not available');
      return;
    }

    try {
      console.log('[useSpeckleFiltering] setUserObjectColors called - Groups:', groups.length);

      filteringExtension.setUserObjectColors(groups);

      viewerRef.current?.requestRender();

      console.log('[useSpeckleFiltering] setUserObjectColors complete');
    } catch (error) {
      console.error('[useSpeckleFiltering] Failed to set user object colors:', error);
    }
  }, [filteringExtension, viewerRef]);

  const removeUserObjectColors = useCallback(() => {
    if (!filteringExtension) {
      console.warn('[useSpeckleFiltering] FilteringExtension not available');
      return;
    }

    try {
      console.log('[useSpeckleFiltering] removeUserObjectColors called');

      filteringExtension.removeUserObjectColors();

      viewerRef.current?.requestRender();

      console.log('[useSpeckleFiltering] removeUserObjectColors complete');
    } catch (error) {
      console.error('[useSpeckleFiltering] Failed to remove user object colors:', error);
    }
  }, [filteringExtension, viewerRef]);

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
    setUserObjectColors,
    removeUserObjectColors
  };
}
