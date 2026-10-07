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
  PYROOMACOUSTICS_MAX_ORDER_MIN,
  PYROOMACOUSTICS_MAX_ORDER_MAX,
  PYROOMACOUSTICS_DEFAULT_MAX_ORDER,
  PYROOMACOUSTICS_RAY_TRACING_RECOMMENDED_MAX_ORDER,
  PYROOMACOUSTICS_RAY_TRACING_N_RAYS,
  PYROOMACOUSTICS_RAY_TRACING_N_RAYS_MIN,
  PYROOMACOUSTICS_RAY_TRACING_N_RAYS_MAX,
  PYROOMACOUSTICS_SIMULATION_MODE_MONO,
  PYROOMACOUSTICS_SIMULATION_MODE_FOA,
  PYROOMACOUSTICS_SIMULATION_MODE_NAMES
} from '@/utils/constants';
import { useMemo } from 'react';
import { useFileUploadStore, useAcousticLayerStore } from '@/store';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import { estimateRayCount } from '@/lib/acoustics/ray-count-estimate';
import { computeSpeckleObjectsBounds } from '@/lib/three/speckle-object-bounds';
import type { PyroomAcousticsSimulationConfig } from '@/types/acoustics';
import { ToggleField } from '@/components/ui/ToggleField';
import { RangeSlider } from '@/components/ui/RangeSlider';
import { CardSelect } from '@/components/ui/CardSelect';
import { AcousticMaterialsSummary } from './AcousticMaterialsSummary';
import { ModifiedMark, useIsFieldModified } from '@/components/ui/ModifiedMark';

const RAYS_STEP = 1000;

interface PyroomAcousticsSimulationSettingsProps {
  config: PyroomAcousticsSimulationConfig;
  onUpdateConfig: (updates: Partial<PyroomAcousticsSimulationConfig>) => void;
}

export function PyroomAcousticsSimulationSettings({
  config,
  onUpdateConfig
}: PyroomAcousticsSimulationSettingsProps) {
  
  // Bounds of the acoustic region (the geometry the simulation actually runs on). Falls back
  // to the whole model — Speckle World box, then the legacy vertex-upload `geometryBounds` —
  // when no region is resolved yet or the region is the whole model.
  const viewer = useSpeckleEngineStore((s) => s.viewer);
  const boundingBoxManager = useSpeckleEngineStore((s) => s.boundingBoxManager);
  const geometryBounds = useFileUploadStore((s) => s.geometryBounds);
  const acousticGeometryIds = useAcousticLayerStore((s) => s.selectedAcousticGeometryIds);
  const isWholeModel = useAcousticLayerStore((s) => s.isWholeModel);
  const acousticBounds = useMemo(
    () => (isWholeModel ? null : computeSpeckleObjectsBounds(viewer, acousticGeometryIds)),
    [viewer, acousticGeometryIds, isWholeModel]
  );
  // World box is read every render (cheap) since it fills asynchronously after load.
  const modelBounds =
    acousticBounds ??
    ((viewer && boundingBoxManager?.calculateBoundsFromSpeckleBatches(viewer)) || geometryBounds);

  // Recommended ray count (Vorländer receiver-sphere criterion — theory and sources in
  // lib/acoustics/ray-count-estimate.ts). Shown as a "rec" tick + the slider's tooltip.
  const rayEstimate = estimateRayCount(modelBounds);
  const rayMarkers = rayEstimate
    ? [{ value: rayEstimate.recommended, label: 'rec', tone: 'primary' as const }]
    : undefined;
  const rayTooltip = rayEstimate
    ? `Recommended ≈ ${rayEstimate.recommended.toLocaleString()} (${Math.round(rayEstimate.volume).toLocaleString()} m³ ${acousticBounds ? 'acoustic layer' : 'model'} bbox)`
    : undefined;

  const isModified = useIsFieldModified();
  const isSettingModified = (field: keyof PyroomAcousticsSimulationConfig['settings']) =>
    isModified(`settings.${field}`);

  const handleSettingChange = (field: keyof PyroomAcousticsSimulationConfig['settings'], value: any) => {
    onUpdateConfig({
      settings: {
        ...config.settings,
        [field]: value
      }
    } as Partial<PyroomAcousticsSimulationConfig>);
  };

  return (
    <div className="card-stack">

      {/* Note: Error display is handled at Card level for consistency */}

      {/* Simulation Mode Dropdown */}
      <div>
        <label className="text-xxs card-label text-secondary-hover">
          Simulation Mode{isSettingModified('simulation_mode') && <ModifiedMark />}
        </label>

        <CardSelect
          value={config.settings.simulation_mode}
          onChange={(v) => handleSettingChange('simulation_mode', v)}
          disabled={config.isRunning}
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

      {/* Image Source Order Slider */}
      <RangeSlider
        label="Image-Source order"
        modified={isSettingModified('max_order')}
        value={config.settings.max_order}
        min={PYROOMACOUSTICS_MAX_ORDER_MIN}
        max={PYROOMACOUSTICS_MAX_ORDER_MAX}
        step={1}
        onChange={(value) => handleSettingChange('max_order', value)}
        disabled={config.isRunning}
        defaultValue={PYROOMACOUSTICS_DEFAULT_MAX_ORDER}
      />

      {/* Toggles + conditional ray-tracing params — a related group */}
      <div className="card-stack--tight">
        <ToggleField
          checked={config.settings.air_absorption}
          onChange={(checked) => handleSettingChange('air_absorption', checked)}
          label="Air absorption"
          modified={isSettingModified('air_absorption')}
          disabled={config.isRunning}
        />
        <ToggleField
          checked={config.settings.ray_tracing}
          onChange={(checked) => handleSettingChange('ray_tracing', checked)}
          label="Ray tracing (hybrid)"
          modified={isSettingModified('ray_tracing')}
          disabled={config.isRunning}
        />
        {config.settings.ray_tracing && (
          <RangeSlider
            label="Rays"
            modified={isSettingModified('n_rays')}
            value={config.settings.n_rays}
            min={PYROOMACOUSTICS_RAY_TRACING_N_RAYS_MIN}
            max={PYROOMACOUSTICS_RAY_TRACING_N_RAYS_MAX}
            step={RAYS_STEP}
            onChange={(value) => handleSettingChange('n_rays', value)}
            disabled={config.isRunning}
            defaultValue={PYROOMACOUSTICS_RAY_TRACING_N_RAYS}
            showLabels={false}
            markers={rayMarkers}
            sliderTitle={rayTooltip}
          />
        )}
      </div>

      <AcousticMaterialsSummary modified={isModified('materials')} />

      {/* Note: Action button, progress bar, and stop button are rendered by Card component */}
    </div>
  );
}
