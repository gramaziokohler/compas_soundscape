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
  CHORAS_DG_DEFAULT_FREQ_UPPER,
  CHORAS_DG_POLY_ORDER_MIN,
  CHORAS_DG_POLY_ORDER_MAX,
  CHORAS_DG_DEFAULT_POLY_ORDER,
  CHORAS_DG_PPW_MIN,
  CHORAS_DG_PPW_MAX,
  CHORAS_DG_DEFAULT_PPW,
  CHORAS_DG_CFL_MIN,
  CHORAS_DG_CFL_MAX,
  CHORAS_DG_DEFAULT_CFL,
} from '@/utils/constants';
import type { ChorasSimulationConfig } from '@/types/acoustics';
import { RangeSlider } from '@/components/ui/RangeSlider';
import { CardSelect } from '@/components/ui/CardSelect';

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
    <div className="card-stack">

      {/* Method selector */}
      <div>
        <label className="text-xs card-label text-neutral-700">
          Method
        </label>
        <CardSelect
          value={settings.simulation_method}
          onChange={(v) =>
            handleSettingChange('simulation_method', v as 'DE' | 'DG')
          }
          disabled={isRunning}
          options={[
            { value: 'DE', label: 'DE — Diffusion Equation (FVM)' },
            { value: 'DG', label: 'DG — Discontinuous Galerkin' },
          ]}
        />
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
            label="Upper frequency"
            value={settings.dg_freq_upper_limit}
            min={CHORAS_DG_FREQ_UPPER_MIN}
            max={CHORAS_DG_FREQ_UPPER_MAX}
            step={10}
            unit="Hz"
            defaultValue={CHORAS_DG_DEFAULT_FREQ_UPPER}
            onChange={(v) => handleSettingChange('dg_freq_upper_limit', v)}
            disabled={isRunning}
          />

          {/* Polynomial order */}
          <RangeSlider
            label="Polynomial order"
            value={settings.dg_poly_order}
            min={CHORAS_DG_POLY_ORDER_MIN}
            max={CHORAS_DG_POLY_ORDER_MAX}
            step={1}
            defaultValue={CHORAS_DG_DEFAULT_POLY_ORDER}
            onChange={(v) => handleSettingChange('dg_poly_order', v)}
            disabled={isRunning}
          />

          {/* Points per wavelength */}
          <RangeSlider
            label="Points/wavelength"
            value={settings.dg_ppw}
            min={CHORAS_DG_PPW_MIN}
            max={CHORAS_DG_PPW_MAX}
            step={0.5}
            defaultValue={CHORAS_DG_DEFAULT_PPW}
            onChange={(v) => handleSettingChange('dg_ppw', v)}
            disabled={isRunning}
          />

          {/* CFL number */}
          <RangeSlider
            label="CFL number"
            value={settings.dg_cfl}
            min={CHORAS_DG_CFL_MIN}
            max={CHORAS_DG_CFL_MAX}
            step={0.1}
            defaultValue={CHORAS_DG_DEFAULT_CFL}
            onChange={(v) => handleSettingChange('dg_cfl', v)}
            disabled={isRunning}
          />
        </>
      )}
    </div>
  );
}
