/**
 * SpeckleSurfaceMaterialsSection Component
 *
 * Wrapper component that integrates Speckle-based surface materials for acoustic simulations.
 * Handles:
 * - useSpeckleSurfaceMaterials hook integration
 * - SpeckleSelectionModeContext integration for color management
 * - Color visualization via context's registerMaterialColors (merged with diverse/linked colors)
 * - Layer isolation: automatically isolates the selected acoustic layer (parent + children)
 *   when the simulation card is expanded
 * - Visibility restoration: saves the previous hidden/isolated state before isolating and
 *   restores it when the card is collapsed (hidden layers stay hidden)
 * - State persistence: restores material assignments and layer selection when remounting
 * - Colors persist through scene clicks (merged via context, not directly via FilteringExtension)
 */

'use client';

import { useEffect, useCallback, useRef, useState, useMemo } from 'react';
import { useSpeckleSurfaceMaterials } from '@/hooks/useSpeckleSurfaceMaterials';
import { useSpeckleFiltering } from '@/hooks/useSpeckleFiltering';
import { useSpeckleStore } from '@/store';
import { useAcousticMaterialStore } from '@/store';
import { SpeckleMaterialAssignmentUI } from './SpeckleMaterialAssignmentUI';
import type { AcousticMaterial } from '@/types/materials';
import type { Viewer } from '@speckle/viewer';
import type { ObjectColorGroup } from '@/types/speckle-materials';

interface SpeckleSurfaceMaterialsSectionProps {
  viewerRef: React.RefObject<Viewer | null>;
  worldTree?: any; // Optional - will be fetched from viewer if not provided
  availableMaterials: AcousticMaterial[];
  /** When true, the selected layer is isolated in the viewer. Controlled by global toggle. */
  filteringEnabled?: boolean;
  /** When true, UI controls are disabled (read-only mode for completed simulations) */
  isReadOnly?: boolean;
  onMaterialAssignmentsChange: (assignments: Record<string, string>, layerName: string | null, geometryObjectIds: string[], scatteringAssignments: Record<string, number>) => void; // objectId -> materialId + selected layer name + all geometry IDs + per-object scattering
  className?: string;
  // Persisted state for restoring on remount
  initialAssignments?: Record<string, string>; // objectId -> materialId from config
  initialLayerName?: string | null; // Previously selected layer name
  initialScatteringAssignments?: Record<string, number>; // objectId -> scattering from config
  /** Previously isolated object IDs — restored instead of the full layer set on re-mount */
  initialIsolatedObjectIds?: string[] | null;
  /** Called when the active isolation set changes (card switching / mode toggle) so the parent can persist it */
  onIsolationChange?: (ids: string[] | null) => void;
}

