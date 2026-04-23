/**
 * ChorasSimulationSettings Component
 *
 * Settings UI for Choras (DE / DG) acoustic simulation.
 * Displays a method selector and per-method sliders.
 * Action button and progress bar are handled at the Card level.
 */

'use client';

import {
  UI_COLORS,
  CHORAS_C0_MIN,
  CHORAS_C0_MAX,
  CHORAS_DE_IR_LENGTH_MIN,
  CHORAS_DE_IR_LENGTH_MAX,
  CHORAS_DE_LC_MIN,
  CHORAS_DE_LC_MAX,
  CHORAS_DE_EDT_MIN,
  CHORAS_DE_EDT_MAX,
  CHORAS_DG_FREQ_UPPER_MIN,
  CHORAS_DG_FREQ_UPPER_MAX,
  CHORAS_DG_IR_LENGTH_MIN,
  CHORAS_DG_IR_LENGTH_MAX,
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
        <h4 className="text-xs font-semibold" style={{ color: UI_COLORS.NEUTRAL_700 }}>
          Simulation Settings
        </h4>
      </div>

      {/* Method selector */}
      <div>
        <label className="text-xs block mb-1" style={{ color: UI_COLORS.NEUTRAL_700 }}>
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
            borderColor: UI_COLORS.NEUTRAL_300,
            borderRadius: '8px',
          }}
        >
          <option value="DE">DE — Diffusion Equation (FVM)</option>
          <option value="DG">DG — Discontinuous Galerkin</option>
        </select>
      </div>

      {/* ── DE settings ─────────────────────────────────────────────────── */}
      {settings.simulation_method === 'DE' && (
        <>
          {/* Simulation length type */}
          <div>
            <label className="text-xs block mb-1" style={{ color: UI_COLORS.NEUTRAL_700 }}>
              Length type
            </label>
            <select
              value={settings.de_sim_len_type}
              onChange={(e) =>
                handleSettingChange('de_sim_len_type', e.target.value as 'ir_length' | 'edt')
              }
              disabled={isRunning}
              className="w-full px-3 py-2 text-xs rounded border transition-colors hover:bg-opacity-90 focus:outline-none"
              style={{
                backgroundColor: 'var(--card-color, var(--color-primary))',
                color: 'white',
                borderColor: UI_COLORS.NEUTRAL_300,
                borderRadius: '8px',
              }}
            >
              <option value="edt">EDT-based length</option>
              <option value="ir_length">Fixed IR length</option>
            </select>
          </div>

          {/* EDT threshold (only when sim_len_type === 'edt') */}
          {settings.de_sim_len_type === 'edt' && (
            <RangeSlider
              label="EDT target: "
              value={settings.de_edt}
              min={CHORAS_DE_EDT_MIN}
              max={CHORAS_DE_EDT_MAX}
              step={1}
              formatValue={(v) => `${v} dB`}
              onChange={(v) => handleSettingChange('de_edt', v)}
              disabled={isRunning}
            />
          )}

          {/* IR length */}
          <RangeSlider
            label="IR length: "
            value={settings.de_ir_length}
            min={CHORAS_DE_IR_LENGTH_MIN}
            max={CHORAS_DE_IR_LENGTH_MAX}
            step={0.05}
            formatValue={(v) => `${v.toFixed(2)} s`}
            onChange={(v) => handleSettingChange('de_ir_length', v)}
            disabled={isRunning}
          />

          {/* Speed of sound */}
          <RangeSlider
            label="Speed of sound: "
            value={settings.de_c0}
            min={CHORAS_C0_MIN}
            max={CHORAS_C0_MAX}
            step={1}
            formatValue={(v) => `${v} m/s`}
            onChange={(v) => handleSettingChange('de_c0', v)}
            disabled={isRunning}
          />

          {/* Characteristic mesh length */}
          <RangeSlider
            label="Mesh length (lc): "
            value={settings.de_lc}
            min={CHORAS_DE_LC_MIN}
            max={CHORAS_DE_LC_MAX}
            step={0.1}
            formatValue={(v) => `${v.toFixed(1)} m`}
            onChange={(v) => handleSettingChange('de_lc', v)}
            disabled={isRunning}
          />
        </>
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

          {/* IR length */}
          <RangeSlider
            label="IR length: "
            value={settings.dg_ir_length}
            min={CHORAS_DG_IR_LENGTH_MIN}
            max={CHORAS_DG_IR_LENGTH_MAX}
            step={0.01}
            formatValue={(v) => `${v.toFixed(2)} s`}
            onChange={(v) => handleSettingChange('dg_ir_length', v)}
            disabled={isRunning}
          />

          {/* Speed of sound */}
          <RangeSlider
            label="Speed of sound: "
            value={settings.dg_c0}
            min={CHORAS_C0_MIN}
            max={CHORAS_C0_MAX}
            step={1}
            formatValue={(v) => `${v} m/s`}
            onChange={(v) => handleSettingChange('dg_c0', v)}
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
