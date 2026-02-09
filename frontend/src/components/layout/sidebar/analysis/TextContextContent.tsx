'use client';

import type { TextAnalysisConfig } from '@/types/analysis';
import { UI_COLORS, NUM_SOUNDS_MAX, NUM_SOUNDS_MIN } from '@/lib/constants';
import { RangeSlider } from '@/components/ui/RangeSlider';
import { CheckboxField } from '@/components/ui/CheckboxField';

/**
 * TextContextContent Component
 * 
 * UI for text-based analysis configuration (before generation)
 * Uses llm_service.py backend to generate sound ideas
 */
interface TextContextContentProps {
  config: TextAnalysisConfig;
  index: number;
  isAnalyzing: boolean;
  onUpdateConfig: (index: number, updates: Partial<TextAnalysisConfig>) => void;
}

export function TextContextContent({
  config,
  index,
  isAnalyzing,
  onUpdateConfig
}: TextContextContentProps) {
  
  const canAnalyze = config.textInput.trim().length > 0;

  return (
    <div className="space-y-0.5">
      {/* Text input field */}
      <div>
        <label htmlFor={`text-input-${index}`} className="text-xs font-medium block mb-2" style={{ color: UI_COLORS.NEUTRAL_500 }}>
          Text Description
        </label>
        <textarea
          id={`text-input-${index}`}
          value={config.textInput}
          onChange={(e) => onUpdateConfig(index, { textInput: e.target.value })}
          placeholder="e.g., a busy coffee shop with espresso machine and conversations"
          className="w-full h-15 p-2 text-xs rounded"
          style={{
            backgroundColor: UI_COLORS.NEUTRAL_50,
            borderColor: UI_COLORS.NEUTRAL_300,
            borderWidth: '1px',
            borderStyle: 'solid',
            borderRadius: '8px'
          }}
          rows={3}
        />
      </div>


      {/* Number of sounds */}
      <RangeSlider
        label="Number of sounds: "
        value={config.numSounds}
        min={NUM_SOUNDS_MIN}
        max={NUM_SOUNDS_MAX}
        step={1}
        onChange={(value) => onUpdateConfig(index, { numSounds: value })}
      />

      {/* Use model as context checkbox */}
      <CheckboxField
        checked={config.useModelAsContext}
        onChange={(checked) => onUpdateConfig(index, { useModelAsContext: checked })}
        label="Combine with objects selection"
      />


      {/* Note: Action button is rendered by Card component */}
    </div>
  );
}
