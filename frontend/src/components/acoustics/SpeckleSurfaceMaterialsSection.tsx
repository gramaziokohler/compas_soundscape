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
import { useAcousticMaterial } from '@/contexts/AcousticMaterialContext';
import { SpeckleMaterialAssignmentUI } from './SpeckleMaterialAssignmentUI';
import { UI_COLORS } from '@/utils/constants';
import type { AcousticMaterial } from '@/types/materials';
import type { Viewer } from '@speckle/viewer';

interface SpeckleSurfaceMaterialsSectionProps {
  viewerRef: React.RefObject<Viewer | null>;
  worldTree?: any; // Optional - will be fetched from viewer if not provided
  availableMaterials: AcousticMaterial[];
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
  const { publishMaterialState, clearMaterialState } = useAcousticMaterial();

  useEffect(() => {
    publishMaterialState({
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
    });
  }, [meshObjects, materialAssignments, availableMaterials, selectedLayerId, layerOptions, assignMaterial, assignMaterialToAll, getMaterialColor, publishMaterialState, scatteringAssignments, assignScattering, assignScatteringToAll, assignScatteringToObjects]);

  // Clear context state on unmount
  useEffect(() => {
    return () => {
      clearMaterialState();
    };
  }, [clearMaterialState]);

  // Track previous layer to detect changes
  const previousLayerIdRef = useRef<string | null>(null);

  /**
   * Isolate the selected layer when it changes or component mounts
   * This shows only the acoustic layer in the 3D viewer for easier material assignment
   * Also saves the previous visibility state for restoration on unmount
   */
  useEffect(() => {
    // Skip if no layer selected or no objects
    if (!selectedLayerId) return;

    // Get all object IDs for the current layer (children)
    const childObjectIds = getAllObjectIds();
    if (childObjectIds.length === 0) return;

    // Only isolate if layer changed or first mount
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
      // (Speckle's isolateObjects is additive, so old objects would stay isolated)
      if (isolatedByUsRef.current.length > 0) {
        console.log('[SpeckleSurfaceMaterialsSection] Un-isolating previous layer:', isolatedByUsRef.current.length, 'objects');
        unIsolateObjects(isolatedByUsRef.current);
      }

      // Include parent layer ID + all children in isolation
      const objectIdsToIsolate = [selectedLayerId, ...childObjectIds];

      // Store what we're isolating for cleanup
      isolatedByUsRef.current = objectIdsToIsolate;

      console.log('[SpeckleSurfaceMaterialsSection] Isolating layer:', selectedLayerId, 'with', objectIdsToIsolate.length, 'objects (1 parent +', childObjectIds.length, 'children)');
      isolateObjects(objectIdsToIsolate);
      previousLayerIdRef.current = selectedLayerId;
    }
  }, [selectedLayerId, getAllObjectIds, isolateObjects, unIsolateObjects, hiddenObjects, isolatedObjects]);

  /**
   * Restore previous visibility state when component unmounts (card collapsed or switched)
   */
  useEffect(() => {
    // Capture refs for cleanup (these refs persist across renders)
    const savedStateRef = previousStateRef;
    const isolatedByUsRefCaptured = isolatedByUsRef;
    const previousLayerIdRefCaptured = previousLayerIdRef;

    return () => {
      console.log('[SpeckleSurfaceMaterialsSection] Unmounting - restoring previous visibility state');

      // Un-isolate the objects we isolated
      if (isolatedByUsRefCaptured.current.length > 0) {
        console.log('[SpeckleSurfaceMaterialsSection] Un-isolating', isolatedByUsRefCaptured.current.length, 'objects');
        unIsolateObjects(isolatedByUsRefCaptured.current);
      }

      // Restore previous hidden objects
      if (savedStateRef.current && savedStateRef.current.hiddenObjects.length > 0) {
        console.log('[SpeckleSurfaceMaterialsSection] Restoring', savedStateRef.current.hiddenObjects.length, 'hidden objects');
        hideObjects(savedStateRef.current.hiddenObjects);
      }

      // Restore previous isolated objects (if there were any before)
      if (savedStateRef.current && savedStateRef.current.wasIsolated && savedStateRef.current.isolatedObjects.length > 0) {
        console.log('[SpeckleSurfaceMaterialsSection] Restoring', savedStateRef.current.isolatedObjects.length, 'isolated objects');
        isolateObjects(savedStateRef.current.isolatedObjects);
      }

      // Reset refs
      savedStateRef.current = null;
      isolatedByUsRefCaptured.current = [];
      previousLayerIdRefCaptured.current = null;
    };
  }, [unIsolateObjects, hideObjects, isolateObjects]);

  /**
   * Update color visualization when material assignments change
   * Uses context's registerMaterialColors to merge with diverse/linked colors
   */
  useEffect(() => {
    if (materialAssignments.size === 0) {
      // Clear material colors when no assignments
      clearMaterialColors();
      return;
    }

    // Get color groups and register with context (merged with other colors)
    const colorGroups = getColorGroups();
    registerMaterialColors(colorGroups);

    console.log('[SpeckleSurfaceMaterialsSection] Registered material color groups:', colorGroups.length);
  }, [materialAssignments, getColorGroups, registerMaterialColors, clearMaterialColors]);

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
