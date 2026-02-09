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
  UI_COLORS,
  PYROOMACOUSTICS_MAX_ORDER_MIN,
  PYROOMACOUSTICS_MAX_ORDER_MAX,
  PYROOMACOUSTICS_RAY_TRACING_RECOMMENDED_MAX_ORDER,
  PYROOMACOUSTICS_RAY_TRACING_N_RAYS_MIN,
  PYROOMACOUSTICS_RAY_TRACING_N_RAYS_MAX,
  PYROOMACOUSTICS_SCATTERING_MIN,
  PYROOMACOUSTICS_SCATTERING_MAX,
  PYROOMACOUSTICS_SIMULATION_MODE_MONO,
  PYROOMACOUSTICS_SIMULATION_MODE_FOA,
  PYROOMACOUSTICS_SIMULATION_MODE_NAMES
} from '@/utils/constants';
import type { PyroomAcousticsSimulationConfig } from '@/types/acoustics';
import { CheckboxField } from '@/components/ui/CheckboxField';
import { RangeSlider } from '@/components/ui/RangeSlider';

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
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold" style={{ color: UI_COLORS.NEUTRAL_700 }}>
          Simulation Settings
        </h4>
      </div>

      {/* Note: Error display is handled at Card level for consistency */}

{/* Simulation Mode Dropdown */}
<div>
  <label
    className="text-xs block mb-1"
    style={{ color: UI_COLORS.NEUTRAL_700 }}
  >
    Simulation Mode
  </label>

  <select
    value={config.settings.simulation_mode}
    onChange={(e) => handleSettingChange('simulation_mode', e.target.value)}
    className="
      w-full px-3 py-2 text-xs rounded border transition-colors
      hover:bg-opacity-90 focus:outline-none
    "
    style={{
      backgroundColor: 'var(--card-color, var(--color-primary))',
      color: 'white',
      borderColor: UI_COLORS.NEUTRAL_300,
      borderRadius: '8px',
    }}
    disabled={config.isRunning}
  >
    <option value={PYROOMACOUSTICS_SIMULATION_MODE_MONO}>
      {PYROOMACOUSTICS_SIMULATION_MODE_NAMES[PYROOMACOUSTICS_SIMULATION_MODE_MONO]}
    </option>

    <option value={PYROOMACOUSTICS_SIMULATION_MODE_FOA}>
      {PYROOMACOUSTICS_SIMULATION_MODE_NAMES[PYROOMACOUSTICS_SIMULATION_MODE_FOA]}
    </option>
  </select>
</div>

      {/* Max Order Slider */}
      <RangeSlider
        label="Image-Source order: "
        value={config.settings.max_order}
        min={PYROOMACOUSTICS_MAX_ORDER_MIN}
        max={PYROOMACOUSTICS_MAX_ORDER_MAX}
        step={1}
        onChange={(value) => handleSettingChange('max_order', value)}
        disabled={config.isRunning}
      />

      {/* Toggles */}
      <div className="flex flex-col">
        <CheckboxField
          checked={config.settings.ray_tracing}
          onChange={(checked) => handleSettingChange('ray_tracing', checked)}
          label="Ray tracing (hybrid)"
          disabled={config.isRunning}
        />
        <CheckboxField
          checked={config.settings.air_absorption}
          onChange={(checked) => handleSettingChange('air_absorption', checked)}
          label="Air absorption"
          disabled={config.isRunning}
        />
      </div>

      {/* Ray Tracing Parameters (2-column grid when enabled) */}
      {config.settings.ray_tracing && (
        <div className="grid grid-cols-2 gap-2">
          {/* Number of Rays */}
          <div>
            <label className="text-xs block mb-1" style={{ color: UI_COLORS.NEUTRAL_700 }}>
              Rays: {(config.settings.n_rays / 1000).toFixed(0)}k
            </label>
            <input
              type="range"
              value={config.settings.n_rays}
              onChange={(e) => handleSettingChange('n_rays', parseInt(e.target.value))}
              className="w-full h-2 rounded-lg appearance-none cursor-pointer"
              style={{ backgroundColor: UI_COLORS.NEUTRAL_200, accentColor: 'var(--card-color, var(--color-primary))' }}
              min={PYROOMACOUSTICS_RAY_TRACING_N_RAYS_MIN}
              max={PYROOMACOUSTICS_RAY_TRACING_N_RAYS_MAX}
              step="1000"
              disabled={config.isRunning}
            />
          </div>

          {/* Scattering */}
          <div>
            <label className="text-xs block mb-1" style={{ color: UI_COLORS.NEUTRAL_700 }}>
              Scattering: {config.settings.scattering.toFixed(2)}
            </label>
            <input
              type="range"
              value={config.settings.scattering}
              onChange={(e) => handleSettingChange('scattering', parseFloat(e.target.value))}
              className="w-full h-2 rounded-lg appearance-none cursor-pointer"
              style={{ backgroundColor: UI_COLORS.NEUTRAL_200, accentColor: 'var(--card-color, var(--color-primary))' }}
              min={PYROOMACOUSTICS_SCATTERING_MIN}
              max={PYROOMACOUSTICS_SCATTERING_MAX}
              step="0.01"
              disabled={config.isRunning}
            />
          </div>
        </div>
      )}

      {/* Note: Action button, progress bar, and stop button are rendered by Card component */}
    </div>
  );
}
