/**
 * HybridSimulationSettings Component
 *
 * Settings UI of the hybrid simulation card: a wave solver (PFFDTD) below a crossover
 * frequency and geometric acoustics (compas_acoustics: image sources, rays, diffraction) above.
 *
 * The crossover defaults to the room's Schroeder frequency, 2000·√(T60 / V): below it the room
 * answers with separate modes that only a wave solver models; above it rays are valid and far
 * cheaper. The card shows what the last run used (decay time, volume, crossover, wave band) and
 * flags a join whose two parts disagree in level.
 *
 * Note: Action button, progress bar, and stop button are handled at the Card level.
 */

'use client';

import {
  HYBRID,
  PFFDTD,
  PYROOMACOUSTICS_DEFAULT_MAX_ORDER,
  PYROOMACOUSTICS_MAX_ORDER_MAX,
  PYROOMACOUSTICS_MAX_ORDER_MIN,
  PYROOMACOUSTICS_RAY_TRACING_N_RAYS,
  PYROOMACOUSTICS_RAY_TRACING_N_RAYS_MAX,
  PYROOMACOUSTICS_RAY_TRACING_N_RAYS_MIN,
  PYROOMACOUSTICS_SIMULATION_MODE_FOA,
  PYROOMACOUSTICS_SIMULATION_MODE_MONO,
  PYROOMACOUSTICS_SIMULATION_MODE_NAMES,
} from '@/utils/constants';
import { useMemo } from 'react';
import { useAcousticMaterialStore } from '@/store';
import { useAcousticRegionBounds } from '@/hooks/useAcousticRegionBounds';
import { CardSelect } from '@/components/ui/CardSelect';
import { ModifiedMark, useIsFieldModified } from '@/components/ui/ModifiedMark';
import { Notice } from '@/components/ui/Notice';
import { RangeSlider } from '@/components/ui/RangeSlider';
import { TextSelect } from '@/components/ui/TextSelect';
import { ToggleField } from '@/components/ui/ToggleField';
import { AcousticMaterialsSummary } from './AcousticMaterialsSummary';
import { GeometricEngineSettings } from './GeometricEngineSettings';
import {
  crossoverReadout,
  estimateSchroederEyring,
  hybridRunSummary,
  lowFrequencyMeanAbsorption,
  mismatchWarning,
} from '@/lib/acoustics/hybrid';
import type { GeometricEngineSettings as EngineSettings, HybridSettings, HybridSimulationConfig } from '@/types/acoustics';

interface HybridSimulationSettingsProps {
  config: HybridSimulationConfig;
  onUpdateConfig: (updates: Partial<HybridSimulationConfig>) => void;
}

const CROSSOVER_MODES = [
  { value: 'schroeder', label: 'Schroeder frequency', title: 'From the room: 2000·√(T60 / V), measured when the simulation runs' },
  { value: 'manual', label: 'Manual', title: 'A crossover frequency you choose' },
];

