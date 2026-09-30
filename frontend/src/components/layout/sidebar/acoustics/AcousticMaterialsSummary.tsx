/**
 * AcousticMaterialsSummary Component
 *
 * Bottom row of the simulation settings (above the Card's generate button):
 * `Acoustic materials:` followed by the names of the materials currently assigned
 * in the Object Explorer, each tinted with the same absorption-gradient color the
 * Object Explorer uses. Names wrap to at most two lines (ellipsis beyond that);
 * hovering shows the full list.
 *
 * When nothing is assigned, an "Assign" button replaces the names.
 *
 * The whole row is clickable and opens the Object Explorer exactly like the
 * material dot next to the generate button (SimulationSummaryBar).
 *
 * Usage:
 * ```tsx
 * <AcousticMaterialsSummary />
 * ```
 */

'use client';

import { Fragment, useMemo, useState } from 'react';
import { useAcousticMaterialStore } from '@/store';
import { ACOUSTIC_MATERIALS_SUMMARY } from '@/utils/constants';
import { getMaterialColorByAbsorption } from '@/utils/utils';
import { SectionHighlight } from '@/components/ui/SectionHighlight';
import { OBJECT_EXPLORER_PANEL_ID, openMaterialsExplorer } from './openMaterialsExplorer';

const { NAME_SEPARATOR, TOOLTIP_SEPARATOR } = ACOUSTIC_MATERIALS_SUMMARY;

interface AssignedMaterial {
  id: string;
  name: string;
  color: string;
}

export function AcousticMaterialsSummary() {
  const materialAssignments = useAcousticMaterialStore((s) => s.materialAssignments);
  const availableMaterials = useAcousticMaterialStore((s) => s.availableMaterials);
  const [highlightTrigger, setHighlightTrigger] = useState(0);

  const assigned = useMemo<AssignedMaterial[]>(() => {
    const usedIds = new Set(materialAssignments.values());
    return availableMaterials
      .filter((m) => usedIds.has(m.id))
      .map((m) => ({ id: m.id, name: m.name, color: getMaterialColorByAbsorption(m.absorption) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [materialAssignments, availableMaterials]);

  const handleOpen = () => {
    openMaterialsExplorer();
    setHighlightTrigger((t) => t + 1);
  };

  const hasMaterials = assigned.length > 0;

  return (
    <>
      <div
        className="flex items-start gap-1.5 cursor-pointer"
        onClick={handleOpen}
        title={hasMaterials ? assigned.map((m) => m.name).join(TOOLTIP_SEPARATOR) : undefined}
      >
        <span className="text-xxs card-label text-secondary-hover whitespace-nowrap leading-4">
          Acoustic materials:
        </span>

        {hasMaterials ? (
          // Click bubbles to the row; the button keeps the row keyboard-reachable.
          <button
            type="button"
            className="min-w-0 flex-1 cursor-pointer text-left text-xs leading-4 line-clamp-2"
          >
            {assigned.map((m, i) => (
              <Fragment key={m.id}>
                {i > 0 && NAME_SEPARATOR}
                <span style={{ color: m.color }}>{m.name}</span>
              </Fragment>
            ))}
          </button>
        ) : (
          <button
            type="button"
            className="cursor-pointer rounded border border-primary bg-transparent px-2 text-xxs font-semibold leading-4 text-primary transition-colors hover:bg-primary hover:text-white"
          >
            Assign
          </button>
        )}
      </div>
      <SectionHighlight targetId={OBJECT_EXPLORER_PANEL_ID} trigger={highlightTrigger} />
    </>
  );
}
