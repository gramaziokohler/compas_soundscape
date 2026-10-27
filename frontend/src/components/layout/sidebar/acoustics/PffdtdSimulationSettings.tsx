/**
 * PffdtdSimulationSettings Component
 *
 * Settings UI of the wave-based (PFFDTD, GPU FDTD) simulation card: output
 * mode, grid (max frequency × points per wavelength), IR length, air
 * absorption. The strength-G (SPL) volume is always recorded everywhere; the
 * pressure-wave animation is generated on demand from the results. Shows the live grid spacing and the solver's limits (band limit,
 * staircased oblique walls, seed clearance).
 *
 * Note: Action button, progress bar, and stop button are handled at the Card level.
 */

'use client';

import {
  PFFDTD,
  PYROOMACOUSTICS_SIMULATION_MODE_MONO,
  PYROOMACOUSTICS_SIMULATION_MODE_FOA,
  PYROOMACOUSTICS_SIMULATION_MODE_NAMES,
} from '@/utils/constants';
import { pffdtdGridSpacing, pffdtdSeedClearance } from '@/lib/acoustics/pffdtd-grid';
import type { PffdtdSimulationConfig } from '@/types/acoustics';
import type { PffdtdSettings } from '@/types/pffdtd';
import { ToggleField } from '@/components/ui/ToggleField';
import { RangeSlider } from '@/components/ui/RangeSlider';
import { CardSelect } from '@/components/ui/CardSelect';
import { Notice } from '@/components/ui/Notice';
import { AcousticMaterialsSummary } from './AcousticMaterialsSummary';
import { PffdtdFreePositioningSettings } from './PffdtdFreePositioningSettings';
import { ModifiedMark, useIsFieldModified } from '@/components/ui/ModifiedMark';
import { useDirectionalSources } from '@/hooks/useDirectionalSources';

interface PffdtdSimulationSettingsProps {
  config: PffdtdSimulationConfig;
  onUpdateConfig: (updates: Partial<PffdtdSimulationConfig>) => void;
}

const cm = (m: number) => `${(m * 100).toFixed(m < 0.1 ? 1 : 0)} cm`;

export function PffdtdSimulationSettings({ config, onUpdateConfig }: PffdtdSimulationSettingsProps) {
  const s = config.settings;
  const disabled = config.isRunning;

  const isModified = useIsFieldModified();
  const isSettingModified = (field: keyof PffdtdSettings) => isModified(`settings.${field}`);

  const handleSettingChange = <K extends keyof PffdtdSettings>(field: K, value: PffdtdSettings[K]) => {
    onUpdateConfig({ settings: { ...s, [field]: value } });
  };

  const h = pffdtdGridSpacing(s.fmax, s.ppw);
  const clearance = pffdtdSeedClearance(s.fmax, s.ppw);
  // Directional sources: the solver runs reciprocally (one run per listener, x4 in FOA)
  // and composes a first-order pattern per octave band; no SPL map / animation then.
  const { directionalCount, listenerCount, runs } = useDirectionalSources();
  const directionalRuns = runs(s.simulation_mode);

  return (
    <div className="card-stack">
      {directionalCount > 0 && (
        <Notice
          type={directionalRuns > PFFDTD.DIRECTIONAL_MAX_RUNS ? 'error' : 'info'}
          message={
            `${directionalCount} directional source${directionalCount === 1 ? '' : 's'}: ${directionalRuns} GPU run${directionalRuns === 1 ? '' : 's'} ` +
            `(one per listener${s.simulation_mode === PYROOMACOUSTICS_SIMULATION_MODE_FOA ? ', ×4 for FOA' : ''}, ${listenerCount} listener${listenerCount === 1 ? '' : 's'}); ` +
            `first-order pattern per octave band; no SPL map or wave animation.` +
            (directionalRuns > PFFDTD.DIRECTIONAL_MAX_RUNS ? ` Limit is ${PFFDTD.DIRECTIONAL_MAX_RUNS} runs.` : '')
          }
        />
      )}
      <div>
        <label className="text-xxs card-label text-secondary-hover">
          Simulation Mode{isSettingModified('simulation_mode') && <ModifiedMark />}
        </label>
        <CardSelect
          value={s.simulation_mode}
          onChange={(v) => handleSettingChange('simulation_mode', v)}
          disabled={disabled}
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

      {/* Grid: max frequency × points per wavelength → spacing h */}
      <div className="card-stack--tight">
        <RangeSlider
          label="Max frequency"
          unit="Hz"
          modified={isSettingModified('fmax')}
          value={s.fmax}
          min={PFFDTD.FMAX_MIN}
          max={PFFDTD.FMAX_MAX}
          step={PFFDTD.FMAX_STEP}
          onChange={(v) => handleSettingChange('fmax', v)}
          disabled={disabled}
          defaultValue={PFFDTD.DEFAULT_FMAX}
        />
        <RangeSlider
          label="Points per wavelength"
          modified={isSettingModified('ppw')}
          value={s.ppw}
          min={PFFDTD.PPW_MIN}
          max={PFFDTD.PPW_MAX}
          step={1}
          onChange={(v) => handleSettingChange('ppw', v)}
          disabled={disabled}
          defaultValue={PFFDTD.DEFAULT_PPW}
          markers={[{ value: PFFDTD.PHASE_ACCURATE_PPW, label: 'accurate', tone: 'primary' }]}
          sliderTitle={`≥ ${PFFDTD.PHASE_ACCURATE_PPW} PPW keeps the grid's phase error negligible at the max frequency`}
        />
        <span className="text-xxs text-secondary-hover">
          grid h ≈ c / (fmax · PPW) = {cm(h)} · clearance {cm(clearance)}
        </span>
      </div>

      <RangeSlider
        label="IR duration"
        unit="s"
        modified={isSettingModified('duration')}
        value={s.duration}
        min={PFFDTD.DURATION_MIN}
        max={PFFDTD.DURATION_MAX}
        step={PFFDTD.DURATION_STEP}
        onChange={(v) => handleSettingChange('duration', v)}
        disabled={disabled}
        defaultValue={PFFDTD.DEFAULT_DURATION}
      />

      <ToggleField
        checked={s.air_absorption}
        onChange={(checked) => handleSettingChange('air_absorption', checked)}
        label="Air absorption"
        modified={isSettingModified('air_absorption')}
        disabled={disabled}
      />

      <PffdtdFreePositioningSettings
        settings={s}
        disabled={disabled}
        isSettingModified={isSettingModified}
        onChange={handleSettingChange}
      />

      <AcousticMaterialsSummary modified={isModified('materials')} />

    </div>
  );
}