export function HybridSimulationSettings({ config, onUpdateConfig }: HybridSimulationSettingsProps) {
  const s = config.settings;
  const disabled = config.isRunning;
  const isModified = useIsFieldModified();
  const isSettingModified = (field: keyof HybridSettings) => isModified(`settings.${field}`);
  const set = <K extends keyof HybridSettings>(field: K, value: HybridSettings[K]) =>
    onUpdateConfig({ settings: { ...s, [field]: value } });

  const info = config.hybridInfo ?? null;
  const mismatch = mismatchWarning(info);
  const autoDuration = s.duration === null;

  // Eyring estimate of the Schroeder frequency until a run has measured the room.
  const { bounds, isAcousticLayer } = useAcousticRegionBounds();
  const materialAssignments = useAcousticMaterialStore((st) => st.materialAssignments);
  const availableMaterials = useAcousticMaterialStore((st) => st.availableMaterials);
  const meanAbsorption = useMemo(
    () => lowFrequencyMeanAbsorption(materialAssignments.values(), availableMaterials),
    [materialAssignments, availableMaterials]
  );
  const estimate = useMemo(() => estimateSchroederEyring(bounds, meanAbsorption), [bounds, meanAbsorption]);
  const recommendedHz = info?.schroeder_hz ?? estimate?.schroederHz ?? null;
  const recommendedTitle = info?.schroeder_hz != null
    ? `Recommended: the last run's Schroeder frequency, ${Math.round(info.schroeder_hz)} Hz`
    : estimate
      ? `Recommended ≈ ${Math.round(estimate.schroederHz)} Hz: Schroeder frequency by Eyring (T60 ≈ ${estimate.rt60.toFixed(2)} s, `
        + `${Math.round(estimate.volume).toLocaleString()} m³ ${isAcousticLayer ? 'acoustic layer' : 'model'} box, ᾱ ≈ ${meanAbsorption.toFixed(2)})`
      : undefined;

  return (
    <div className="card-stack">
      <div>
        <label className="text-xxs card-label text-secondary-hover">
          Simulation Mode{isSettingModified('simulation_mode') && <ModifiedMark />}
        </label>
        <CardSelect
          value={s.simulation_mode}
          onChange={(v) => set('simulation_mode', v)}
          disabled={disabled}
          options={[PYROOMACOUSTICS_SIMULATION_MODE_MONO, PYROOMACOUSTICS_SIMULATION_MODE_FOA].map((value) => ({
            value,
            label: PYROOMACOUSTICS_SIMULATION_MODE_NAMES[value as keyof typeof PYROOMACOUSTICS_SIMULATION_MODE_NAMES],
          }))}
        />
      </div>

      {/* ── Crossover ─────────────────────────────────────────────────────── */}
      <div className="card-stack--md">
        <div>
          <label className="text-xxs card-label text-secondary-hover">
            Crossover{isSettingModified('crossover_mode') && <ModifiedMark />}
          </label>
          <TextSelect
            compact
            value={s.crossover_mode}
            onChange={(v) => set('crossover_mode', v as HybridSettings['crossover_mode'])}
            options={CROSSOVER_MODES}
            disabled={disabled}
          />
        </div>
        {s.crossover_mode === 'schroeder' ? (
          <RangeSlider
            label="× Schroeder frequency"
            modified={isSettingModified('crossover_factor')}
            value={s.crossover_factor}
            min={HYBRID.CROSSOVER_FACTOR_MIN}
            max={HYBRID.CROSSOVER_FACTOR_MAX}
            step={HYBRID.CROSSOVER_FACTOR_STEP}
            onChange={(v) => set('crossover_factor', v)}
            disabled={disabled}
            defaultValue={HYBRID.CROSSOVER_FACTOR_DEFAULT}
            markers={[{ value: 1, label: 'rec', tone: 'primary' }]}
            hoverText="1 = the Schroeder frequency. Up to 4 puts the join where the room's modes overlap strongly, at the cost of a longer wave run."
          />
        ) : (
          <RangeSlider
            label="Crossover frequency"
            unit="Hz"
            modified={isSettingModified('crossover_hz')}
            value={s.crossover_hz}
            min={HYBRID.CROSSOVER_HZ_MIN}
            max={HYBRID.CROSSOVER_HZ_MAX}
            step={HYBRID.CROSSOVER_HZ_STEP}
            onChange={(v) => set('crossover_hz', v)}
            disabled={disabled}
            defaultValue={HYBRID.CROSSOVER_HZ_DEFAULT}
            markers={recommendedHz !== null ? [{ value: recommendedHz, label: 'rec', tone: 'primary' }] : undefined}
            sliderTitle={recommendedTitle}
          />
        )}
        <p className="text-xxs text-secondary-hover">{crossoverReadout(s, info, estimate?.schroederHz ?? null)}</p>
        {info && <p className="text-xxs text-secondary-hover">{hybridRunSummary(info)}</p>}
        {info?.notes.map((note) => <Notice key={note} type="info" message={note} />)}
        {mismatch && <Notice type="warning" message={mismatch} />}
        <ToggleField
          checked={s.level_match}
          onChange={(v) => set('level_match', v)}
          label="Match levels at the crossover"
          modified={isSettingModified('level_match')}
          disabled={disabled}
        />
      </div>

      {/* ── Wave part ─────────────────────────────────────────────────────── */}
      <div
        className="card-stack--tight"
        title={`The wave solver runs to ${HYBRID.WAVE_FMAX_MARGIN}× the crossover. Cost grows with the 4th power of the frequency.`}
      >
        <span className="text-xxs text-secondary-hover">Wave part (below the crossover)</span>
        <RangeSlider
          label="Points per wavelength"
          modified={isSettingModified('ppw')}
          value={s.ppw}
          min={PFFDTD.PPW_MIN}
          max={PFFDTD.PPW_MAX}
          step={1}
          onChange={(v) => set('ppw', v)}
          disabled={disabled}
          defaultValue={HYBRID.DEFAULT_PPW}
        />
        <ToggleField
          checked={autoDuration}
          onChange={(on) => set('duration', on ? null : PFFDTD.DEFAULT_DURATION)}
          label="Length from the room's decay"
          modified={isSettingModified('duration')}
          disabled={disabled}
        />
        {!autoDuration && (
          <RangeSlider
            label="Wave IR length"
            unit="s"
            value={s.duration ?? PFFDTD.DEFAULT_DURATION}
            min={PFFDTD.DURATION_MIN}
            max={PFFDTD.DURATION_MAX}
            step={PFFDTD.DURATION_STEP}
            onChange={(v) => set('duration', v)}
            disabled={disabled}
            defaultValue={PFFDTD.DEFAULT_DURATION}
          />
        )}
      </div>

      {/* ── Geometric part ────────────────────────────────────────────────── */}
      <div className="card-stack--tight">
        <span className="text-xxs text-secondary-hover">Geometric part (above the crossover)</span>
        <RangeSlider
          label="Image-Source order"
          modified={isSettingModified('max_order')}
          value={s.max_order}
          min={PYROOMACOUSTICS_MAX_ORDER_MIN}
          max={PYROOMACOUSTICS_MAX_ORDER_MAX}
          step={1}
          onChange={(v) => set('max_order', v)}
          disabled={disabled}
          defaultValue={PYROOMACOUSTICS_DEFAULT_MAX_ORDER}
        />
        <ToggleField
          checked={s.air_absorption}
          onChange={(v) => set('air_absorption', v)}
          label="Air absorption"
          modified={isSettingModified('air_absorption')}
          disabled={disabled}
        />
        <ToggleField
          checked={s.ray_tracing}
          onChange={(v) => set('ray_tracing', v)}
          label="Ray tracing"
          modified={isSettingModified('ray_tracing')}
          disabled={disabled}
        />
        {s.ray_tracing && (
          <RangeSlider
            label="Rays"
            modified={isSettingModified('n_rays')}
            value={s.n_rays}
            min={PYROOMACOUSTICS_RAY_TRACING_N_RAYS_MIN}
            max={Math.max(PYROOMACOUSTICS_RAY_TRACING_N_RAYS_MAX, s.n_rays)}
            step={1000}
            onChange={(v) => set('n_rays', v)}
            disabled={disabled}
            defaultValue={PYROOMACOUSTICS_RAY_TRACING_N_RAYS}
            showLabels
          />
        )}
        <ToggleField
          checked={s.parallel}
          onChange={(v) => set('parallel', v)}
          label="Parallel processing"
          modified={isSettingModified('parallel')}
          disabled={disabled}
        />
      </div>

      <GeometricEngineSettings
        settings={s}
        onChange={(field, value) => set(field as keyof HybridSettings, value as HybridSettings[keyof HybridSettings])}
        isModified={(field: keyof EngineSettings) => isSettingModified(field)}
        disabled={disabled}
        lockEngine
      />

      <AcousticMaterialsSummary modified={isModified('materials')} />
    </div>
  );
}
