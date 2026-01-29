/**
 * ChorasSimulationSettings Component
 * 
 * Settings UI for Choras acoustic simulation.
 * Extracted from ChorasSimulationSection for use in SimulationTab.
 */

'use client';

import { UI_COLORS, CHORAS_IR_LENGTH_MIN, CHORAS_IR_LENGTH_MAX, CHORAS_LC_MIN, CHORAS_LC_MAX } from '@/lib/constants';
import type { ChorasSimulationConfig } from '@/types/acoustics';
import type { ReceiverData, SoundEvent } from '@/types';
import { RangeSlider } from '@/components/ui/RangeSlider';

interface ChorasSimulationSettingsProps {
  config: ChorasSimulationConfig;
  modelFile: File | null;
  speckleData?: { model_id: string; version_id: string; object_id: string; url: string; auth_token?: string } | null;
  receivers: ReceiverData[];
  soundscapeData: SoundEvent[] | null;
  onUpdateConfig: (updates: Partial<ChorasSimulationConfig>) => void;
  onRunSimulation: () => Promise<void>;
  onCancelSimulation: () => void;
}

export function ChorasSimulationSettings({
  config,
  modelFile,
  speckleData = null,
  receivers,
  soundscapeData,
  onUpdateConfig,
  onRunSimulation,
  onCancelSimulation
}: ChorasSimulationSettingsProps) {
  
  // Check if we have valid geometry data (either modelFile or Speckle)
  const hasValidGeometry = !!modelFile || !!(speckleData?.model_id && speckleData?.version_id && speckleData?.object_id);
  
  const handleSettingChange = (field: keyof ChorasSimulationConfig['settings'], value: any) => {
    onUpdateConfig({
      settings: {
        ...config.settings,
        [field]: value
      }
    } as Partial<ChorasSimulationConfig>);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold" style={{ color: UI_COLORS.NEUTRAL_700 }}>
          Simulation Settings
        </h4>
      </div>

      {/* Error Display */}
      {config.error && (
        <div className="px-3 py-2 rounded text-xs" style={{
          backgroundColor: UI_COLORS.ERROR_LIGHT,
          color: UI_COLORS.ERROR,
          borderRadius: '8px'
        }}>
          {config.error}
        </div>
      )}

      {/* Simulation Parameters */}
      <div className="grid flex gap-2">
        {/* Impulse Length */}
        <RangeSlider
          label="IR length (s): "
          value={config.settings.de_ir_length}
          min={CHORAS_IR_LENGTH_MIN}
          max={CHORAS_IR_LENGTH_MAX}
          step={0.1}
          onChange={(value) => handleSettingChange('de_ir_length', value)}
          showLabels={false}
        />
      </div>


      {/* Action Buttons */}
      {!config.isRunning && (
        <button
          onClick={onRunSimulation}
          disabled={!hasValidGeometry || !receivers?.length || !soundscapeData?.length}
          className="w-full py-2 px-4 rounded text-xs font-medium transition-all"
          style={{
            backgroundColor: (!hasValidGeometry || !receivers?.length || !soundscapeData?.length) ? UI_COLORS.NEUTRAL_400 : UI_COLORS.PRIMARY,
            color: 'white',
            cursor: (!hasValidGeometry || !receivers?.length || !soundscapeData?.length) ? 'not-allowed' : 'pointer',
            borderRadius: '8px',
            opacity: (!hasValidGeometry || !receivers?.length || !soundscapeData?.length) ? 0.4 : 1
          }}
          onMouseEnter={(e) => {
            if (hasValidGeometry && receivers?.length && soundscapeData?.length) {
              e.currentTarget.style.backgroundColor = UI_COLORS.NEUTRAL_400;
            }
          }}
          onMouseLeave={(e) => {
            if (hasValidGeometry && receivers?.length && soundscapeData?.length) {
              e.currentTarget.style.backgroundColor = UI_COLORS.PRIMARY;
            }
          }}
        >
          Start Simulation
        </button>
      )}

      {/* Progress Bar with stop button inline - show when running */}
      {config.isRunning && (
        <div className="flex gap-2 items-center">
          <div
            className="flex-1 px-3 py-2 rounded text-xs"
            style={{
              backgroundColor: UI_COLORS.PRIMARY,
              color: 'white',
              borderRadius: '8px',
              backgroundImage: `linear-gradient(to right, ${UI_COLORS.PRIMARY} ${config.progress}%, ${UI_COLORS.NEUTRAL_400} ${config.progress}%)`,
              transition: 'background-image 0.3s ease'
            }}
          >
            <div className="flex justify-between items-center">
              <span className="font-medium">{config.status || 'Calculating...'}</span>
              <span className="font-bold">{config.progress}%</span>
            </div>
          </div>
          
          {/* Stop button */}
          <button
            onClick={onCancelSimulation}
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
    </div>
  );
}
