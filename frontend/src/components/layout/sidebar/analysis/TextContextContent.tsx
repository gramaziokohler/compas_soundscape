'use client';

import type { TextAnalysisConfig } from '@/types/analysis';
import { UI_COLORS, UI_BUTTON } from '@/lib/constants';

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
  onAnalyze: (index: number) => void;
}

export function TextContextContent({
  config,
  index,
  isAnalyzing,
  onUpdateConfig,
  onAnalyze
}: TextContextContentProps) {
  
  const canAnalyze = config.textInput.trim().length > 0;

  return (
    <div className="space-y-3">
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
          className="w-full h-20 p-2 text-sm rounded"
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

      {/* Number of sounds slider */}
      <div>
        <label className="text-xs mb-2 block" style={{ color: UI_COLORS.NEUTRAL_500 }}>
          Number of sounds: <span style={{ color: UI_COLORS.PRIMARY, fontWeight: 'bold' }}>{config.numSounds}</span>
        </label>
        <input
          type="range"
          value={config.numSounds}
          onChange={(e) => onUpdateConfig(index, { numSounds: parseInt(e.target.value) })}
          min="1"
          max="30"
          className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-primary"
          style={{ backgroundColor: UI_COLORS.NEUTRAL_200 }}
        />
        <div className="flex justify-between text-xs mt-1" style={{ color: UI_COLORS.NEUTRAL_500 }}>
          <span>1</span>
          <span>30</span>
        </div>
      </div>

      {/* Use model as context checkbox */}
      <label className="flex items-center gap-2 px-2 py-1 cursor-pointer">
        <input
          type="checkbox"
          checked={config.useModelAsContext}
          onChange={(e) => onUpdateConfig(index, { useModelAsContext: e.target.checked })}
          className="w-4 h-4 rounded focus:ring-2 accent-primary"
        />
        <span className="text-xs" style={{ color: UI_COLORS.NEUTRAL_700 }}>
          Use model as context for sound generation
        </span>
      </label>

      {/* Generate Sound Ideas button */}
      <button
        onClick={() => onAnalyze(index)}
        disabled={isAnalyzing || !canAnalyze}
        className="w-full text-white transition-colors"
        style={{
          borderRadius: UI_BUTTON.BORDER_RADIUS_MD,
          padding: UI_BUTTON.PADDING_MD,
          fontSize: UI_BUTTON.FONT_SIZE,
          fontWeight: UI_BUTTON.FONT_WEIGHT,
          backgroundColor: isAnalyzing || !canAnalyze ? UI_COLORS.NEUTRAL_400 : UI_COLORS.PRIMARY,
          opacity: isAnalyzing || !canAnalyze ? 0.4 : 1,
          cursor: isAnalyzing || !canAnalyze ? 'not-allowed' : 'pointer'
        }}
        onMouseEnter={(e) => {
          if (!isAnalyzing && canAnalyze) {
            e.currentTarget.style.backgroundColor = UI_COLORS.PRIMARY_HOVER;
          }
        }}
        onMouseLeave={(e) => {
          if (!isAnalyzing && canAnalyze) {
            e.currentTarget.style.backgroundColor = UI_COLORS.PRIMARY;
          }
        }}
      >
        {isAnalyzing ? 'Generating...' : 'Generate Sound Ideas'}
      </button>
    </div>
  );
}
