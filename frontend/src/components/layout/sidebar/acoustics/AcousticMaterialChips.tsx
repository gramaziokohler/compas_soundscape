/**
 * AcousticMaterialChips — the materials row of Hybrid simulation 2.
 *
 * "Acoustic materials" with an edit button, then one chip per assigned material: its name and how
 * many objects use it, tinted with the absorption-gradient colour the Object Explorer uses. Past
 * ACOUSTIC_MATERIAL_CHIPS.MAX_VISIBLE chips a "+N" chip lists the rest in its tooltip. Clicking the
 * row opens the Object Explorer (like AcousticMaterialsSummary, which the other cards keep).
 *
 * Usage:
 * ```tsx
 * <AcousticMaterialChips modified={isModified('materials')} />
 * ```
 */

'use client';

import { useMemo, useState } from 'react';
import { Pencil } from 'lucide-react';
import { useAcousticMaterialStore } from '@/store';
import { ACOUSTIC_MATERIAL_CHIPS } from '@/utils/constants';
import { getMaterialColorByAbsorption } from '@/utils/utils';
import { ModifiedMark } from '@/components/ui/ModifiedMark';
import { SectionHighlight } from '@/components/ui/SectionHighlight';
import { OBJECT_EXPLORER_PANEL_ID, openMaterialsExplorer } from './openMaterialsExplorer';

interface MaterialChip {
  id: string;
  name: string;
  color: string;
  count: number;
}

function Chip({ chip }: { chip: MaterialChip }) {
  return (
    <span
      className="inline-flex max-w-full items-center gap-1 rounded border px-1.5 text-xxs leading-4"
      style={{
        borderColor: chip.color,
        backgroundColor: `color-mix(in srgb, ${chip.color} ${ACOUSTIC_MATERIAL_CHIPS.TINT_PCT}%, transparent)`,
      }}
      title={`${chip.name}: ${chip.count} object${chip.count === 1 ? '' : 's'}`}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: chip.color }} />
      <span className="truncate">{chip.name}</span>
      <span className="text-secondary-hover">{chip.count}</span>
    </span>
  );
}

export function AcousticMaterialChips({ modified = false }: { modified?: boolean }) {
  const materialAssignments = useAcousticMaterialStore((s) => s.materialAssignments);
  const availableMaterials = useAcousticMaterialStore((s) => s.availableMaterials);
  const [highlightTrigger, setHighlightTrigger] = useState(0);

  const chips = useMemo<MaterialChip[]>(() => {
    const counts = new Map<string, number>();
    for (const id of materialAssignments.values()) counts.set(id, (counts.get(id) ?? 0) + 1);
    return availableMaterials
      .filter((m) => counts.has(m.id))
      .map((m) => ({ id: m.id, name: m.name, color: getMaterialColorByAbsorption(m.absorption), count: counts.get(m.id) ?? 0 }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [materialAssignments, availableMaterials]);

  const open = () => {
    openMaterialsExplorer();
    setHighlightTrigger((t) => t + 1);
  };
  const visible = chips.slice(0, ACOUSTIC_MATERIAL_CHIPS.MAX_VISIBLE);
  const hidden = chips.slice(ACOUSTIC_MATERIAL_CHIPS.MAX_VISIBLE);

  return (
    <div className="card-field cursor-pointer" onClick={open}>
      <div className="flex items-center gap-1.5">
        <span className="text-xxs text-secondary-hover">
          Acoustic materials{modified && <ModifiedMark />}
        </span>
        <button
          type="button"
          className="flex cursor-pointer items-center text-secondary-hover transition-colors hover:text-foreground"
          title="Edit the materials in the Object Explorer"
          aria-label="Edit the materials"
        >
          <Pencil size={11} />
        </button>
      </div>
      {chips.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {visible.map((chip) => <Chip key={chip.id} chip={chip} />)}
          {hidden.length > 0 && (
            <span
              className="inline-flex items-center rounded border px-1.5 text-xxs leading-4 text-secondary-hover"
              style={{ borderColor: 'var(--color-border-strong)' }}
              title={hidden.map((c) => `${c.name}: ${c.count}`).join('\n')}
            >
              +{hidden.length}
            </span>
          )}
        </div>
      ) : (
        <button
          type="button"
          className="cursor-pointer self-start rounded border border-primary bg-transparent px-2 text-xxs font-semibold leading-4 text-primary transition-colors hover:bg-primary hover:text-white"
        >
          Assign materials
        </button>
      )}
      <SectionHighlight targetId={OBJECT_EXPLORER_PANEL_ID} trigger={highlightTrigger} />
    </div>
  );
}
