/**
 * SurfaceMaterialsSection Component
 * 
 * Shared component for surface material assignment across all acoustic simulation modes.
 * Used by Resonance Audio, Choras, and Pyroomacoustics simulations.
 */

'use client';

import { MaterialAssignmentUI } from './MaterialAssignmentUI';
import { UI_COLORS } from '@/utils/constants';
import type { EntityData, CompasGeometry } from '@/types';
import type { AcousticMaterial, SelectedGeometry } from '@/types/materials';

interface SurfaceMaterialsSectionProps {
  modelEntities: EntityData[];
  modelType: '3dm' | 'obj' | 'ifc' | null;
  geometryData: CompasGeometry | null;
  selectedGeometry: SelectedGeometry | null;
  onSelectGeometry: (selection: SelectedGeometry | null) => void;
  onHoverGeometry?: (selection: SelectedGeometry | null) => void; // Callback for hover highlighting
  onAssignMaterial: (selection: SelectedGeometry, material: AcousticMaterial | null) => void;
  availableMaterials: AcousticMaterial[];
  className?: string;
  expandedItems?: Set<string>; // Persisted expanded state
  onExpandedItemsChange?: (items: Set<string>) => void; // Callback to persist expanded state
  initialAssignments?: Map<number, string>; // faceIndex -> materialId from simulation config
  resetTrigger?: number; // Timestamp to trigger reset
  excludedLayers?: Set<string>; // Layers excluded from simulation and selection
  onExcludedLayersChange?: (layers: Set<string>) => void; // Callback to update excluded layers
}

export function SurfaceMaterialsSection({
  modelEntities,
  modelType,
  geometryData,
  selectedGeometry,
  onSelectGeometry,
  onHoverGeometry,
  onAssignMaterial,
  availableMaterials,
  className = '',
  expandedItems,
  onExpandedItemsChange,
  initialAssignments,
  resetTrigger,
  excludedLayers,
  onExcludedLayersChange
}: SurfaceMaterialsSectionProps) {

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <h4 className="text-xs font-semibold" style={{ color: UI_COLORS.NEUTRAL_700 }}>
        Surface Materials
      </h4>

      <MaterialAssignmentUI
        modelEntities={modelEntities}
        modelType={modelType}
        geometryData={geometryData}
        selectedGeometry={selectedGeometry}
        onSelectGeometry={onSelectGeometry}
        onHoverGeometry={onHoverGeometry}
        onAssignMaterial={onAssignMaterial}
        availableMaterials={availableMaterials}
        expandedItems={expandedItems}
        onExpandedItemsChange={onExpandedItemsChange}
        initialAssignments={initialAssignments}
        resetTrigger={resetTrigger}
        excludedLayers={excludedLayers}
        onExcludedLayersChange={onExcludedLayersChange}
      />
    </div>
  );
}
