/**
 * PyroomAcousticsSimulationSettings Component
 * 
 * Settings UI for Pyroomacoustics acoustic simulation.
 * Extracted from PyroomAcousticsSimulationSection for use in SimulationTab.
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
} from '@/lib/constants';
import type { PyroomAcousticsSimulationConfig } from '@/types/acoustics';
import type { ReceiverData, SoundEvent } from '@/types';
import { CheckboxField } from '@/components/ui/CheckboxField';

interface PyroomAcousticsSimulationSettingsProps {
  config: PyroomAcousticsSimulationConfig;
  modelFile: File | null;
  receivers: ReceiverData[];
  soundscapeData: SoundEvent[] | null;
  onUpdateConfig: (updates: Partial<PyroomAcousticsSimulationConfig>) => void;
  onRunSimulation: () => Promise<void>;
  onCancelSimulation: () => void;
}

export function PyroomAcousticsSimulationSettings({
  config,
  modelFile,
  receivers,
  soundscapeData,
  onUpdateConfig,
  onRunSimulation,
  onCancelSimulation
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

      {/* Error Display */}
      {config.error && (
        <div className="px-3 py-2 rounded text-xs" style={{
          backgroundColor: UI_COLORS.ERROR_LIGHT,
          color: UI_COLORS.ERROR,
          borderRadius: '8px'
        }}>
          {config.error}
        </div>
      )}

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
      backgroundColor: UI_COLORS.PRIMARY,
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
      <div>
        <label className="text-xs block mb-1" style={{ color: UI_COLORS.NEUTRAL_700 }}>
          Image-Source order: {config.settings.max_order}
          {config.settings.ray_tracing &&
           config.settings.max_order > PYROOMACOUSTICS_RAY_TRACING_RECOMMENDED_MAX_ORDER && (
            <span style={{ color: UI_COLORS.WARNING, marginLeft: '4px' }}>
              (≤{PYROOMACOUSTICS_RAY_TRACING_RECOMMENDED_MAX_ORDER} recommended for ray tracing)
            </span>
          )}
        </label>
        <input
          type="range"
          value={config.settings.max_order}
          onChange={(e) => handleSettingChange('max_order', parseInt(e.target.value))}
          className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-primary"
          style={{ backgroundColor: UI_COLORS.NEUTRAL_200 }}
          min={PYROOMACOUSTICS_MAX_ORDER_MIN}
          max={PYROOMACOUSTICS_MAX_ORDER_MAX}
          step="1"
          disabled={config.isRunning}
        />
      </div>

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
              className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-primary"
              style={{ backgroundColor: UI_COLORS.NEUTRAL_200 }}
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
              className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-primary"
              style={{ backgroundColor: UI_COLORS.NEUTRAL_200 }}
              min={PYROOMACOUSTICS_SCATTERING_MIN}
              max={PYROOMACOUSTICS_SCATTERING_MAX}
              step="0.01"
              disabled={config.isRunning}
            />
          </div>
        </div>
      )}

      {/* Action Button */}
      {!config.isRunning && (
        <button
          onClick={onRunSimulation}
          disabled={!modelFile || !receivers?.length || !soundscapeData?.length}
          className="w-full py-2 px-4 rounded text-xs font-medium transition-all"
          style={{
            backgroundColor: (!modelFile || !receivers?.length || !soundscapeData?.length) ? UI_COLORS.NEUTRAL_400 : UI_COLORS.PRIMARY,
            color: 'white',
            cursor: (!modelFile || !receivers?.length || !soundscapeData?.length) ? 'not-allowed' : 'pointer',
            borderRadius: '8px',
            opacity: (!modelFile || !receivers?.length || !soundscapeData?.length) ? 0.4 : 1
          }}
          onMouseEnter={(e) => {
            if (modelFile && receivers?.length && soundscapeData?.length) {
              e.currentTarget.style.backgroundColor = UI_COLORS.NEUTRAL_400;
            }
          }}
          onMouseLeave={(e) => {
            if (modelFile && receivers?.length && soundscapeData?.length) {
              e.currentTarget.style.backgroundColor = UI_COLORS.PRIMARY;
            }
          }}
        >
          Start Simulation
        </button>
      )}

      {/* Running Status */}
      {config.isRunning && (
        <div
          className="px-3 py-2 rounded text-xs text-center"
          style={{
            backgroundColor: UI_COLORS.PRIMARY,
            color: 'white',
            borderRadius: '8px'
          }}
        >
          {config.status || 'Calculating...'}
        </div>
      )}
    </div>
  );
}
