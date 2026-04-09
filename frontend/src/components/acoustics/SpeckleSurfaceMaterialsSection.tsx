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

import { useEffect, useCallback, useState, useRef } from 'react';
import { useSpeckleSurfaceMaterials } from '@/hooks/useSpeckleSurfaceMaterials';
import { useSpeckleFiltering } from '@/hooks/useSpeckleFiltering';
import { useSpeckleSelectionMode } from '@/contexts/SpeckleSelectionModeContext';
import { useAcousticMaterial, type AcousticMaterialState } from '@/contexts/AcousticMaterialContext';
import { SpeckleMaterialAssignmentUI } from './SpeckleMaterialAssignmentUI';
import { UI_COLORS } from '@/utils/constants';
import type { AcousticMaterial } from '@/types/materials';
import type { Viewer } from '@speckle/viewer';

interface SpeckleSurfaceMaterialsSectionProps {
  viewerRef: React.RefObject<Viewer | null>;
  worldTree?: any; // Optional - will be fetched from viewer if not provided
  availableMaterials: AcousticMaterial[];
  /** When true, the selected layer is isolated in the viewer. Controlled by global toggle. */
  filteringEnabled?: boolean;
  onMaterialAssignmentsChange: (assignments: Record<string, string>, layerName: string | null, geometryObjectIds: string[], scatteringAssignments: Record<string, number>) => void; // objectId -> materialId + selected layer name + all geometry IDs + per-object scattering
  className?: string;
  // Persisted state for restoring on remount
  initialAssignments?: Record<string, string>; // objectId -> materialId from config
  initialLayerName?: string | null; // Previously selected layer name
  initialScatteringAssignments?: Record<string, number>; // objectId -> scattering from config
}

