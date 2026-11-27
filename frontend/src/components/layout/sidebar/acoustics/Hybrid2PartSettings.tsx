/**
 * Hybrid2PartSettings — the settings of the part selected on the crossover band of Hybrid
 * simulation 2: the wave solver's (grid, IR length, precision, level match) or the rays' (rays, image
 * sources, air, diffraction, parallel processing and the engine options). No "Additional settings"
 * group: every control shows. The crossover itself is set on the band only.
 *
 * The controls are the ones of the original hybrid card (HybridSimulationSettings), split by part.
 * The parent colours them with the part's colour (`--section-accent`).
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
} from '@/utils/constants';
import { RangeSlider } from '@/components/ui/RangeSlider';
import { ToggleField } from '@/components/ui/ToggleField';
import { gpuMaxMarker } from '@/lib/acoustics/pffdtd-grid';
import { GeometricEngineSettings } from './GeometricEngineSettings';
import { PffdtdPrecisionToggle } from './PffdtdPrecisionToggle';
import type { GeometricEngineSettings as EngineSettings, HybridSettings } from '@/types/acoustics';

type SetField = <K extends keyof HybridSettings>(field: K, value: HybridSettings[K]) => void;

interface PartSettingsProps {
  settings: HybridSettings;
  set: SetField;
  isModified: (field: keyof HybridSettings) => boolean;
  disabled: boolean;
}

/** The wave part's colour (its toggles are tinted with it, CrossoverBand's wave colour). */
const WAVE_COLOR = 'var(--color-material-start)';

interface WavePartSettingsProps extends PartSettingsProps {
  /** Both parts run (the crossover rule and the level match only apply then). */
  joined: boolean;
  waveSpacing: number | null;
  ppwMax: number | null;
  gpuTitle?: string;
  /** Points per wavelength / precision the simulation actually used when they differ from the card's (orange). */
  usedPpw?: number | null;
  usedPrecision?: HybridSettings['precision'] | null;
  usedTitle?: string;
}

export function WavePartSettings({
  settings: s, set, isModified, disabled, joined, waveSpacing, ppwMax, gpuTitle, usedPpw = null, usedPrecision = null, usedTitle,
}: WavePartSettingsProps) {
  const autoDuration = s.duration === null;
  const ppwMarkers = [
    ...gpuMaxMarker(ppwMax, PFFDTD.PPW_MIN, PFFDTD.PPW_MAX),
    ...(usedPpw !== null
      ? [{ value: Math.min(Math.max(usedPpw, PFFDTD.PPW_MIN), PFFDTD.PPW_MAX), label: `used ${Math.round(usedPpw)}`, tone: 'warning' as const }]
      : []),
  ];
  return (
    <div className="card-stack--md">
      <RangeSlider
        label="Points per wavelength"
        modified={isModified('ppw')}
        value={s.ppw}
        min={PFFDTD.PPW_MIN}
        max={PFFDTD.PPW_MAX}
        step={1}
        onChange={(v) => set('ppw', v)}
        disabled={disabled}
        defaultValue={HYBRID.DEFAULT_PPW}
        markers={ppwMarkers}
        sliderTitle={[gpuTitle, usedPpw !== null ? usedTitle : undefined].filter(Boolean).join('\n') || undefined}
      />
      <ToggleField
        checked={autoDuration}
        onChange={(on) => set('duration', on ? null : PFFDTD.DEFAULT_DURATION)}
        label="Length from the room's decay"
        modified={isModified('duration')}
        disabled={disabled}
        color={WAVE_COLOR}
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
      <PffdtdPrecisionToggle
        precision={s.precision}
        gridSpacing={waveSpacing}
        onChange={(v) => set('precision', v)}
        disabled={disabled}
        modified={isModified('precision')}
        asSelect
        accentColor={WAVE_COLOR}
      />
      {usedPrecision !== null && (
        <span className="text-xxs leading-4" style={{ color: 'var(--color-warning)' }} title={usedTitle}>
          The simulation used {usedPrecision} precision.
        </span>
      )}
      {joined && (
        <ToggleField
          checked={s.level_match}
          onChange={(v) => set('level_match', v)}
          label="Match levels at the crossover"
          modified={isModified('level_match')}
          disabled={disabled}
          color={WAVE_COLOR}
        />
      )}
    </div>
  );
}

export function RaysPartSettings({ settings: s, set, isModified, disabled }: PartSettingsProps) {
  return (
    <div className="card-stack--md">
      {s.ray_tracing && (
        <RangeSlider
          label="Rays"
          modified={isModified('n_rays')}
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
      <RangeSlider
        label="Image-Source order"
        modified={isModified('max_order')}
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
        modified={isModified('air_absorption')}
        disabled={disabled}
      />
      <ToggleField
        checked={s.ray_tracing}
        onChange={(v) => set('ray_tracing', v)}
        label="Ray tracing (late reverberation)"
        modified={isModified('ray_tracing')}
        disabled={disabled}
      />
      <GeometricEngineSettings
        settings={s}
        onChange={(field, value) => set(field as keyof HybridSettings, value as HybridSettings[keyof HybridSettings])}
        isModified={(field: keyof EngineSettings) => isModified(field)}
        disabled={disabled}
        lockEngine
        additionalVariant="inline"
        additionalExtraModified={isModified('parallel')}
        additionalExtra={(
          <ToggleField
            checked={s.parallel}
            onChange={(v) => set('parallel', v)}
            label="Parallel processing"
            modified={isModified('parallel')}
            disabled={disabled}
          />
        )}
      />
    </div>
  );
}
