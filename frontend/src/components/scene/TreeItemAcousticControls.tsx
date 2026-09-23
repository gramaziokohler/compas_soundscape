/**
 * TreeItemAcousticControls
 *
 * Material dropdown + scattering field for Object Explorer rows.
 * Renders as two grid cells when the parent row uses `objectExplorerAcousticGridStyle`.
 */

'use client';

import { useMemo } from 'react';
import { useAcousticMaterialStore } from '@/store';
import { MaterialSelect, type MaterialOption } from '@/components/ui/MaterialSelect';
import { NumberField } from '@/components/ui/NumberField';
import { OBJECT_EXPLORER_SCATTERING_FIELD_CH } from '@/components/scene/objectExplorerAcousticLayout';
import {
  PYROOMACOUSTICS_DEFAULT_SCATTERING,
  PYROOMACOUSTICS_SCATTERING_MIN,
  PYROOMACOUSTICS_SCATTERING_MAX,
} from '@/utils/constants';

export { OBJECT_EXPLORER_SCATTERING_FIELD_CH };

interface TreeItemAcousticControlsProps {
  geometryIds: string[];
  sortedMaterials: MaterialOption[];
  materialColors: Map<string, string>;
  showScattering: boolean;
  /** True when this row is part of the current row selection. */
  isSelected?: boolean;
  /** Geometry-leaf union across all selected rows. When this row is selected,
   *  material / scattering edits apply to this whole set. */
  selectedGeometryIds?: string[];
}

export function TreeItemAcousticControls({
  geometryIds,
  sortedMaterials,
  materialColors,
  showScattering,
  isSelected = false,
  selectedGeometryIds,
}: TreeItemAcousticControlsProps) {
  const materialAssignments = useAcousticMaterialStore((s) => s.materialAssignments);
  const scatteringAssignments = useAcousticMaterialStore((s) => s.scatteringAssignments);
  const assignMaterialToObjects = useAcousticMaterialStore((s) => s.assignMaterialToObjects);
  const assignScatteringToObjects = useAcousticMaterialStore((s) => s.assignScatteringToObjects);

  // When this row is selected alongside others, an edit is scoped to the whole
  // selection. The union is always a superset of this row's own geometry, so a
  // longer union means other selected rows contributed surfaces.
  const appliesToSelection = isSelected
    && !!selectedGeometryIds
    && selectedGeometryIds.length > geometryIds.length;
  const targetIds = appliesToSelection ? selectedGeometryIds! : geometryIds;
  const selectionTitle = appliesToSelection
    ? `Applies to ${selectedGeometryIds!.length} selected surfaces`
    : undefined;

  const { commonMaterialId, isMixed } = useMemo(() => {
    const assigned = new Set<string>();
    for (const id of targetIds) {
      const m = materialAssignments.get(id);
      if (m) assigned.add(m);
    }
    return {
      commonMaterialId: assigned.size === 1 ? Array.from(assigned)[0] : null,
      isMixed: assigned.size > 1,
    };
  }, [targetIds, materialAssignments]);

  const { commonScattering, scatteringMixed } = useMemo(() => {
    if (targetIds.length === 0) return { commonScattering: null as number | null, scatteringMixed: false };
    const values = new Set<number>();
    for (const id of targetIds) {
      values.add(scatteringAssignments.get(id) ?? PYROOMACOUSTICS_DEFAULT_SCATTERING);
    }
    return {
      commonScattering: values.size === 1 ? Array.from(values)[0] : null,
      scatteringMixed: values.size > 1,
    };
  }, [targetIds, scatteringAssignments]);

  if (geometryIds.length === 0) {
    return (
      <>
        <div className="justify-self-end" aria-hidden />
        {showScattering && <div className="justify-self-center" aria-hidden />}
      </>
    );
  }

  return (
    <>
      <div
        className="flex justify-end min-w-0 justify-self-end"
        data-no-drag
        title={selectionTitle}
        onClick={(e) => e.stopPropagation()}
      >
        <MaterialSelect
          value={commonMaterialId || ''}
          onChange={(matId) => assignMaterialToObjects(targetIds, matId)}
          materials={sortedMaterials}
          materialColors={materialColors}
          placeholder={isMixed ? '(mixed)' : 'Select...'}
          isMixed={isMixed}
          showSearch
          variant="explorer"
        />
      </div>

      {showScattering && (
        <div
          className="flex justify-center min-w-0 justify-self-center"
          data-no-drag
          title={selectionTitle}
          onClick={(e) => e.stopPropagation()}
        >
          <NumberField
            value={commonScattering}
            precision={2}
            placeholder={scatteringMixed ? 'mix' : String(PYROOMACOUSTICS_DEFAULT_SCATTERING)}
            title="Scattering coefficient (0–1)"
            containerStyle={{ width: `${OBJECT_EXPLORER_SCATTERING_FIELD_CH}ch` }}
            className="!text-xs !py-0.5 !text-primary placeholder:text-primary"
            onCommit={(v) => {
              if (v === null) {
                assignScatteringToObjects(targetIds, PYROOMACOUSTICS_DEFAULT_SCATTERING);
                return;
              }
              const clamped = Math.min(
                PYROOMACOUSTICS_SCATTERING_MAX,
                Math.max(PYROOMACOUSTICS_SCATTERING_MIN, v),
              );
              assignScatteringToObjects(targetIds, clamped);
            }}
          />
        </div>
      )}
    </>
  );
}
