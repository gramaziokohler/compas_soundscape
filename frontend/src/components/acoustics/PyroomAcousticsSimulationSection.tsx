/**
 * PyroomAcousticsSimulationSection Component
 * 
 * Acoustic simulation using Pyroomacoustics image source method and ray tracing.
 * 
 * Features:
 * - Simulation parameter controls (max_order, ray_tracing, air_absorption)
 * - Real-time feedback during simulation
 * - Uses loaded 3D model geometry and assigned materials
 */

import type { PyroomAcousticsSimulationState, PyroomAcousticsSimulationMethods } from '@/hooks/usePyroomAcousticsSimulation';
import { useErrorNotification } from '@/contexts/ErrorContext';
import { UI_COLORS } from '@/lib/constants';
import {
  PYROOMACOUSTICS_MAX_ORDER_MIN,
  PYROOMACOUSTICS_MAX_ORDER_MAX,
  PYROOMACOUSTICS_RAY_TRACING_RECOMMENDED_MAX_ORDER,
  PYROOMACOUSTICS_RAY_TRACING_N_RAYS_MIN,
  PYROOMACOUSTICS_RAY_TRACING_N_RAYS_MAX,
  PYROOMACOUSTICS_SCATTERING_MIN,
  PYROOMACOUSTICS_SCATTERING_MAX
} from '@/lib/constants';
import type { CompasGeometry, ReceiverData, SoundEvent } from '@/types';
import { CheckboxField } from '@/components/ui/CheckboxField';

interface PyroomAcousticsSimulationSectionProps {
  geometryData: CompasGeometry | null;
  modelFile: File | null;
  receivers: ReceiverData[];
  soundscapeData: SoundEvent[] | null;
  onIRImported?: () => void;
  state: PyroomAcousticsSimulationState;
  methods: PyroomAcousticsSimulationMethods;
}

