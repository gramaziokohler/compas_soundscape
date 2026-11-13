/**
 * GeometricEngineSettings — the controls of the geometric (ray) engine that go beyond image
 * sources and rays: edge diffraction, the ambisonic reverb tail, and, collapsed under
 * "Additional settings", the engine itself, ambisonic order, decay slopes, air and seed.
 *
 * Shared by the ray-tracing card and the hybrid (wave + rays) card. What the chosen engine
 * cannot run is disabled with the reason in its tooltip, and anything the run will adjust is
 * listed in a notice, so the card never promises a result the backend will not give.
 */

'use client';

import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useAcousticPathsStore } from '@/store';
import { useUIStore } from '@/store/uiStore';
import { CardSelect } from '@/components/ui/CardSelect';
import { ModifiedMark } from '@/components/ui/ModifiedMark';
import { Notice } from '@/components/ui/Notice';
import { RangeSlider } from '@/components/ui/RangeSlider';
import { ToggleField } from '@/components/ui/ToggleField';
import { GA_ENGINE } from '@/utils/constants';
import {
  effectiveEngineSettings,
  isAmbisonicMode,
  normalizeTail,
  temperatureForSoundSpeed,
  usesCompasAcoustics,
} from '@/lib/acoustics/geometric-engine';
import type { GeometricEngineSettings as EngineSettings } from '@/types/acoustics';

type Settings = EngineSettings & { simulation_mode: string };

interface GeometricEngineSettingsProps {
  settings: Settings;
  onChange: <K extends keyof EngineSettings>(field: K, value: EngineSettings[K]) => void;
  isModified: (field: keyof EngineSettings) => boolean;
  disabled?: boolean;
  /** The hybrid card always runs compas_acoustics: no engine choice. */
  lockEngine?: boolean;
}

const ADDITIONAL_FIELDS: (keyof EngineSettings)[] = [
  'engine', 'n_slopes', 'scattering_split', 'air_temperature', 'air_humidity', 'seed',
];

