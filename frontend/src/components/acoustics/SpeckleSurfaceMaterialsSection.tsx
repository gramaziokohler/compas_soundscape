/**
 * SpeckleSurfaceMaterialsSection Component
 * 
 * Wrapper component that integrates Speckle-based surface materials for acoustic simulations.
 * Handles:
 * - useSpeckleSurfaceMaterials hook integration
 * - SpeckleViewerContext access
 * - Color visualization via FilteringExtension.setUserObjectColors
 * - Same interface as SurfaceMaterialsSection for SimulationTab compatibility
 */

'use client';

import { useEffect, useCallback, useState } from 'react';
import { useSpeckleSurfaceMaterials } from '@/hooks/useSpeckleSurfaceMaterials';
import { useSpeckleFiltering } from '@/hooks/useSpeckleFiltering';
import { SpeckleMaterialAssignmentUI } from './SpeckleMaterialAssignmentUI';
import { UI_COLORS } from '@/lib/constants';
import type { AcousticMaterial } from '@/types/materials';
import type { Viewer } from '@speckle/viewer';

interface SpeckleSurfaceMaterialsSectionProps {
  viewerRef: React.RefObject<Viewer | null>;
  worldTree?: any; // Optional - will be fetched from viewer if not provided
  availableMaterials: AcousticMaterial[];
  onMaterialAssignmentsChange: (assignments: Record<string, string>, layerName: string | null) => void; // objectId -> materialId + selected layer name
  className?: string;
}

export function SpeckleSurfaceMaterialsSection({
  viewerRef,
  worldTree: propWorldTree,
  availableMaterials,
  onMaterialAssignmentsChange,
  className = ''
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

  // Get Speckle filtering extension for color visualization
  const { setUserObjectColors, removeUserObjectColors } = useSpeckleFiltering(viewerRef);

  // Get surface materials hook
  const {
    selectedLayerId,
    layerOptions,
    meshObjects,
    materialAssignments,
    selectLayer,
    assignMaterial,
    getMaterialColor,
    getColorGroups,
    clearMaterialAssignments
  } = useSpeckleSurfaceMaterials(viewerRef, worldTree, availableMaterials);

  /**
   * Update color visualization when material assignments change
   */
  useEffect(() => {
    if (materialAssignments.size === 0) {
      // Clear colors when no assignments
      removeUserObjectColors();
      return;
    }

    // Get color groups and apply to viewer
    const colorGroups = getColorGroups();
    setUserObjectColors(colorGroups);

    console.log('[SpeckleSurfaceMaterialsSection] Applied color groups:', colorGroups);
  }, [materialAssignments, getColorGroups, setUserObjectColors, removeUserObjectColors]);

  /**
   * Notify parent component when assignments or selected layer changes
   */
  useEffect(() => {
    // Convert Map to plain object for parent
    const assignmentsObject: Record<string, string> = {};
    materialAssignments.forEach((materialId, objectId) => {
      assignmentsObject[objectId] = materialId;
    });

    // Find the layer name from selectedLayerId
    const selectedLayer = layerOptions.find(layer => layer.id === selectedLayerId);
    const layerName = selectedLayer?.name || null;

    onMaterialAssignmentsChange(assignmentsObject, layerName);
  }, [materialAssignments, selectedLayerId, layerOptions, onMaterialAssignmentsChange]);

  /**
   * Clear colors when component unmounts
   */
  useEffect(() => {
    return () => {
      removeUserObjectColors();
    };
  }, [removeUserObjectColors]);

  // Show loading state while waiting for worldTree
  if (!worldTree) {
    return (
      <div className={`flex flex-col gap-2 ${className}`}>
        <h4 className="text-xs font-semibold" style={{ color: UI_COLORS.NEUTRAL_700 }}>
          Surface Materials
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
        Surface Materials
      </h4>

      <SpeckleMaterialAssignmentUI
        layerOptions={layerOptions}
        selectedLayerId={selectedLayerId}
        meshObjects={meshObjects}
        materialAssignments={materialAssignments}
        availableMaterials={availableMaterials}
        onSelectLayer={selectLayer}
        onAssignMaterial={assignMaterial}
        getMaterialColor={getMaterialColor}
      />
    </div>
  );
}