export function SpeckleSurfaceMaterialsSection({
  viewerRef,
  worldTree: propWorldTree,
  availableMaterials,
  filteringEnabled = true,
  onMaterialAssignmentsChange,
  className = '',
  initialAssignments,
  initialLayerName,
  initialScatteringAssignments
}: SpeckleSurfaceMaterialsSectionProps) {

  // Get worldTree from viewer if not provided via props
  const [worldTree, setWorldTree] = useState(propWorldTree);

  useEffect(() => {
    if (propWorldTree) {
      setWorldTree(propWorldTree);
      return;
    }

    // Fetch worldTree from viewer
    if (viewerRef.current) {
      const tree = viewerRef.current.getWorldTree();
      setWorldTree(tree);
    }
  }, [propWorldTree, viewerRef, viewerRef.current]);

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

  // Get context for material colors registration (merged with diverse/linked colors)
  const { registerMaterialColors, clearMaterialColors } = useSpeckleSelectionMode();

  // Get surface materials hook with persisted state
  const {
    selectedLayerId,
    layerOptions,
    meshObjects,
    materialAssignments,
    selectLayer,
    assignMaterial,
    assignMaterialToAll,
    assignMaterialToObjects,
    getMaterialColor,
    getColorGroups,
    clearMaterialAssignments,
    getAllObjectIds
  } = useSpeckleSurfaceMaterials(viewerRef, worldTree, availableMaterials, {
    initialAssignments,
    initialLayerName
  });

  // ── Scattering assignments (per-object, same pattern as material assignments) ──
  const [scatteringAssignments, setScatteringAssignments] = useState<Map<string, number>>(() => {
    if (!initialScatteringAssignments) return new Map();
    return new Map(Object.entries(initialScatteringAssignments).map(([k, v]) => [k, v]));
  });

  const assignScattering = useCallback((objectId: string, value: number) => {
    setScatteringAssignments(prev => new Map(prev).set(objectId, value));
  }, []);

  const assignScatteringToAll = useCallback((value: number) => {
    const allIds = getAllObjectIds();
    setScatteringAssignments(() => {
      const newMap = new Map<string, number>();
      allIds.forEach(id => newMap.set(id, value));
      return newMap;
    });
  }, [getAllObjectIds]);

  const assignScatteringToObjects = useCallback((objectIds: string[], value: number) => {
    setScatteringAssignments(prev => {
      const newMap = new Map(prev);
      objectIds.forEach(id => newMap.set(id, value));
      return newMap;
    });
  }, []);

  // Publish material state to AcousticMaterialContext for right sidebar consumers
  // Only publish when filteringEnabled is true — controls EntityInfoPanel mode switching
  const { publishMaterialState, clearMaterialState } = useAcousticMaterial();

  // Ref always holds the latest complete state — updated synchronously each render.
  // Allows the publish effect to depend ONLY on data, not function references.
  // Root cause of the infinite loop: function refs (getMaterialColor, assignMaterial, etc.)
  // get new identities when availableMaterials prop receives a new array reference on
  // parent re-renders (triggered by context version changes). With those functions in
  // the effect deps, the chain was: function ref changes → effect fires → publishMaterialState
  // → setVersion → context re-render → parent re-renders → new availableMaterials ref → repeat.
  const latestPublishStateRef = useRef<AcousticMaterialState | null>(null);
  latestPublishStateRef.current = {
    meshObjects,
    materialAssignments,
    availableMaterials,
    selectedLayerId,
    layerOptions,
    assignMaterial,
    assignMaterialToAll,
    assignMaterialToObjects,
    getMaterialColor,
    scatteringAssignments,
    assignScattering,
    assignScatteringToAll,
    assignScatteringToObjects
  };

  useEffect(() => {
    if (!filteringEnabled) {
      clearMaterialState();
      return;
    }
    publishMaterialState(latestPublishStateRef.current!);
    // Data deps only — function refs (getMaterialColor etc.) excluded because they're
    // captured via latestPublishStateRef. The context itself guards against re-renders
    // when data hasn't changed (functional state update with reference-equality check).
  }, [filteringEnabled, meshObjects, materialAssignments, availableMaterials, selectedLayerId, layerOptions, scatteringAssignments, publishMaterialState, clearMaterialState]);

  // Clear context state on unmount
  useEffect(() => {
    return () => {
      clearMaterialState();
    };
  }, [clearMaterialState]);

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
        console.log('[SpeckleSurfaceMaterialsSection] Saved previous state:', {
          hiddenCount: previousStateRef.current.hiddenObjects.length,
          isolatedCount: previousStateRef.current.isolatedObjects.length
        });
      }

      // Un-isolate the previous layer before isolating the new one
      if (isolatedByUsRef.current.length > 0) {
        console.log('[SpeckleSurfaceMaterialsSection] Un-isolating previous layer:', isolatedByUsRef.current.length, 'objects');
        unIsolateObjects(isolatedByUsRef.current);
      }

      // Include parent layer ID + all children in isolation
      const objectIdsToIsolate = [selectedLayerId, ...childObjectIds];
      isolatedByUsRef.current = objectIdsToIsolate;

      console.log('[SpeckleSurfaceMaterialsSection] Isolating layer:', selectedLayerId, 'with', objectIdsToIsolate.length, 'objects');
      isolateObjects(objectIdsToIsolate);
      previousLayerIdRef.current = selectedLayerId;
    }
  }, [filteringEnabled, selectedLayerId, getAllObjectIds, isolateObjects, unIsolateObjects, hiddenObjects, isolatedObjects]);

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
      // Toggled OFF → restore previous visibility state
      console.log('[SpeckleSurfaceMaterialsSection] Filtering disabled - restoring visibility');

      if (isolatedByUsRef.current.length > 0) {
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
      // Toggled ON → reset previousLayerIdRef so the isolation effect above re-runs
      console.log('[SpeckleSurfaceMaterialsSection] Filtering enabled - will re-isolate');
      previousLayerIdRef.current = null;
    }
  }, [filteringEnabled, unIsolateObjects, hideObjects, isolateObjects]);

  /**
   * Restore previous visibility state when component unmounts
   * Only needed if filtering is currently active
   */
  useEffect(() => {
    const savedStateRef = previousStateRef;
    const isolatedByUsRefCaptured = isolatedByUsRef;
    const previousLayerIdRefCaptured = previousLayerIdRef;

    return () => {
      // Only restore if we have active isolation (filteringEnabled was on)
      if (isolatedByUsRefCaptured.current.length === 0) return;

      console.log('[SpeckleSurfaceMaterialsSection] Unmounting - restoring previous visibility state');

      unIsolateObjects(isolatedByUsRefCaptured.current);

      if (savedStateRef.current?.hiddenObjects.length) {
        hideObjects(savedStateRef.current.hiddenObjects);
      }
      if (savedStateRef.current?.wasIsolated && savedStateRef.current.isolatedObjects.length > 0) {
        isolateObjects(savedStateRef.current.isolatedObjects);
      }

      savedStateRef.current = null;
      isolatedByUsRefCaptured.current = [];
      previousLayerIdRefCaptured.current = null;
    };
  }, [unIsolateObjects, hideObjects, isolateObjects]);

  /**
   * Update color visualization when material assignments change.
   * Only registers colors when filteringEnabled is true.
   * Uses context's registerMaterialColors to merge with diverse/linked colors.
   */
  useEffect(() => {
    if (!filteringEnabled || materialAssignments.size === 0) {
      clearMaterialColors();
      return;
    }

    // Get color groups and register with context (merged with other colors)
    const colorGroups = getColorGroups();
    registerMaterialColors(colorGroups);

    console.log('[SpeckleSurfaceMaterialsSection] Registered material color groups:', colorGroups.length);
  }, [filteringEnabled, materialAssignments, getColorGroups, registerMaterialColors, clearMaterialColors]);

  /**
   * Notify parent component when assignments or selected layer changes
   * Use ref to prevent effect from re-running when callback reference changes
   */
  const onMaterialAssignmentsChangeRef = useRef(onMaterialAssignmentsChange);

  useEffect(() => {
    onMaterialAssignmentsChangeRef.current = onMaterialAssignmentsChange;
  }, [onMaterialAssignmentsChange]);

  useEffect(() => {
    // Convert Map to plain object for parent
    const assignmentsObject: Record<string, string> = {};
    materialAssignments.forEach((materialId, objectId) => {
      assignmentsObject[objectId] = materialId;
    });

    // Convert scattering Map to plain object for parent
    const scatteringObject: Record<string, number> = {};
    scatteringAssignments.forEach((value, objectId) => {
      scatteringObject[objectId] = value;
    });

    // Find the layer name from selectedLayerId
    const selectedLayer = layerOptions.find(layer => layer.id === selectedLayerId);
    const layerName = selectedLayer?.name || null;

    // Send only the IDs that have an assigned material (for backend geometry filtering)
    const geometryObjectIds = Object.keys(assignmentsObject);

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
        <h4 className="text-xs font-semibold" style={{ color: UI_COLORS.NEUTRAL_700 }}>
          Acoustic Layer
        </h4>
        <div
          className="px-3 py-4 text-xs text-center"
          style={{
            color: UI_COLORS.NEUTRAL_500,
            backgroundColor: UI_COLORS.NEUTRAL_900,
            borderRadius: '8px',
            border: `1px solid ${UI_COLORS.NEUTRAL_800}`
          }}
        >
          <div className="animate-pulse">Loading geometry from viewer...</div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <h4 className="text-xs font-semibold" style={{ color: UI_COLORS.NEUTRAL_700 }}>
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
