/**
 * ChorasSimulationSection Component
 * 
 * Precise acoustic simulation using Choras diffusion equation solver.
 * 
 * Features:
 * - Simulation parameter controls (IR length, characteristic length)
 * - Progress tracking with real-time status updates
 * - Cancel capability for running simulations
 * - Uses loaded 3D model geometry and assigned materials
 */

import { useChorasSimulation } from '@/hooks/useChorasSimulation';
import { useErrorNotification } from '@/contexts/ErrorContext';
import { UI_COLORS } from '@/lib/constants';
import {
  CHORAS_IR_LENGTH_MIN,
  CHORAS_IR_LENGTH_MAX,
  CHORAS_LC_MIN,
  CHORAS_LC_MAX
} from '@/lib/constants';
import type { CompasGeometry, ReceiverData, SoundEvent } from '@/types';

interface ChorasSimulationSectionProps {
  geometryData: CompasGeometry | null;
  modelFile: File | null;
  receivers: ReceiverData[];
  soundscapeData: SoundEvent[] | null;
  onIRImported?: () => void;
}

export function ChorasSimulationSection({
  geometryData,
  modelFile,
  receivers,
  soundscapeData,
  onIRImported
}: ChorasSimulationSectionProps) {
  const { state, methods } = useChorasSimulation('choras_simulation', onIRImported);
  const { addError } = useErrorNotification();

  const handleRunSimulation = async () => {
    if (!modelFile) {
      addError('Please load a 3D model first');
      return;
    }

    if (!state.selectedMaterialId) {
      addError('Please select a material');
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

    const simulationName = `Simulation_${Date.now()}`;
    await methods.runSimulation(modelFile, simulationName, receivers, soundscapeData);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold" style={{ color: UI_COLORS.NEUTRAL_700 }}>
          Simulation Settings
        </h4>

        {/* Refresh button - only show when simulation is running or has run */}
        {(state.isRunning || state.currentSimulationId) && (
          <button
            onClick={methods.refreshProgress}
            disabled={!state.currentSimulationRunId}
            className="w-6 h-6 flex items-center justify-center rounded-full transition-colors"
            style={{
              color: state.currentSimulationRunId ? UI_COLORS.PRIMARY : UI_COLORS.NEUTRAL_400,
              cursor: state.currentSimulationRunId ? 'pointer' : 'not-allowed'
            }}
            onMouseEnter={(e) => {
              if (state.currentSimulationRunId) {
                e.currentTarget.style.backgroundColor = UI_COLORS.NEUTRAL_200;
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
            title="Refresh simulation progress"
            aria-label="Refresh simulation progress"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        )}
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

      {/* Simulation Parameters */}
      <div className="grid grid-cols-2 gap-2">
        {/* Impulse Length */}
        <div>
          <label className="text-xs block mb-1" style={{ color: UI_COLORS.NEUTRAL_700 }}>
            Impulse length: {state.simulationSettings.de_ir_length.toFixed(2)}s
          </label>
          <input
            type="range"
            value={state.simulationSettings.de_ir_length}
            onChange={(e) => methods.updateSimulationSettings({ de_ir_length: parseFloat(e.target.value) })}
            className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-primary"
            style={{ backgroundColor: UI_COLORS.NEUTRAL_200 }}
            min={CHORAS_IR_LENGTH_MIN}
            max={CHORAS_IR_LENGTH_MAX}
            step="0.05"
          />
        </div>

        {/* Characteristic Length */}
        <div>
          <label className="text-xs block mb-1" style={{ color: UI_COLORS.NEUTRAL_700 }}>
            Characteristic length: {state.simulationSettings.de_lc.toFixed(1)}m
          </label>
          <input
            type="range"
            value={state.simulationSettings.de_lc}
            onChange={(e) => methods.updateSimulationSettings({ de_lc: parseFloat(e.target.value) })}
            className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-primary"
            style={{ backgroundColor: UI_COLORS.NEUTRAL_200 }}
            min={CHORAS_LC_MIN}
            max={CHORAS_LC_MAX}
            step="0.1"
          />
        </div>
      </div>

      {/* Action Buttons */}
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

      {/* Progress Bar with stop button inline - show when running but results not yet available */}
      {state.isRunning && !state.simulationResults && (
        <div className="flex gap-2 items-center">
          <div
            className="flex-1 px-3 py-2 rounded text-xs"
            style={{
              backgroundColor: UI_COLORS.PRIMARY,
              color: 'white',
              borderRadius: '8px',
              backgroundImage: `linear-gradient(to right, ${UI_COLORS.PRIMARY} ${state.progress}%, ${UI_COLORS.NEUTRAL_400} ${state.progress}%)`,
              transition: 'background-image 0.3s ease'
            }}
          >
            <div className="flex justify-between items-center">
              <span className="font-medium">{state.status || 'Running simulation'}</span>
              <span className="font-bold">{state.progress}%</span>
            </div>
          </div>
          
          {/* Stop button */}
          <button
            onClick={methods.cancelSimulation}
            className="w-8 h-8 rounded text-white font-bold transition-colors flex items-center justify-center flex-shrink-0"
            style={{
              backgroundColor: UI_COLORS.ERROR,
              borderRadius: '8px'
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#dc2626'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = UI_COLORS.ERROR}
            title="Stop simulation"
            aria-label="Stop simulation"
          >
            <span className="text-lg leading-none">■</span>
          </button>
        </div>
      )}

      {/* Status Display - Show when simulation results are available OR when not running with status */}
      {(state.simulationResults || (!state.isRunning && state.status !== 'Idle')) && (
        <div
          className="px-3 py-2 rounded text-xs"
          style={{
            backgroundColor: state.status.startsWith('Error')
              ? UI_COLORS.ERROR_LIGHT
              : state.status.includes('Complete') || state.simulationResults
              ? UI_COLORS.SUCCESS_LIGHT
              : UI_COLORS.NEUTRAL_100,
            color: state.status.startsWith('Error')
              ? UI_COLORS.ERROR
              : state.status.includes('Complete') || state.simulationResults
              ? UI_COLORS.SUCCESS
              : UI_COLORS.NEUTRAL_800,
            borderRadius: '8px',
            whiteSpace: 'pre-line'
          }}
        >
          {state.simulationResults || state.status}
        </div>
      )}
    </div>
  );
}