export function SpeckleSurfaceMaterialsSection({
  viewerRef,
  worldTree: propWorldTree,
  availableMaterials,
  filteringEnabled = true,
  isReadOnly = false,
  onMaterialAssignmentsChange,
  className = '',
  initialAssignments,
  initialLayerName,
  initialScatteringAssignments,
  initialIsolatedObjectIds,
  onIsolationChange,
}: SpeckleSurfaceMaterialsSectionProps) {

  // Sync worldTree from prop — AcousticsSection handles the viewer lookup
  const [worldTree, setWorldTree] = useState(propWorldTree);

  useEffect(() => {
    if (propWorldTree) {
      setWorldTree(propWorldTree);
    }
  }, [propWorldTree]);

  // Get Speckle filtering extension for layer isolation
  const {
    isolateObjects,
    unIsolateObjects,
    hideObjects,
    hiddenObjects,
    isolatedObjects
  } = useSpeckleFiltering(viewerRef);

  // Store previous visibility state to restore on unmount
  const previousStateRef = useRef<{
    hiddenObjects: string[];
    isolatedObjects: string[];
    wasIsolated: boolean;
  } | null>(null);

  // Store the object IDs we isolated (for cleanup)
  const isolatedByUsRef = useRef<string[]>([]);
  // Saved isolation to restore when filteringEnabled re-enables or component remounts.
  // Initialized from the persisted card config; replaced by the live isolation after toggle-OFF.
  const savedIsolationRef = useRef<string[] | null>(initialIsolatedObjectIds ?? null);
  // Stable ref to the onIsolationChange callback so cleanup can call it without stale closures
  const onIsolationChangeRef = useRef(onIsolationChange);

  // Get context for material colors registration (merged with diverse/linked colors)
  const { registerMaterialColors, clearMaterialColors, applyFilterColors } = useSpeckleStore();

  // Get surface materials hook — provides layer/mesh data only (assignments owned by store)
  const {
    selectedLayerId,
    layerOptions,
    meshObjects,
    selectLayer: hookSelectLayer,
    getMaterialColor,
    getAllObjectIds,
    rawIdToModelIdMap,
    appIdToTreeIdMap,
  } = useSpeckleSurfaceMaterials(viewerRef, worldTree, availableMaterials, {
    initialLayerName,
  });

  // ── Acoustic material store ──
  const setLayerData          = useAcousticMaterialStore((s) => s.setLayerData);
  const deactivate            = useAcousticMaterialStore((s) => s.deactivate);
  const deactivateViewer      = useAcousticMaterialStore((s) => s.deactivateViewer);
  const clearAssignments      = useAcousticMaterialStore((s) => s.clearAssignments);
  const loadAssignments       = useAcousticMaterialStore((s) => s.loadAssignments);
  const materialAssignments   = useAcousticMaterialStore((s) => s.materialAssignments);
  const scatteringAssignments = useAcousticMaterialStore((s) => s.scatteringAssignments);

  // Keep onIsolationChangeRef current so cleanup can call latest version
  useEffect(() => { onIsolationChangeRef.current = onIsolationChange; }, [onIsolationChange]);

  // Eagerly persist isolation state to the card config whenever it changes.
  // Without this, config.speckleIsolatedObjectIds is only updated on unmount/toggle-OFF.
  // When the simulation completes, the component remounts in the same render cycle as the
  // cleanup — the async config update from the cleanup hasn't landed yet, so the new instance
  // reads stale initialIsolatedObjectIds and re-isolates the full layer set.
  const explorerIsolatedIds = useSpeckleStore((s) => s.explorerIsolatedIds);
  useEffect(() => {
    // Only save if we are actively managing isolation (layer is isolated by this component)
    if (!filteringEnabled || isolatedByUsRef.current.length === 0) return;
    onIsolationChangeRef.current?.(explorerIsolatedIds);
  }, [filteringEnabled, explorerIsolatedIds]);

  // Wrap selectLayer so that switching layers also clears store assignments
  const selectLayer = useCallback((layerId: string) => {
    hookSelectLayer(layerId);
    clearAssignments();
  }, [hookSelectLayer, clearAssignments]);

  // Reverse mapping: treeId → applicationId for persistence (save path)
  // applicationId is stable across model republishes, unlike raw.id (content hash)
  const treeIdToAppId = useMemo(() => {
    const map = new Map<string, string>();
    appIdToTreeIdMap.forEach((treeId, appId) => {
      map.set(treeId, appId);
    });
    return map;
  }, [appIdToTreeIdMap]);

  // Sync layer/mesh data to the store whenever they change
  useEffect(() => {
    if (!filteringEnabled) {
      deactivateViewer();
      return;
    }
    setLayerData({ meshObjects, availableMaterials, selectedLayerId, layerOptions });
  }, [filteringEnabled, meshObjects, availableMaterials, selectedLayerId, layerOptions, setLayerData, deactivateViewer]);

  // Clear store on unmount.
  // Reset initializedRef so that if React re-mounts this component (StrictMode
  // dev double-mount, or card collapse→expand), the init effect re-loads assignments.
  useEffect(() => {
    return () => {
      deactivate();
      initializedRef.current = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load persisted assignments on mount (or re-mount after StrictMode cleanup).
  // initializedRef gates it to run only once per mount cycle.
  // skipNextNotifyRef: the notify effect runs in the same batch as init, but its
  // materialAssignments closure still has the stale pre-loadAssignments value.
  // Skip that one stale fire; the store update triggers a fresh render whose notify is correct.
  const initializedRef = useRef(false);
  const skipNextNotifyRef = useRef(true);
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    skipNextNotifyRef.current = true;
    const initMaterial = initialAssignments
      ? new Map(Object.entries(initialAssignments))
      : new Map<string, string>();
    const initScattering = initialScatteringAssignments
      ? new Map(Object.entries(initialScatteringAssignments).map(([k, v]) => [k, v as number]))
      : new Map<string, number>();
    loadAssignments(initMaterial, initScattering);
    // Clear temporal history so the initial load cannot be undone
    useAcousticMaterialStore.temporal.getState().clear();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Remap saved assignment IDs to current tree IDs on load ──
  // Saved soundscapes may use applicationId (new format, stable across model versions)
  // or raw.id (old format, content hash that may change). This effect detects
  // stale keys and remaps them to the current session's tree IDs.
  const hasRemappedRef = useRef(false);
  useEffect(() => {
    if (hasRemappedRef.current) return;
    if (appIdToTreeIdMap.size === 0) return;
    if (materialAssignments.size === 0) return;

    // Build a set of current tree IDs for quick lookup
    const currentTreeIds = new Set(appIdToTreeIdMap.values());

    // Check if any assignment keys need remapping
    let needsRemap = false;
    materialAssignments.forEach((_, key) => {
      // If the key is already a current tree ID, no remap needed
      if (currentTreeIds.has(key)) return;
      // If the key resolves via applicationId map, it needs remap
      if (appIdToTreeIdMap.has(key)) { needsRemap = true; return; }
      // If the key resolves via rawId map, it needs remap
      if (rawIdToModelIdMap.has(key)) { needsRemap = true; return; }
      // Otherwise the key is stale — mark for remap to filter it out
      needsRemap = true;
    });

    if (!needsRemap) {
      hasRemappedRef.current = true;
      return;
    }

    hasRemappedRef.current = true;

    const remappedMaterial = new Map<string, string>();
    materialAssignments.forEach((materialId, key) => {
      // Priority 1: already a current tree ID
      if (currentTreeIds.has(key)) {
        remappedMaterial.set(key, materialId);
        return;
      }
      // Priority 2: key is an applicationId → remap to current tree ID
      const treeIdFromApp = appIdToTreeIdMap.get(key);
      if (treeIdFromApp) {
        remappedMaterial.set(treeIdFromApp, materialId);
        return;
      }
      // Priority 3: key is a raw.id that maps to a model.id
      const treeIdFromRaw = rawIdToModelIdMap.get(key);
      if (treeIdFromRaw) {
        remappedMaterial.set(treeIdFromRaw, materialId);
        return;
      }
      // No match — skip stale key
    });

    const remappedScattering = new Map<string, number>();
    scatteringAssignments.forEach((value, key) => {
      if (currentTreeIds.has(key)) { remappedScattering.set(key, value); return; }
      const treeIdFromApp = appIdToTreeIdMap.get(key);
      if (treeIdFromApp) { remappedScattering.set(treeIdFromApp, value); return; }
      const treeIdFromRaw = rawIdToModelIdMap.get(key);
      if (treeIdFromRaw) { remappedScattering.set(treeIdFromRaw, value); return; }
    });

    console.log('[SpeckleSurfaceMaterialsSection] Remapped', materialAssignments.size, 'saved assignments →', remappedMaterial.size, 'current assignments');

    skipNextNotifyRef.current = true;
    loadAssignments(remappedMaterial, remappedScattering);
    useAcousticMaterialStore.temporal.getState().clear();
  }, [appIdToTreeIdMap, rawIdToModelIdMap, materialAssignments, scatteringAssignments, loadAssignments]);

  // Track previous layer to detect changes
  const previousLayerIdRef = useRef<string | null>(null);

  /**
   * Isolate the selected layer when it changes, but ONLY when filteringEnabled is true.
   * Filtering is controlled by the global toggle in AcousticsSection header,
   * NOT by card mount/unmount (switching between cards).
   */
  useEffect(() => {
    if (!filteringEnabled) return;

    // Skip if no layer selected or no objects
    if (!selectedLayerId) return;

    // Get all object IDs for the current layer (children)
    const childObjectIds = getAllObjectIds();
    if (childObjectIds.length === 0) return;

    // Only isolate if layer changed or first activation
    if (previousLayerIdRef.current !== selectedLayerId) {
      // Save current visibility state BEFORE isolating (only on first isolation)
      if (previousStateRef.current === null) {
        previousStateRef.current = {
          hiddenObjects: Array.from(hiddenObjects),
          isolatedObjects: Array.from(isolatedObjects),
          wasIsolated: isolatedObjects.size > 0
        };
      }

      // Un-isolate the previous layer before isolating the new one
      if (isolatedByUsRef.current.length > 0) {
        unIsolateObjects(isolatedByUsRef.current);
      }

      // Use saved isolation if available (restored from card config or preserved across mode toggle).
      // Fall back to the full layer set for a fresh card.
      let objectIdsToIsolate: string[];
      if (savedIsolationRef.current && savedIsolationRef.current.length > 0) {
        // IMPORTANT: filter out selectedLayerId from the saved set.
        // Passing it into isolateObjects() with includeDescendants=true would cause Speckle
        // to re-isolate ALL layer children (including previously un-isolated meshes), because
        // a fresh isolateObjects call has no memory of the prior per-mesh exclusions.
        // Isolating only the specific geometry IDs (leaf nodes) avoids this.
        const meshOnlyIds = savedIsolationRef.current.filter(id => id !== selectedLayerId);
        objectIdsToIsolate = meshOnlyIds.length > 0
          ? meshOnlyIds
          : [selectedLayerId, ...childObjectIds]; // all were un-isolated → restore full set
        savedIsolationRef.current = null; // consume — layer changes use the full set
      } else {
        objectIdsToIsolate = [selectedLayerId, ...childObjectIds];
      }
      isolatedByUsRef.current = objectIdsToIsolate;

      isolateObjects(objectIdsToIsolate);
      previousLayerIdRef.current = selectedLayerId;

      // Re-apply stored material colors after isolation.
      // Isolation can reset user object colors — retry at increasing intervals.
      setTimeout(() => applyFilterColors(), 50);
      setTimeout(() => applyFilterColors(), 300);
      setTimeout(() => applyFilterColors(), 800);
    }
  }, [filteringEnabled, selectedLayerId, getAllObjectIds, isolateObjects, unIsolateObjects, hiddenObjects, isolatedObjects, applyFilterColors]);

  /**
   * React to filteringEnabled toggle changes:
   * - When turned OFF: un-isolate and restore previous visibility state
   * - When turned ON: re-isolate the current layer (handled by the effect above via previousLayerIdRef reset)
   */
  const prevFilteringEnabledRef = useRef(filteringEnabled);
  useEffect(() => {
    const wasEnabled = prevFilteringEnabledRef.current;
    prevFilteringEnabledRef.current = filteringEnabled;

    if (wasEnabled && !filteringEnabled) {
      // Toggled OFF → clear material colors FIRST so stale setUserObjectColors
      // from acoustic mode are removed before unIsolate/hide run. Without this,
      // active color groups in FilteringExtension conflict with hideObjects() when
      // switching Acoustic → Dark with materials assigned, keeping objects visible.
      clearMaterialColors();

      if (isolatedByUsRef.current.length > 0) {
        // Save current isolation set BEFORE clearing so it survives the mode toggle.
        // When filtering is re-enabled, savedIsolationRef is used to restore the
        // user's exact isolation rather than re-isolating the full layer.
        const currentIsolated = useSpeckleStore.getState().getExplorerIsolatedIds();
        if (currentIsolated !== null) {
          savedIsolationRef.current = currentIsolated;
          onIsolationChangeRef.current?.(currentIsolated);
        }
        unIsolateObjects(isolatedByUsRef.current);
      }

      if (previousStateRef.current?.hiddenObjects.length) {
        hideObjects(previousStateRef.current.hiddenObjects);
      }
      if (previousStateRef.current?.wasIsolated && previousStateRef.current.isolatedObjects.length > 0) {
        isolateObjects(previousStateRef.current.isolatedObjects);
      }

      // Reset state refs so re-enabling can start fresh
      previousStateRef.current = null;
      isolatedByUsRef.current = [];
      previousLayerIdRef.current = null;
    } else if (!wasEnabled && filteringEnabled) {
      // Toggled ON — no need to reset previousLayerIdRef here.
      // The toggle-OFF branch already resets it to null, so the isolation
      // effect will re-isolate naturally. Resetting here causes a redundant
      // un-isolate/re-isolate cycle (effect 1 isolates → effect 2 resets
      // previousLayerIdRef → next render un-isolates + re-isolates same layer).
      console.log('[SpeckleSurfaceMaterialsSection] Filtering enabled');
    }
  }, [filteringEnabled, clearMaterialColors, unIsolateObjects, hideObjects, isolateObjects]);

  /**
   * Restore previous visibility state when component unmounts.
   * Uses refs for the filtering functions so the cleanup only fires on actual
   * unmount — not when callback references change (which caused spurious
   * un-isolation when filteringExtension transitioned from null → loaded).
   */
  const isolateObjectsRef = useRef(isolateObjects);
  const unIsolateObjectsRef = useRef(unIsolateObjects);
  const hideObjectsRef = useRef(hideObjects);
  useEffect(() => { isolateObjectsRef.current = isolateObjects; }, [isolateObjects]);
  useEffect(() => { unIsolateObjectsRef.current = unIsolateObjects; }, [unIsolateObjects]);
  useEffect(() => { hideObjectsRef.current = hideObjects; }, [hideObjects]);

  useEffect(() => {
    return () => {
      // Only restore if we have active isolation (filteringEnabled was on)
      if (isolatedByUsRef.current.length === 0) return;

      // Persist the current isolation set BEFORE un-isolating so the parent
      // can save it to the card config and restore it on the next mount.
      const currentIsolated = useSpeckleStore.getState().getExplorerIsolatedIds();
      if (currentIsolated !== null) {
        onIsolationChangeRef.current?.(currentIsolated);
      }

      unIsolateObjectsRef.current(isolatedByUsRef.current);

      if (previousStateRef.current?.hiddenObjects.length) {
        hideObjectsRef.current(previousStateRef.current.hiddenObjects);
      }
      if (previousStateRef.current?.wasIsolated && previousStateRef.current.isolatedObjects.length > 0) {
        isolateObjectsRef.current(previousStateRef.current.isolatedObjects);
      }

      previousStateRef.current = null;
      isolatedByUsRef.current = [];
      previousLayerIdRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Update color visualization when material assignments change.
   */
  const prevFilteringEnabledForColors = useRef(filteringEnabled);
  useEffect(() => {
    const wasEnabled = prevFilteringEnabledForColors.current;
    prevFilteringEnabledForColors.current = filteringEnabled;

    if (!filteringEnabled) {
      // Only clear when filtering was just turned OFF (not on every render while off)
      if (wasEnabled) clearMaterialColors();
      return;
    }

    if (materialAssignments.size === 0) {
      clearMaterialColors();
      return;
    }

    // Build color groups inline from store materialAssignments
    const colorMap = new Map<string, string[]>();
    materialAssignments.forEach((materialId, objectId) => {
      const color = getMaterialColor(materialId);
      if (!colorMap.has(color)) colorMap.set(color, []);
      colorMap.get(color)!.push(objectId);
    });
    const colorGroups: ObjectColorGroup[] = [];
    colorMap.forEach((objectIds, color) => colorGroups.push({ objectIds, color }));
    registerMaterialColors(colorGroups);
  }, [filteringEnabled, materialAssignments, getMaterialColor, registerMaterialColors, clearMaterialColors, availableMaterials]);

  /**
   * Notify parent component when assignments or selected layer changes
   * Use ref to prevent effect from re-running when callback reference changes
   */
  const onMaterialAssignmentsChangeRef = useRef(onMaterialAssignmentsChange);

  useEffect(() => {
    onMaterialAssignmentsChangeRef.current = onMaterialAssignmentsChange;
  }, [onMaterialAssignmentsChange]);

  useEffect(() => {
    // On mount, the init effect calls loadAssignments() which updates the Zustand store.
    // But this notify effect runs in the same batch with materialAssignments from the
    // render closure (stale/empty). Skip that first fire — the store update from
    // loadAssignments() will trigger a re-render whose notify has correct data.
    if (skipNextNotifyRef.current) {
      skipNextNotifyRef.current = false;
      return;
    }

    // Convert Map to plain object for parent — use applicationId for cross-session persistence
    // applicationId (Rhino GUID) is stable across model republishes, unlike raw.id (content hash)
    const assignmentsObject: Record<string, string> = {};
    materialAssignments.forEach((materialId, objectId) => {
      const appId = treeIdToAppId.get(objectId) || objectId;
      assignmentsObject[appId] = materialId;
    });

    // Convert scattering Map to plain object — same applicationId key
    const scatteringObject: Record<string, number> = {};
    scatteringAssignments.forEach((value, objectId) => {
      const appId = treeIdToAppId.get(objectId) || objectId;
      scatteringObject[appId] = value;
    });

    // Find the layer name from selectedLayerId
    const selectedLayer = layerOptions.find(layer => layer.id === selectedLayerId);
    const layerName = selectedLayer?.name || null;

    // For backend simulation: send original tree IDs (Speckle content hashes)
    // The backend filters geometry by obj.id which matches tree IDs, not applicationIds
    const geometryObjectIds = Array.from(materialAssignments.keys());

    // Call the latest callback without triggering re-run
    onMaterialAssignmentsChangeRef.current(assignmentsObject, layerName, geometryObjectIds, scatteringObject);
  }, [materialAssignments, selectedLayerId, layerOptions, scatteringAssignments]);

  /**
   * Clear material colors when component unmounts
   * Note: isolation is cleared in a separate effect above
   */
  useEffect(() => {
    return () => {
      clearMaterialColors();
    };
  }, [clearMaterialColors]);

  // Show loading state while waiting for worldTree
  if (!worldTree) {
    return (
      <div className={`flex flex-col gap-2 ${className}`}>
        <h4 className="text-xs font-semibold text-neutral-700">
          Acoustic Layer
        </h4>
        <div
          className="px-3 py-4 text-xs text-center"
          style={{
            color: 'var(--color-secondary-hover)',
            backgroundColor: 'var(--background)',
            borderRadius: '8px',
            border: `1px solid var(--color-secondary)`
          }}
        >
          <div className="animate-pulse">Loading geometry from viewer...</div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <h4 className="text-xs font-semibold text-neutral-700">
        Acoustic Layer
      </h4>

      <SpeckleMaterialAssignmentUI
        layerOptions={layerOptions}
        selectedLayerId={selectedLayerId}
        availableMaterials={availableMaterials}
        onSelectLayer={selectLayer}
      />
    </div>
  );
}