export function PyroomAcousticsSimulationSection({
  geometryData,
  modelFile,
  receivers,
  soundscapeData,
  onIRImported,
  state,
  methods
}: PyroomAcousticsSimulationSectionProps) {
  const { addError } = useErrorNotification();

  const handleRunSimulation = async () => {
    if (!modelFile) {
      addError('Please load a 3D model first');
      return;
    }

    // Validation: Check for receivers
    if (!receivers || receivers.length === 0) {
      addError('Please place at least one receiver in the scene');
      return;
    }

    // Validation: Check for sound sources
    if (!soundscapeData || soundscapeData.length === 0) {
      addError('Please generate or upload at least one sound source');
      return;
    }

    const simulationName = `PyRoomSim_${Date.now()}`;
    await methods.runSimulation(modelFile, simulationName, receivers, soundscapeData);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold" style={{ color: UI_COLORS.NEUTRAL_700 }}>
          Simulation Settings
        </h4>
      </div>

      {/* Error Display */}
      {state.error && (
        <div className="px-3 py-2 rounded text-xs" style={{
          backgroundColor: UI_COLORS.ERROR_LIGHT,
          color: UI_COLORS.ERROR,
          borderRadius: '8px'
        }}>
          {state.error}
        </div>
      )}

      {/* Max Order Slider */}
      <div>
        <label className="text-xs block mb-1" style={{ color: UI_COLORS.NEUTRAL_700 }}>
          Image-Source order: {state.simulationSettings.max_order}
          {state.simulationSettings.ray_tracing &&
           state.simulationSettings.max_order > PYROOMACOUSTICS_RAY_TRACING_RECOMMENDED_MAX_ORDER && (
            <span style={{ color: UI_COLORS.WARNING, marginLeft: '4px' }}>
              (≤{PYROOMACOUSTICS_RAY_TRACING_RECOMMENDED_MAX_ORDER} recommended for ray tracing)
            </span>
          )}
        </label>
        <input
          type="range"
          value={state.simulationSettings.max_order}
          onChange={(e) => methods.updateSimulationSettings({ max_order: parseInt(e.target.value) })}
          className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-primary"
          style={{ backgroundColor: UI_COLORS.NEUTRAL_200 }}
          min={PYROOMACOUSTICS_MAX_ORDER_MIN}
          max={PYROOMACOUSTICS_MAX_ORDER_MAX}
          step="1"
          disabled={state.isRunning}
        />
      </div>

      {/* Toggles */}
      <div className="flex flex-col">
        <CheckboxField
          checked={state.simulationSettings.ray_tracing}
          onChange={(checked) => methods.updateSimulationSettings({ ray_tracing: checked })}
          label="Ray tracing (hybrid)"
          disabled={state.isRunning}
        />
        <CheckboxField
          checked={state.simulationSettings.air_absorption}
          onChange={(checked) => methods.updateSimulationSettings({ air_absorption: checked })}
          label="Air absorption"
          disabled={state.isRunning}
        />
      </div>

      {/* Ray Tracing Parameters (2-column grid when enabled) */}
      {state.simulationSettings.ray_tracing && (
        <div className="grid grid-cols-2 gap-2">
          {/* Number of Rays */}
          <div>
            <label className="text-xs block mb-1" style={{ color: UI_COLORS.NEUTRAL_700 }}>
              Rays: {(state.simulationSettings.n_rays / 1000).toFixed(0)}k
            </label>
            <input
              type="range"
              value={state.simulationSettings.n_rays}
              onChange={(e) => methods.updateSimulationSettings({ n_rays: parseInt(e.target.value) })}
              className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-primary"
              style={{ backgroundColor: UI_COLORS.NEUTRAL_200 }}
              min={PYROOMACOUSTICS_RAY_TRACING_N_RAYS_MIN}
              max={PYROOMACOUSTICS_RAY_TRACING_N_RAYS_MAX}
              step="1000"
              disabled={state.isRunning}
            />
          </div>

          {/* Scattering */}
          <div>
            <label className="text-xs block mb-1" style={{ color: UI_COLORS.NEUTRAL_700 }}>
              Scattering: {state.simulationSettings.scattering.toFixed(2)}
            </label>
            <input
              type="range"
              value={state.simulationSettings.scattering}
              onChange={(e) => methods.updateSimulationSettings({ scattering: parseFloat(e.target.value) })}
              className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-primary"
              style={{ backgroundColor: UI_COLORS.NEUTRAL_200 }}
              min={PYROOMACOUSTICS_SCATTERING_MIN}
              max={PYROOMACOUSTICS_SCATTERING_MAX}
              step="0.01"
              disabled={state.isRunning}
            />
          </div>
        </div>
      )}

      {/* Action Button */}
      {!state.isRunning && (
        <button
          onClick={handleRunSimulation}
          disabled={!modelFile}
          className="w-full py-2 px-4 rounded text-xs font-medium transition-colors"
          style={{
            backgroundColor: !modelFile ? UI_COLORS.NEUTRAL_400 : UI_COLORS.PRIMARY,
            color: 'white',
            cursor: !modelFile ? 'not-allowed' : 'pointer',
            borderRadius: '8px'
          }}
        >
          Start Simulation
        </button>
      )}

      {/* Running Status */}
      {state.isRunning && (
        <div
          className="px-3 py-2 rounded text-xs text-center"
          style={{
            backgroundColor: UI_COLORS.PRIMARY,
            color: 'white',
            borderRadius: '8px'
          }}
        >
          {state.status}
        </div>
      )}

      {/* Results Display */}
      {state.simulationResults && (
        <div
          className="px-3 py-2 rounded text-xs"
          style={{
            backgroundColor: UI_COLORS.SUCCESS_LIGHT,
            color: UI_COLORS.SUCCESS,
            borderRadius: '8px',
            whiteSpace: 'pre-line'
          }}
        >
          {state.simulationResults}
        </div>
      )}
    </div>
  );
}
