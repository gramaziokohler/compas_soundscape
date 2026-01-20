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
 */

import { useState, useCallback, useEffect } from 'react';
import { Viewer, FilteringExtension } from '@speckle/viewer';
import type { ObjectColorGroup } from '@/types/speckle-materials';

/**
 * Hook for managing object filtering (hide/isolate)
 *
 * Follows Vue reference pattern: reads directly from filteringExtension.filteringState
 * instead of maintaining local state copies (which caused stale closure bugs)
 */
export function useSpeckleFiltering(viewerRef: React.RefObject<Viewer | null>) {
  const [filteringExtension, setFilteringExtension] = useState<FilteringExtension | null>(null);
  // Force re-render trigger when state changes
  const [, forceUpdate] = useState(0);

  // Get FilteringExtension when viewer is available
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
        console.log('[useSpeckleFiltering] FilteringExtension obtained:', extension);
      }
    } catch (error) {
      console.error('[useSpeckleFiltering] Failed to get FilteringExtension:', error);
    }
  }, [viewerRef, viewerRef.current]);

  // Helper to trigger re-render
  const triggerUpdate = useCallback(() => {
    forceUpdate(prev => prev + 1);
  }, []);

  // Read state directly from extension (like Vue computed properties)
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

  // For compatibility, expose as properties (but these read live from extension)
  const hiddenObjects = getHiddenObjects();
  const isolatedObjects = getIsolatedObjects();

  /**
   * Hide specific objects using FilteringExtension
   */
  const hideObjects = useCallback((objectIds: string[]) => {
    if (!filteringExtension) {
      console.warn('[useSpeckleFiltering] FilteringExtension not available');
      return;
    }

    try {
      console.log('[useSpeckleFiltering] hideObjects called - IDs:', objectIds);

      // Use FilteringExtension API with includeDescendants (like isolate)
      // Parameters: objectIds, stateKey, includeDescendants, ghost
      filteringExtension.hideObjects(
        objectIds,
        undefined, // stateKey
        true,      // includeDescendants - hide children too!
        false      // ghost
      );

      // Trigger re-render to read fresh state from extension
      triggerUpdate();

      console.log('[useSpeckleFiltering] hideObjects complete - New state:', filteringExtension.filteringState?.hiddenObjects);
    } catch (error) {
      console.error('[useSpeckleFiltering] Failed to hide objects:', error);
    }
  }, [filteringExtension, triggerUpdate]);

  /**
   * Show specific objects using FilteringExtension
   */
  const showObjects = useCallback((objectIds: string[]) => {
    if (!filteringExtension) {
      console.warn('[useSpeckleFiltering] FilteringExtension not available');
      return;
    }

    try {
      console.log('[useSpeckleFiltering] showObjects called - IDs:', objectIds);

      // Use FilteringExtension API with includeDescendants (like isolate)
      // Parameters: objectIds, stateKey, includeDescendants
      filteringExtension.showObjects(
        objectIds,
        undefined, // stateKey
        true       // includeDescendants - show children too!
      );

      // Trigger re-render to read fresh state from extension
      triggerUpdate();

      console.log('[useSpeckleFiltering] showObjects complete - New state:', filteringExtension.filteringState?.hiddenObjects);
    } catch (error) {
      console.error('[useSpeckleFiltering] Failed to show objects:', error);
    }
  }, [filteringExtension, triggerUpdate]);

  /**
   * Isolate specific objects using FilteringExtension
   * Hides all other objects, showing only the isolated ones
   */
  const isolateObjects = useCallback((objectIds: string[]) => {
    if (!filteringExtension) {
      console.warn('[useSpeckleFiltering] FilteringExtension not available');
      return;
    }

    try {
      console.log('[useSpeckleFiltering] isolateObjects called - IDs:', objectIds);

      // Use FilteringExtension API (like Vue version)
      // Parameters: objectIds, stateKey, includeDescendants, ghost
      filteringExtension.isolateObjects(
        objectIds,
        undefined, // stateKey
        true,      // includeDescendants - include child objects
        false      // ghost - don't ghost other objects, hide them completely
      );

      // Trigger re-render to read fresh state from extension
      triggerUpdate();

      console.log('[useSpeckleFiltering] isolateObjects complete - New state:', filteringExtension.filteringState?.isolatedObjects);
    } catch (error) {
      console.error('[useSpeckleFiltering] Failed to isolate objects:', error);
    }
  }, [filteringExtension, triggerUpdate]);

  /**
   * Un-isolate specific objects using FilteringExtension
   * Restores visibility to all objects
   */
  const unIsolateObjects = useCallback((objectIds: string[]) => {
    if (!filteringExtension) {
      console.warn('[useSpeckleFiltering] FilteringExtension not available');
      return;
    }

    try {
      console.log('[useSpeckleFiltering] unIsolateObjects called - IDs:', objectIds);

      // Use FilteringExtension API (like Vue version)
      // Parameters: objectIds, stateKey, includeDescendants, ghost
      filteringExtension.unIsolateObjects(
        objectIds,
        undefined, // stateKey
        true,      // includeDescendants
        false      // ghost
      );

      // Trigger re-render to read fresh state from extension
      triggerUpdate();

      console.log('[useSpeckleFiltering] unIsolateObjects complete - New state:', filteringExtension.filteringState?.isolatedObjects);
    } catch (error) {
      console.error('[useSpeckleFiltering] Failed to un-isolate objects:', error);
    }
  }, [filteringExtension, triggerUpdate]);

  /**
   * Check if objects are hidden
   */
  const areObjectsHidden = useCallback((objectIds: string[]): boolean => {
    return objectIds.every(id => hiddenObjects.has(id));
  }, [hiddenObjects]);

  /**
   * Check if objects are isolated
   */
  const areObjectsIsolated = useCallback((objectIds: string[]): boolean => {
    return objectIds.every(id => isolatedObjects.has(id));
  }, [isolatedObjects]);

  /**
   * Clear all filters using FilteringExtension
   */
  const clearFilters = useCallback(() => {
    if (!filteringExtension) {
      console.warn('[useSpeckleFiltering] FilteringExtension not available');
      return;
    }

    try {
      console.log('[useSpeckleFiltering] clearFilters called');

      // Use FilteringExtension API to reset all filters (like Vue version)
      filteringExtension.resetFilters();

      // Trigger re-render to read fresh state from extension
      triggerUpdate();

      console.log('[useSpeckleFiltering] clearFilters complete');
    } catch (error) {
      console.error('[useSpeckleFiltering] Failed to clear filters:', error);
    }
  }, [filteringExtension, triggerUpdate]);

  /**
   * Set custom colors for objects using FilteringExtension
   * Used for material visualization in acoustic simulations
   * 
   * @param groups Array of color groups with object IDs and hex colors
   */
  const setUserObjectColors = useCallback((groups: ObjectColorGroup[]) => {
    if (!filteringExtension) {
      console.warn('[useSpeckleFiltering] FilteringExtension not available');
      return;
    }

    try {
      console.log('[useSpeckleFiltering] setUserObjectColors called - Groups:', groups.length);

      // Use FilteringExtension API to set custom object colors
      filteringExtension.setUserObjectColors(groups);

      // Request render to apply color changes
      viewerRef.current?.requestRender();

      console.log('[useSpeckleFiltering] setUserObjectColors complete');
    } catch (error) {
      console.error('[useSpeckleFiltering] Failed to set user object colors:', error);
    }
  }, [filteringExtension, viewerRef]);

  /**
   * Remove all custom object colors
   */
  const removeUserObjectColors = useCallback(() => {
    if (!filteringExtension) {
      console.warn('[useSpeckleFiltering] FilteringExtension not available');
      return;
    }

    try {
      console.log('[useSpeckleFiltering] removeUserObjectColors called');

      // Use FilteringExtension API to remove custom colors
      filteringExtension.removeUserObjectColors();

      // Request render to apply changes
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
