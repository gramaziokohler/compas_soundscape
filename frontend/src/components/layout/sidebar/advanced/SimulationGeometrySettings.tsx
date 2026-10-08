/**
 * SimulationGeometrySettings — Advanced settings > Acoustics > Simulation geometry.
 *
 * How the Speckle acoustic layer is turned into the simulation mesh, for every
 * engine (pyroomacoustics and Choras) and for the pre-simulation geometry
 * check. Changing a value marks existing geometry checks as outdated.
 */

'use client';

import { useUIStore } from '@/store/uiStore';
import { RangeSlider } from '@/components/ui/RangeSlider';
import { ToggleField } from '@/components/ui/ToggleField';
import { TextSelect } from '@/components/ui/TextSelect';
import { SIMULATION_MESH_SETTINGS_DEFAULTS, SIMULATION_MESH_SETTINGS_RANGES } from '@/utils/constants';
import type { SimulationMeshSettings } from '@/types/simulationPreflight';

const QUALITY_OPTIONS: { value: SimulationMeshSettings['visibility_quality']; label: string; title: string }[] = [
  { value: 'fast', label: 'Fast', title: 'Fewer rays: quicker, may miss small surfaces' },
  { value: 'standard', label: 'Standard', title: 'Balanced' },
  { value: 'thorough', label: 'Thorough', title: 'More rays: slower, most reliable orientation and leak detection' },
];

export function SimulationGeometrySettings() {
  const settings = useUIStore((s) => s.simulationMeshSettings);
  const update = useUIStore((s) => s.setSimulationMeshSettings);
  const R = SIMULATION_MESH_SETTINGS_RANGES;
  const D = SIMULATION_MESH_SETTINGS_DEFAULTS;

  return (
    <div className="card-stack--md">
      <RangeSlider
        label="Weld tolerance"
        value={settings.weld_tolerance_mm}
        min={R.WELD_TOLERANCE_MM.MIN}
        max={R.WELD_TOLERANCE_MM.MAX}
        step={R.WELD_TOLERANCE_MM.STEP}
        unit="mm"
        defaultValue={D.weld_tolerance_mm}
        onChange={(v) => update({ weld_tolerance_mm: v })}
        hoverText="Vertices closer than this are merged, closing seams between objects. Raise it when the check reports objects that are closed but not welded."
      />
      <ToggleField
        checked={settings.merge_coplanar}
        onChange={(v) => update({ merge_coplanar: v })}
        label="Merge coplanar triangles into walls"
      />
      {settings.merge_coplanar && (
        <>
          <RangeSlider
            label="Coplanar angle"
            value={settings.coplanar_angle_deg}
            min={R.COPLANAR_ANGLE_DEG.MIN}
            max={R.COPLANAR_ANGLE_DEG.MAX}
            step={R.COPLANAR_ANGLE_DEG.STEP}
            unit="°"
            defaultValue={D.coplanar_angle_deg}
            onChange={(v) => update({ coplanar_angle_deg: v })}
            hoverText="Neighbouring triangles whose normals differ by less than this become one wall (pyroomacoustics only). Fewer walls = much faster image-source search."
          />
          <RangeSlider
            label="Coplanar distance"
            value={settings.coplanar_distance_mm}
            min={R.COPLANAR_DISTANCE_MM.MIN}
            max={R.COPLANAR_DISTANCE_MM.MAX}
            step={R.COPLANAR_DISTANCE_MM.STEP}
            unit="mm"
            defaultValue={D.coplanar_distance_mm}
            onChange={(v) => update({ coplanar_distance_mm: v })}
            hoverText="Maximum out-of-plane deviation inside a merged wall."
          />
        </>
      )}
      <ToggleField
        checked={settings.detect_two_sided}
        onChange={(v) => update({ detect_two_sided: v })}
        label="Double-sided thin surfaces"
      />
      <div className="card-field">
        <span className="text-xxs text-secondary-hover">Orientation analysis</span>
        <TextSelect
          compact
          value={settings.visibility_quality}
          onChange={(v) => update({ visibility_quality: v as SimulationMeshSettings['visibility_quality'] })}
          options={QUALITY_OPTIONS}
        />
      </div>
    </div>
  );
}
