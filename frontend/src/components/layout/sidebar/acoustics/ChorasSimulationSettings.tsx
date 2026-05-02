/**
 * ChorasSimulationSettings Component
 *
 * Settings UI for Choras (DE / DG) acoustic simulation.
 * Displays a method selector and per-method sliders.
 * Action button and progress bar are handled at the Card level.
 */

'use client';

import {
  CHORAS_DG_FREQ_UPPER_MIN,
  CHORAS_DG_FREQ_UPPER_MAX,
  CHORAS_DG_POLY_ORDER_MIN,
  CHORAS_DG_POLY_ORDER_MAX,
  CHORAS_DG_PPW_MIN,
  CHORAS_DG_PPW_MAX,
  CHORAS_DG_CFL_MIN,
  CHORAS_DG_CFL_MAX,
} from '@/utils/constants';
import type { ChorasSimulationConfig } from '@/types/acoustics';
import { RangeSlider } from '@/components/ui/RangeSlider';

interface ChorasSimulationSettingsProps {
  config: ChorasSimulationConfig;
  onUpdateConfig: (updates: Partial<ChorasSimulationConfig>) => void;
}

export function ChorasSimulationSettings({
  config,
  onUpdateConfig,
}: ChorasSimulationSettingsProps) {
  const settings = config.settings;
  const isRunning = config.isRunning;

  const handleSettingChange = (
    field: keyof ChorasSimulationConfig['settings'],
    value: any,
  ) => {
    onUpdateConfig({
      settings: { ...settings, [field]: value },
    } as Partial<ChorasSimulationConfig>);
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Section title */}
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-neutral-700">
          Simulation Settings
        </h4>
      </div>

      {/* Method selector */}
      <div>
        <label className="text-xs block mb-1 text-neutral-700">
          Method
        </label>
        <select
          value={settings.simulation_method}
          onChange={(e) =>
            handleSettingChange('simulation_method', e.target.value as 'DE' | 'DG')
          }
          disabled={isRunning}
          className="w-full px-3 py-2 text-xs rounded border transition-colors hover:bg-opacity-90 focus:outline-none"
          style={{
            backgroundColor: 'var(--card-color, var(--color-primary))',
            color: 'white',
            borderColor: 'var(--color-secondary-light)',
            borderRadius: '8px',
          }}
        >
          <option value="DE">DE — Diffusion Equation (FVM)</option>
          <option value="DG">DG — Discontinuous Galerkin</option>
        </select>
      </div>

      {/* ── DE settings ─────────────────────────────────────────────────── */}
      {settings.simulation_method === 'DE' && (
        <></>
      )}

      {/* ── DG settings ─────────────────────────────────────────────────── */}
      {settings.simulation_method === 'DG' && (
        <>
          {/* Upper frequency limit */}
          <RangeSlider
            label="Upper frequency: "
            value={settings.dg_freq_upper_limit}
            min={CHORAS_DG_FREQ_UPPER_MIN}
            max={CHORAS_DG_FREQ_UPPER_MAX}
            step={10}
            formatValue={(v) => `${v} Hz`}
            onChange={(v) => handleSettingChange('dg_freq_upper_limit', v)}
            disabled={isRunning}
          />

          {/* Polynomial order */}
          <RangeSlider
            label="Polynomial order: "
            value={settings.dg_poly_order}
            min={CHORAS_DG_POLY_ORDER_MIN}
            max={CHORAS_DG_POLY_ORDER_MAX}
            step={1}
            onChange={(v) => handleSettingChange('dg_poly_order', v)}
            disabled={isRunning}
          />

          {/* Points per wavelength */}
          <RangeSlider
            label="Points/wavelength: "
            value={settings.dg_ppw}
            min={CHORAS_DG_PPW_MIN}
            max={CHORAS_DG_PPW_MAX}
            step={0.5}
            onChange={(v) => handleSettingChange('dg_ppw', v)}
            disabled={isRunning}
          />

          {/* CFL number */}
          <RangeSlider
            label="CFL number: "
            value={settings.dg_cfl}
            min={CHORAS_DG_CFL_MIN}
            max={CHORAS_DG_CFL_MAX}
            step={0.1}
            formatValue={(v) => `${v.toFixed(1)}`}
            onChange={(v) => handleSettingChange('dg_cfl', v)}
            disabled={isRunning}
          />
        </>
      )}
    </div>
  );
}
