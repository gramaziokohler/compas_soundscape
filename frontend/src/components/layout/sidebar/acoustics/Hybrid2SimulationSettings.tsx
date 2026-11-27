/**
 * Hybrid2SimulationSettings — the Setup step of "Hybrid simulation 2".
 *
 * Simulation mode (Mono / FOA), the assigned materials as coloured chips (AcousticMaterialChips),
 * the GPU memory warning of the wave grid (it blocks the run), then "Simulation settings": the part
 * checkboxes and the crossover band (CrossoverBand) with the recommended crossover and the GPU limit
 * drawn as vertical lines, plus an orange "used" line (crossover, points per wavelength) when the
 * running or last simulation had to fit the wave part (lib/acoustics/hybrid-wave-fit.ts). Clicking a
 * part shows its settings below (Hybrid2PartSettings), coloured
 * with the part's colour; switching a part off runs the other alone (`settings.parts`).
 *
 * The settings stay editable while the card runs: the card then offers to re-run with them
 * (AcousticsSection). Same run, results and recovery as the original hybrid card
 * (HybridSimulationSettings, kept as is). The geometry check is the next step (Hybrid2Steps).
 */

'use client';

import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { getScrollParent } from '@/utils/scrollIntoContainer';
import {
  PYROOMACOUSTICS_SIMULATION_MODE_FOA,
  PYROOMACOUSTICS_SIMULATION_MODE_MONO,
  PYROOMACOUSTICS_SIMULATION_MODE_NAMES,
} from '@/utils/constants';
import { useAcousticRegionBounds } from '@/hooks/useAcousticRegionBounds';
import { useHybridRoomEstimate } from '@/hooks/useHybridRoomEstimate';
import { usePffdtdGpuLimit } from '@/hooks/usePffdtdGpuLimit';
import { CardSelect } from '@/components/ui/CardSelect';
import { ModifiedMark, useIsFieldModified } from '@/components/ui/ModifiedMark';
import { Notice } from '@/components/ui/Notice';
import { pffdtdGridSpacing } from '@/lib/acoustics/pffdtd-grid';
import {
  hybridParts,
  lastRunSchroederHz,
  mismatchWarning,
} from '@/lib/acoustics/hybrid';
import { bandGpuMaxHz, formatHz, hybridWaveBand, hybridWaveGpuWarning, notePart } from '@/lib/acoustics/crossover-band';
import { cardWaveAdjustment, usedWaveValues } from '@/lib/acoustics/hybrid-wave-fit';
import { AcousticMaterialChips } from './AcousticMaterialChips';
import { CrossoverBand, type HybridPart } from './CrossoverBand';
import { FrequencyText } from './FrequencyText';
import { RaysPartSettings, WavePartSettings } from './Hybrid2PartSettings';
import type { HybridParts, HybridSettings, HybridSimulationConfig } from '@/types/acoustics';

interface Hybrid2SimulationSettingsProps {
  config: HybridSimulationConfig;
  onUpdateConfig: (updates: Partial<HybridSimulationConfig>) => void;
}

const OUTPUT_OPTIONS = [PYROOMACOUSTICS_SIMULATION_MODE_MONO, PYROOMACOUSTICS_SIMULATION_MODE_FOA].map((value) => ({
  value,
  label: PYROOMACOUSTICS_SIMULATION_MODE_NAMES[value as keyof typeof PYROOMACOUSTICS_SIMULATION_MODE_NAMES],
}));

const PART_COLOR: Record<HybridPart, string> = {
  wave: 'var(--color-material-start)',
  rays: 'var(--color-primary)',
};

