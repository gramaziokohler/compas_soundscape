/**
 * PreflightPreviewControls
 *
 * Controls of the 3D simulation-mesh preview: colour mode (orientation as
 * simulated, topology, outer shell vs objects inside the room), then the
 * categories of that mode — each row is a checkbox tinted with the colour the
 * category has in 3D, so the legend doubles as the visibility filter — and
 * the overlay toggles, tinted the same way.
 */

'use client';

import { useSimulationPreflightStore } from '@/store';
import { TextSelect } from '@/components/ui/TextSelect';
import { Checkbox } from '@/components/ui/Checkbox';
import { PREVIEW_CATEGORIES, PREVIEW_OVERLAYS, type PreviewCategory } from '@/lib/three/simulation-mesh-colors';
import type { PreflightFilters, PreflightViewMode } from '@/types/simulationPreflight';

const VIEW_MODES: { value: PreflightViewMode; label: string; title: string }[] = [
  { value: 'orientation', label: 'Orientation', title: 'Which side of each surface reflects sound, as simulated' },
  { value: 'topology', label: 'Topology', title: 'Closed elements vs single surfaces' },
  { value: 'class', label: 'Shell', title: 'Outer shell vs objects inside the room' },
];

function CategoryToggles({ items, inline = false }: { items: PreviewCategory<keyof PreflightFilters>[]; inline?: boolean }) {
  const filters = useSimulationPreflightStore((s) => s.filters);
  const toggleFilter = useSimulationPreflightStore((s) => s.toggleFilter);
  return (
    <div className={inline ? 'flex flex-wrap gap-x-3 gap-y-1' : 'card-stack--tight'}>
      {items.map(({ key, label, colorVar }) => (
        <label key={key} className="flex cursor-pointer items-center gap-1.5 text-xxs">
          <Checkbox
            checked={filters[key]}
            onChange={() => toggleFilter(key)}
            size={12}
            label={label}
            accentColor={`var(${colorVar})`}
          />
          {label}
        </label>
      ))}
    </div>
  );
}

export function PreflightPreviewControls() {
  const viewMode = useSimulationPreflightStore((s) => s.viewMode);
  const setViewMode = useSimulationPreflightStore((s) => s.setViewMode);
  const ghost = useSimulationPreflightStore((s) => s.ghost);
  const setGhost = useSimulationPreflightStore((s) => s.setGhost);

  return (
    <div className="card-stack--md">
      <TextSelect
        compact
        value={viewMode}
        onChange={(v) => setViewMode(v as PreflightViewMode)}
        options={VIEW_MODES}
      />
      <CategoryToggles items={PREVIEW_CATEGORIES[viewMode]} />
      <div className="card-field">
        <span className="text-xxs text-secondary-hover">Overlays</span>
        <CategoryToggles items={PREVIEW_OVERLAYS} inline />
        <label className="flex cursor-pointer items-center gap-1.5 text-xxs">
          <Checkbox checked={ghost} onChange={setGhost} size={12} label="See-through surfaces" />
          See-through surfaces
        </label>
      </div>
    </div>
  );
}
