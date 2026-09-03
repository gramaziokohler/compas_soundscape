/**
 * PyroomAcousticsSimulationSettings Component
 * 
 * Settings UI for Pyroomacoustics acoustic simulation.
 * Extracted from PyroomAcousticsSimulationSection for use in SimulationTab.
 * 
 * Note: Action button, progress bar, and stop button are handled at the Card level.
 */

'use client';

import {
  PYROOMACOUSTICS_MAX_ORDER_MIN,
  PYROOMACOUSTICS_MAX_ORDER_MAX,
  PYROOMACOUSTICS_DEFAULT_MAX_ORDER,
  PYROOMACOUSTICS_RAY_TRACING_RECOMMENDED_MAX_ORDER,
  PYROOMACOUSTICS_RAY_TRACING_N_RAYS,
  PYROOMACOUSTICS_RAY_TRACING_N_RAYS_MIN,
  PYROOMACOUSTICS_RAY_TRACING_N_RAYS_MAX,
  PYROOMACOUSTICS_SIMULATION_MODE_MONO,
  PYROOMACOUSTICS_SIMULATION_MODE_FOA,
  PYROOMACOUSTICS_SIMULATION_MODE_NAMES
} from '@/utils/constants';
import type { PyroomAcousticsSimulationConfig } from '@/types/acoustics';
import { CheckboxField } from '@/components/ui/CheckboxField';
import { RangeSlider } from '@/components/ui/RangeSlider';
import { CardSelect } from '@/components/ui/CardSelect';

interface PyroomAcousticsSimulationSettingsProps {
  config: PyroomAcousticsSimulationConfig;
  onUpdateConfig: (updates: Partial<PyroomAcousticsSimulationConfig>) => void;
}

export function PyroomAcousticsSimulationSettings({
  config,
  onUpdateConfig
}: PyroomAcousticsSimulationSettingsProps) {
  
  const handleSettingChange = (field: keyof PyroomAcousticsSimulationConfig['settings'], value: any) => {
    onUpdateConfig({
      settings: {
        ...config.settings,
        [field]: value
      }
    } as Partial<PyroomAcousticsSimulationConfig>);
  };

  return (
    <div className="flex flex-col gap-1">

      {/* Note: Error display is handled at Card level for consistency */}

{/* Simulation Mode Dropdown */}
<div>
  <label
    className="text-xxs block mb-1 text-secondary-hover"
  >
    Simulation Mode
  </label>

  <CardSelect
    value={config.settings.simulation_mode}
    onChange={(v) => handleSettingChange('simulation_mode', v)}
    disabled={config.isRunning}
    options={[
      {
        value: PYROOMACOUSTICS_SIMULATION_MODE_MONO,
        label: PYROOMACOUSTICS_SIMULATION_MODE_NAMES[PYROOMACOUSTICS_SIMULATION_MODE_MONO],
      },
      {
        value: PYROOMACOUSTICS_SIMULATION_MODE_FOA,
        label: PYROOMACOUSTICS_SIMULATION_MODE_NAMES[PYROOMACOUSTICS_SIMULATION_MODE_FOA],
      },
    ]}
  />
</div>

      {/* Toggles */}
      <div className="flex flex-col gap-1">

        {/* Image Source Order Slider */}
        <RangeSlider
          label="Image-Source order"
          value={config.settings.max_order}
          min={PYROOMACOUSTICS_MAX_ORDER_MIN}
          max={PYROOMACOUSTICS_MAX_ORDER_MAX}
          step={1}
          onChange={(value) => handleSettingChange('max_order', value)}
          disabled={config.isRunning}
          defaultValue={PYROOMACOUSTICS_DEFAULT_MAX_ORDER}
        />

        <CheckboxField
          checked={config.settings.air_absorption}
          onChange={(checked) => handleSettingChange('air_absorption', checked)}
          label="Air absorption"
          disabled={config.isRunning}
        />
        <CheckboxField
          checked={config.settings.ray_tracing}
          onChange={(checked) => handleSettingChange('ray_tracing', checked)}
          label="Ray tracing (hybrid)"
          disabled={config.isRunning}
/>
      {/* Ray Tracing Parameters (visible when enabled) */}
      {config.settings.ray_tracing && (
        <RangeSlider
          label="Rays"
          value={config.settings.n_rays}
          min={PYROOMACOUSTICS_RAY_TRACING_N_RAYS_MIN}
          max={PYROOMACOUSTICS_RAY_TRACING_N_RAYS_MAX}
          step={1000}
          onChange={(value) => handleSettingChange('n_rays', value)}
          disabled={config.isRunning}
          defaultValue={PYROOMACOUSTICS_RAY_TRACING_N_RAYS}
          showLabels={false}
        />
      )}
    </div>

      {/* Note: Action button, progress bar, and stop button are rendered by Card component */}
    </div>
  );
}
