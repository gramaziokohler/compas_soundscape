/**
 * TreeItemAcousticControls
 *
 * The two extra Object Explorer columns shown while acoustic material assignment
 * is active: a material dropdown and (for Pyroomacoustics) a scattering text input.
 *
 * Operates on the geometry-leaf IDs of a tree row, so assigning at a parent/layer
 * row cascades to all of its child surfaces. Assignments are owned by
 * useAcousticMaterialStore (keyed by raw Speckle geometry IDs).
 */

'use client';

import { useMemo } from 'react';
import { useAcousticMaterialStore } from '@/store';
import { MaterialSelect, type MaterialOption } from '@/components/ui/MaterialSelect';
import { NumberField } from '@/components/ui/NumberField';
import {
  PYROOMACOUSTICS_DEFAULT_SCATTERING,
  PYROOMACOUSTICS_SCATTERING_MIN,
  PYROOMACOUSTICS_SCATTERING_MAX,
} from '@/utils/constants';

interface TreeItemAcousticControlsProps {
  /** Raw Speckle geometry IDs this row controls (node + descendant surfaces). */
  geometryIds: string[];
  sortedMaterials: MaterialOption[];
  materialColors: Map<string, string>;
  /** Whether to show the scattering column (Pyroomacoustics only). */
  showScattering: boolean;
}

export function TreeItemAcousticControls({
  geometryIds,
  sortedMaterials,
  materialColors,
  showScattering,
}: TreeItemAcousticControlsProps) {
  const materialAssignments = useAcousticMaterialStore((s) => s.materialAssignments);
  const scatteringAssignments = useAcousticMaterialStore((s) => s.scatteringAssignments);
  const assignMaterialToObjects = useAcousticMaterialStore((s) => s.assignMaterialToObjects);
  const assignScatteringToObjects = useAcousticMaterialStore((s) => s.assignScatteringToObjects);

  // Common material across this row's geometry (null when mixed / unassigned)
  const { commonMaterialId, isMixed } = useMemo(() => {
    const assigned = new Set<string>();
    for (const id of geometryIds) {
      const m = materialAssignments.get(id);
      if (m) assigned.add(m);
    }
    return {
      commonMaterialId: assigned.size === 1 ? Array.from(assigned)[0] : null,
      isMixed: assigned.size > 1,
    };
  }, [geometryIds, materialAssignments]);

  // Common scattering across this row's geometry
  const { commonScattering, scatteringMixed } = useMemo(() => {
    if (geometryIds.length === 0) return { commonScattering: null as number | null, scatteringMixed: false };
    const values = new Set<number>();
    for (const id of geometryIds) {
      values.add(scatteringAssignments.get(id) ?? PYROOMACOUSTICS_DEFAULT_SCATTERING);
    }
    return {
      commonScattering: values.size === 1 ? Array.from(values)[0] : null,
      scatteringMixed: values.size > 1,
    };
  }, [geometryIds, scatteringAssignments]);

  if (geometryIds.length === 0) return null;

  return (
    <div className="flex items-center gap-1 shrink-0" data-no-drag onClick={(e) => e.stopPropagation()}>
      <MaterialSelect
        value={commonMaterialId || ''}
        onChange={(matId) => assignMaterialToObjects(geometryIds, matId)}
        materials={sortedMaterials}
        materialColors={materialColors}
        placeholder={isMixed ? '(mixed)' : 'Select...'}
        opacity={isMixed ? 0.7 : 1}
        isMixed={isMixed}
        showSearch
      />

      {showScattering && (
        <NumberField
          value={commonScattering}
          step={0.01}
          placeholder={scatteringMixed ? 'mix' : String(PYROOMACOUSTICS_DEFAULT_SCATTERING)}
          title="Scattering coefficient (0–1)"
          containerStyle={{ width: '48px' }}
          onCommit={(v) => {
            if (v === null) {
              assignScatteringToObjects(geometryIds, PYROOMACOUSTICS_DEFAULT_SCATTERING);
              return;
            }
            const clamped = Math.min(
              PYROOMACOUSTICS_SCATTERING_MAX,
              Math.max(PYROOMACOUSTICS_SCATTERING_MIN, v),
            );
            assignScatteringToObjects(geometryIds, clamped);
          }}
        />
      )}
    </div>
  );
}
