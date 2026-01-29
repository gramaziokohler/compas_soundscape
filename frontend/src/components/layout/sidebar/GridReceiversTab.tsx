/**
 * PyroomAcousticsSimulationSettings Component
 * 
 * Settings UI for Pyroomacoustics acoustic simulation.
 * Extracted from PyroomAcousticsSimulationSection for use in SimulationTab.
 */

'use client';

import {
  UI_COLORS,
GRID_RECEIVERS
} from '@/lib/constants';
import type { ReceiverData } from '@/types';
import { CheckboxField } from '@/components/ui/CheckboxField';
import { RangeSlider } from '@/components/ui/RangeSlider';

interface GridReceiversTab {
  config: GridReceiversTab;
  receivers: ReceiverData[];
  onUpdateConfig: (updates: Partial<GridReceiversTab>) => void;
  onAddGridReceiver: (type: string, n: number) => void;
}

export function GridReceiversTab({
  config,
  receivers,
  onUpdateConfig,
  onAddGridReceiver
}: GridReceiversTab) {
  
  // Check if we have valid geometry data (either modelFile or Speckle)
  const hasValidGeometry = true;

// Grid configuration state
  const  gridResolution = 9;
  
  // const handleSettingChange = (field: keyof GridReceiversTab['settings'], value: any) => {
  //   onUpdateConfig({
  //     settings: {
  //       ...config.settings,
  //       [field]: value
  //     }
  //   } as Partial<PyroomAcousticsSimulationConfig>);
  // };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold" style={{ color: UI_COLORS.NEUTRAL_700 }}>
          Receiver grid Settings
        </h4>
      </div>

{/* Grid surface selection dropdown */}

      {/* Grid resolution slider */}
      <div>
        <label className="text-xs block mb-1" style={{ color: UI_COLORS.NEUTRAL_700 }}>
          Grid resolution (m): {gridResolution}
        </label>
        <input
          type="range"
          value={gridResolution}
          // onChange={(e) => handleSettingChange('max_order', parseInt(e.target.value))}
          className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-primary"
          style={{ backgroundColor: UI_COLORS.NEUTRAL_200 }}
          min={GRID_RECEIVERS.MIN_GRID_SPACING}
          max={GRID_RECEIVERS.MAX_GRID_SPACING}
          step="0.05"
        />
      </div>

      {/* Grid resolution slider */}
      <RangeSlider
        label="Grid resolution (m): "
        value={gridResolution}
        min={GRID_RECEIVERS.MIN_GRID_SPACING}
        max={GRID_RECEIVERS.MAX_GRID_SPACING}
        step={1}
        onChange={(value) => onUpdateConfig(index, { gridResolution: value })}
      />


      {/* Toggles
      <div className="flex flex-col">
        <CheckboxField
          checked={config.settings.ray_tracing}
          onChange={(checked) => handleSettingChange('ray_tracing', checked)}
          label="Ray tracing (hybrid)"
          disabled={config.isRunning}
        />
      </div> */}


      {/* Action Button */}
        <button
          onClick={() => onAddGridReceiver('multiple', gridResolution)}
          disabled={!hasValidGeometry}
          className="w-full py-2 px-4 rounded text-xs font-medium transition-all"
          style={{
            backgroundColor: (!hasValidGeometry) ? UI_COLORS.NEUTRAL_400 : UI_COLORS.PRIMARY,
            color: 'white',
            cursor: (!hasValidGeometry) ? 'not-allowed' : 'pointer',
            borderRadius: '8px',
            opacity: (!hasValidGeometry ) ? 0.4 : 1
          }}
          onMouseEnter={(e) => {
            if (hasValidGeometry ) {
              e.currentTarget.style.backgroundColor = UI_COLORS.NEUTRAL_400;
            }
          }}
          onMouseLeave={(e) => {
            if (hasValidGeometry ) {
              e.currentTarget.style.backgroundColor = UI_COLORS.PRIMARY;
            }
          }}
        >
          Create grid
        </button>

    </div>
  );
}