export function Hybrid2SimulationSettings({ config, onUpdateConfig }: Hybrid2SimulationSettingsProps) {
  const s = config.settings;
  const disabled = false;
  const parts = hybridParts(s);
  const joined = parts === 'both';
  const isModified = useIsFieldModified();
  const isSettingModified = (field: keyof HybridSettings) => isModified(`settings.${field}`);
  const set = <K extends keyof HybridSettings>(field: K, value: HybridSettings[K]) =>
    onUpdateConfig({ settings: { ...s, [field]: value } });

  const [selectedPart, setSelectedPart] = useState<HybridPart>(parts === 'rays' ? 'rays' : 'wave');
  const selected: HybridPart = parts === 'both' ? selectedPart : parts;

  // Switching parts swaps the settings below the band, which changes the card's height: keep the
  // sidebar where it was (no scroll anchoring, and the scroll offset restored before paint).
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollKeep = useRef<{ el: HTMLElement; top: number } | null>(null);
  const selectPart = (part: HybridPart) => {
    const el = getScrollParent(rootRef.current);
    scrollKeep.current = el ? { el, top: el.scrollTop } : null;
    setSelectedPart(part);
  };
  useLayoutEffect(() => {
    const keep = scrollKeep.current;
    if (keep) keep.el.scrollTop = keep.top;
    scrollKeep.current = null;
  }, [selected]);

  // Recommended crossover: the last run's measured Schroeder frequency, else the Eyring estimate.
  const info = config.hybridInfo ?? null;
  const { estimate, isAcousticLayer, meanAbsorption } = useHybridRoomEstimate();
  const lastRunHz = lastRunSchroederHz(info);
  const recommendedHz = lastRunHz ?? estimate?.schroederHz ?? null;
  const { crossoverHz, waveFmax } = hybridWaveBand(s, recommendedHz);
  const waveSpacing = waveFmax !== null ? pffdtdGridSpacing(waveFmax, s.ppw) : null;

  // GPU: the band's red line and the grid's memory check (the notice at the top; it blocks the run)
  const { maxProduct, memory } = usePffdtdGpuLimit(s.precision);
  const { bounds } = useAcousticRegionBounds();
  const extents = bounds ? [0, 1, 2].map((i) => bounds.max[i] - bounds.min[i]) as [number, number, number] : null;
  const gpuWarning = hybridWaveGpuWarning(s, recommendedHz, extents, memory?.available_bytes ?? null);
  const gpuMaxHz = bandGpuMaxHz(maxProduct, s.ppw, parts);
  const ppwMax = maxProduct !== null && waveFmax !== null ? maxProduct / waveFmax : null;
  const gpuTitle = maxProduct === null ? undefined
    : `GPU max: past this line the wave grid (${s.precision} precision, ${s.ppw} points per wavelength) no longer fits the GPU memory free now`;
  // What the (running or last) simulation actually used when the job had to fit the wave part: orange lines
  const used = usedWaveValues(cardWaveAdjustment(config), crossoverHz, s);
  const usedTitle = used
    ? `Used by the ${config.isRunning ? 'running' : 'last'} simulation (${used.option.key} option): `
      + `${formatHz(used.option.crossover_hz)}, ${Math.round(used.option.run_ppw)} points per wavelength, `
      + `${used.option.precision} precision. ${used.option.label}.`
    : undefined;
  const recommendedTitle = lastRunHz !== null
    ? `Recommended: the last run's Schroeder frequency, ${Math.round(lastRunHz)} Hz`
    : estimate
      ? `Recommended ≈ ${Math.round(estimate.schroederHz)} Hz: Schroeder frequency by Eyring (T60 ≈ ${estimate.rt60.toFixed(2)} s, `
        + `${Math.round(estimate.volume).toLocaleString()} m³ ${isAcousticLayer ? 'acoustic layer' : 'model'} box, ᾱ ≈ ${meanAbsorption.toFixed(2)})`
      : undefined;

  // Dragging onto the recommended line goes back to following the room (Schroeder × 1); anywhere else is a manual frequency.
  const setCrossover = (hz: number) => {
    if (recommendedHz !== null && hz === recommendedHz) {
      onUpdateConfig({ settings: { ...s, crossover_mode: 'schroeder', crossover_factor: 1 } });
    } else {
      onUpdateConfig({ settings: { ...s, crossover_mode: 'manual', crossover_hz: hz } });
    }
  };
  const setParts = (next: HybridParts) => {
    const { parts: _previous, ...rest } = s;
    onUpdateConfig({ settings: next === 'both' ? rest : { ...rest, parts: next } });
  };

  const mismatch = joined ? mismatchWarning(info) : null;
  const readout = parts === 'rays'
    ? 'Rays over the full band: image sources, ray tracing and diffraction, no wave solver.'
    : parts === 'wave'
      ? `Wave solver alone up to ${formatHz(crossoverHz)}: nothing above it is simulated.`
      : `Crossover frequency: ${formatHz(crossoverHz)}${waveFmax !== null ? ` (solved up to ${formatHz(waveFmax)})` : ''}.`;

  return (
    <div ref={rootRef} className="card-stack">
      <div>
        <label className="text-xxs card-label text-secondary-hover">
          Simulation Mode{isSettingModified('simulation_mode') && <ModifiedMark />}
        </label>
        <CardSelect value={s.simulation_mode} onChange={(v) => set('simulation_mode', v)} options={OUTPUT_OPTIONS} />
      </div>

      <AcousticMaterialChips modified={isModified('materials')} />

      {gpuWarning && <Notice type="error" message={gpuWarning} />}

      <div className="card-stack--md">
        <span className="text-xxs text-secondary-hover">
          Simulation settings{(isSettingModified('parts') || isSettingModified('crossover_hz')) && <ModifiedMark />}
        </span>
        <CrossoverBand
          crossoverHz={crossoverHz}
          parts={parts}
          selected={selected}
          recommendedHz={recommendedHz}
          recommendedTitle={recommendedTitle}
          gpuMaxHz={gpuMaxHz}
          gpuTitle={gpuTitle}
          usedHz={used?.crossoverHz ?? null}
          usedTitle={usedTitle}
          disabled={disabled}
          onCrossoverChange={setCrossover}
          onSelect={selectPart}
          onPartsChange={setParts}
        />
        <FrequencyText text={readout} className="text-xxs text-secondary-hover" />
        {info?.notes.map((note) => {
          // a note about one part takes that part's colour; one about the crossover stays neutral
          const part = notePart(note);
          if (!part) return <Notice key={note} type="info" message={note} />;
          return (
            <FrequencyText
              key={note}
              text={note}
              className="border-l-2 px-2 py-1 text-xxs leading-4"
              style={{
                borderColor: PART_COLOR[part],
                backgroundColor: `color-mix(in srgb, ${PART_COLOR[part]} 12%, transparent)`,
              }}
            />
          );
        })}
        {mismatch && <Notice type="warning" message={mismatch} />}
      </div>

      <div
        className="card-stack--md border-l-2 pl-2"
        style={{ borderColor: PART_COLOR[selected], overflowAnchor: 'none', '--section-accent': PART_COLOR[selected] } as CSSProperties}
      >
        <span className="text-xxs" style={{ color: selected === 'wave' ? PART_COLOR.wave : 'var(--color-blue-text)' }}>
          {selected === 'wave' ? 'Wave-based part' : 'Ray-tracing part'}
        </span>
        {selected === 'wave' ? (
          <WavePartSettings
            settings={s}
            set={set}
            isModified={isSettingModified}
            disabled={disabled}
            joined={joined}
            waveSpacing={waveSpacing}
            ppwMax={ppwMax}
            gpuTitle={gpuTitle}
            usedPpw={used?.ppw ?? null}
            usedPrecision={used?.precision ?? null}
            usedTitle={usedTitle}
          />
        ) : (
          <RaysPartSettings settings={s} set={set} isModified={isSettingModified} disabled={disabled} />
        )}
      </div>
    </div>
  );
}