export function GeometricEngineSettings({
  settings,
  onChange,
  isModified,
  disabled = false,
  lockEngine = false,
}: GeometricEngineSettingsProps) {
  const capabilities = useAcousticPathsStore((s) => s.capabilities);
  const loadCapabilities = useAcousticPathsStore((s) => s.loadCapabilities);
  const globalSoundSpeed = useUIStore((s) => s.globalSoundSpeed);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    void loadCapabilities();
  }, [loadCapabilities]);

  const ca = lockEngine || usesCompasAcoustics(settings, capabilities);
  const ambisonic = isAmbisonicMode(settings.simulation_mode);
  const diffraction = settings.diffraction ?? GA_ENGINE.DIFFRACTION_OFF;
  const tail = normalizeTail(settings.tail) ?? GA_ENGINE.TAIL_DEFAULT;
  const showTail = ambisonic && ca;
  const { changes } = effectiveEngineSettings(settings, lockEngine ? null : capabilities);
  const needsCa = 'Needs the compas_acoustics engine';
  const customAir = settings.air_temperature !== undefined && settings.air_temperature !== null;
  const derivedTemperature = Math.round(temperatureForSoundSpeed(globalSoundSpeed) * 10) / 10;
  const engineOptions = [GA_ENGINE.AUTO, GA_ENGINE.COMPAS_ACOUSTICS, GA_ENGINE.PYROOMACOUSTICS].map((value) => ({
    value,
    label: value === GA_ENGINE.AUTO && capabilities
      ? `${GA_ENGINE.NAMES[value]} (${GA_ENGINE.NAMES[capabilities.default] ?? capabilities.default})`
      : GA_ENGINE.NAMES[value],
    disabled: value !== GA_ENGINE.AUTO && capabilities ? !capabilities.engines[value]?.available : false,
    title: value !== GA_ENGINE.AUTO && capabilities && !capabilities.engines[value]?.available
      ? 'Not installed on the server' : undefined,
  }));
  const tailOptions = Object.keys(GA_ENGINE.TAIL_NAMES).map((value) => ({
    value,
    label: GA_ENGINE.TAIL_NAMES[value],
    title: GA_ENGINE.TAIL_HINTS[value],
  }));

  return (
    <div className="card-stack">
      {/* Edge diffraction */}
      <div>
        <label className="text-xxs card-label text-secondary-hover" title={GA_ENGINE.DIFFRACTION_HINTS[diffraction]}>
          Edge diffraction{isModified('diffraction') && <ModifiedMark />}
        </label>
        <CardSelect
          value={ca ? diffraction : GA_ENGINE.DIFFRACTION_OFF}
          onChange={(v) => onChange('diffraction', v)}
          disabled={disabled || !ca}
          options={Object.keys(GA_ENGINE.DIFFRACTION_NAMES).map((value) => ({
            value,
            label: GA_ENGINE.DIFFRACTION_NAMES[value],
            disabled: value === 'btms' && !ambisonic,
            title: value === 'btms' && !ambisonic
              ? 'BTMS needs an ambisonic output (FOA / HOA)'
              : !ca ? needsCa : GA_ENGINE.DIFFRACTION_HINTS[value],
          }))}
        />
      </div>

      {/* Ambisonic late field (compas_acoustics FDN) */}
      {showTail && (
        <div>
          <label className="text-xxs card-label text-secondary-hover" title={GA_ENGINE.TAIL_HINTS[tail]}>
            Reverb tail{isModified('tail') && <ModifiedMark />}
          </label>
          <CardSelect
            value={tail}
            onChange={(v) => onChange('tail', v)}
            disabled={disabled}
            options={tailOptions}
          />
          <p className="text-xxs text-secondary-hover">{GA_ENGINE.TAIL_HINTS[tail]}</p>
        </div>
      )}

      {changes.map((change) => <Notice key={change} type="warning" message={change} />)}

      <div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center gap-1.5 text-left text-xs text-secondary-hover transition-colors hover:text-foreground"
        >
          {expanded ? <ChevronDown size={11} className="shrink-0" /> : <ChevronRight size={11} className="shrink-0" />}
          <span>Additional settings{ADDITIONAL_FIELDS.some(isModified) && <ModifiedMark />}</span>
        </button>
        {expanded && (
          <div className="card-collapse-body card-stack">
            {!lockEngine && (
              <div>
                <label className="text-xxs card-label text-secondary-hover">
                  Engine{isModified('engine') && <ModifiedMark />}
                </label>
                <CardSelect
                  value={settings.engine ?? GA_ENGINE.AUTO}
                  onChange={(v) => onChange('engine', v)}
                  disabled={disabled}
                  options={engineOptions}
                />
              </div>
            )}


            {ambisonic && ca && (
              <div className="card-stack--tight">
                <RangeSlider
                  label="Decay slopes"
                  modified={isModified('n_slopes')}
                  value={settings.n_slopes ?? 1}
                  min={1}
                  max={GA_ENGINE.N_SLOPES_MAX}
                  step={1}
                  onChange={(v) => onChange('n_slopes', v)}
                  disabled={disabled || tail === 'eyring' || tail === 'sabine'}
                  defaultValue={1}
                  hoverText="2 or more for coupled volumes (a room opening onto another); needs a ray-traced tail"
                />
                <ToggleField
                  checked={settings.scattering_split ?? false}
                  onChange={(v) => onChange('scattering_split', v)}
                  label="Scattered early reflections"
                  modified={isModified('scattering_split')}
                  disabled={disabled}
                />
              </div>
            )}

            <div className="card-stack--tight">
              <ToggleField
                checked={customAir}
                onChange={(on) => onChange('air_temperature', on ? Math.min(Math.max(derivedTemperature, GA_ENGINE.AIR_TEMPERATURE_MIN_C), GA_ENGINE.AIR_TEMPERATURE_MAX_C) : null)}
                label="Custom air temperature"
                badge={customAir ? undefined : `${derivedTemperature} °C from sound speed`}
                modified={isModified('air_temperature')}
                disabled={disabled || !ca}
              />
              {customAir && (
                <RangeSlider
                  label="Temperature"
                  unit="°C"
                  value={settings.air_temperature ?? GA_ENGINE.AIR_TEMPERATURE_DEFAULT_C}
                  min={GA_ENGINE.AIR_TEMPERATURE_MIN_C}
                  max={GA_ENGINE.AIR_TEMPERATURE_MAX_C}
                  step={0.5}
                  onChange={(v) => onChange('air_temperature', v)}
                  disabled={disabled || !ca}
                  defaultValue={GA_ENGINE.AIR_TEMPERATURE_DEFAULT_C}
                />
              )}
              <RangeSlider
                label="Relative humidity"
                unit="%"
                modified={isModified('air_humidity')}
                value={settings.air_humidity ?? GA_ENGINE.AIR_HUMIDITY_DEFAULT}
                min={0}
                max={100}
                step={1}
                onChange={(v) => onChange('air_humidity', v)}
                disabled={disabled || !ca}
                defaultValue={GA_ENGINE.AIR_HUMIDITY_DEFAULT}
                hoverText="Sets the air absorption (ISO 9613-1) together with the temperature"
              />
            </div>

            <RangeSlider
              label="Seed"
              modified={isModified('seed')}
              value={settings.seed ?? GA_ENGINE.SEED_DEFAULT}
              min={0}
              max={GA_ENGINE.SEED_MAX}
              step={1}
              onChange={(v) => onChange('seed', v)}
              disabled={disabled || !ca}
              defaultValue={GA_ENGINE.SEED_DEFAULT}
              hoverText="Same seed, same result. Change it to see how much the ray tracing varies."
            />
          </div>
        )}
      </div>
    </div>
  );
}
