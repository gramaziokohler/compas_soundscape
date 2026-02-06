/**
 * ChorasSimulationSettings Component
 * 
 * Settings UI for Choras acoustic simulation.
 * Extracted from ChorasSimulationSection for use in SimulationTab.
 * 
 * Note: Action button, progress bar, and stop button are handled at the Card level.
 */

'use client';

import { UI_COLORS, CHORAS_IR_LENGTH_MIN, CHORAS_IR_LENGTH_MAX, CHORAS_LC_MIN, CHORAS_LC_MAX } from '@/lib/constants';
import type { ChorasSimulationConfig } from '@/types/acoustics';
import { RangeSlider } from '@/components/ui/RangeSlider';

interface ChorasSimulationSettingsProps {
  config: ChorasSimulationConfig;
  onUpdateConfig: (updates: Partial<ChorasSimulationConfig>) => void;
}

export function ChorasSimulationSettings({
  config,
  onUpdateConfig
}: ChorasSimulationSettingsProps) {
  
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

      {/* Note: Error display is handled at Card level for consistency */}

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
          disabled={config.isRunning}
        />
      </div>

      {/* Note: Action button, progress bar, and stop button are rendered by Card component */}
    </div>
  );
}
