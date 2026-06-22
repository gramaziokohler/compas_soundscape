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

import { useMemo, useState, useEffect, useRef } from 'react';
import { useAcousticMaterialStore } from '@/store';
import { MaterialSelect, type MaterialOption } from '@/components/ui/MaterialSelect';
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

  // Local scattering input text (lets the user type freely; commit on blur/Enter)
  const [scatterText, setScatterText] = useState('');
  const editingRef = useRef(false);
  useEffect(() => {
    if (editingRef.current) return;
    setScatterText(scatteringMixed || commonScattering === null ? '' : String(commonScattering));
  }, [commonScattering, scatteringMixed]);

  const commitScattering = () => {
    editingRef.current = false;
    const trimmed = scatterText.trim();
    if (trimmed === '') {
      // Reset to default when cleared
      assignScatteringToObjects(geometryIds, PYROOMACOUSTICS_DEFAULT_SCATTERING);
      return;
    }
    const parsed = Number(trimmed);
    if (Number.isNaN(parsed)) {
      setScatterText(scatteringMixed || commonScattering === null ? '' : String(commonScattering));
      return;
    }
    const clamped = Math.min(
      PYROOMACOUSTICS_SCATTERING_MAX,
      Math.max(PYROOMACOUSTICS_SCATTERING_MIN, parsed),
    );
    assignScatteringToObjects(geometryIds, clamped);
    setScatterText(String(clamped));
  };

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
      />

      {showScattering && (
        <input
          type="number"
          step={0.01}
          min={PYROOMACOUSTICS_SCATTERING_MIN}
          max={PYROOMACOUSTICS_SCATTERING_MAX}
          value={scatterText}
          placeholder={scatteringMixed ? 'mix' : String(PYROOMACOUSTICS_DEFAULT_SCATTERING)}
          title="Scattering coefficient (0–1)"
          onFocus={() => { editingRef.current = true; }}
          onChange={(e) => { editingRef.current = true; setScatterText(e.target.value); }}
          onBlur={commitScattering}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); }
            e.stopPropagation();
          }}
          className="text-xs px-1 py-1 rounded text-center focus:outline-none focus:ring-1"
          style={{
            width: '48px',
            backgroundColor: 'var(--color-secondary-lighter)',
            color: 'var(--color-foreground)',
            border: '1px solid var(--color-secondary-light)',
          }}
        />
      )}
    </div>
  );
}
