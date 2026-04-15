'use client';

import type { TextAnalysisConfig } from '@/types/analysis';
import { UI_COLORS, NUM_SOUNDS_MAX, NUM_SOUNDS_MIN } from '@/utils/constants';
import { RangeSlider } from '@/components/ui/RangeSlider';
import { CheckboxField } from '@/components/ui/CheckboxField';
import { useAreaDrawing } from '@/hooks/useAreaDrawing';
import { pauseStore, commitStore, globalUndo, globalRedo } from '@/store';
import { useBatchedSlider } from '@/hooks/useBatchedSlider';

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
  const { isDrawingThisCard, hasArea, removeArea } = useAreaDrawing(index);

  const canAnalyze = config.textInput.trim().length > 0;

  // Batched slider — one undo step per drag gesture
  const numSoundsSlider = useBatchedSlider<number>('analysis', (v) =>
    onUpdateConfig(index, { numSounds: v }),
  );

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
          onFocus={() => pauseStore('analysis')}
          onBlur={() => setTimeout(() => commitStore('analysis'), 0)}
          onKeyDown={(e) => {
            // Intercept Ctrl/Cmd+Z — use our global undo instead of browser's
            // letter-by-letter native undo, so the whole typing session reverts at once.
            if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') {
              e.preventDefault();
              commitStore('analysis'); // flush pending typing as one step
              globalUndo();            // undo that step (reverts to pre-typing state)
              pauseStore('analysis');  // re-enable batching for continued typing
            }
            if ((e.ctrlKey || e.metaKey) && (e.shiftKey ? e.key === 'z' : e.key === 'y')) {
              e.preventDefault();
              commitStore('analysis');
              globalRedo();
              pauseStore('analysis');
            }
          }}
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
        value={config.numSounds ?? NUM_SOUNDS_MIN}
        min={NUM_SOUNDS_MIN}
        max={NUM_SOUNDS_MAX}
        step={1}
        onDragStart={numSoundsSlider.onDragStart}
        onChange={numSoundsSlider.onChange}
        onChangeCommitted={numSoundsSlider.onCommit}
      />

      {/* Use model as context checkbox */}
      <CheckboxField
        checked={config.useModelAsContext}
        onChange={(checked) => {
          // Ensure any pending text-typing undo step is committed first, so the
          // checkbox click becomes its own independent undo entry.
          commitStore('analysis');
          onUpdateConfig(index, { useModelAsContext: checked });
        }}
        label="Combine with objects selection"
      />

      {/* Drawing mode tip */}
      {isDrawingThisCard && (
        <div
          className="text-xs p-2 rounded-md"
          style={{ backgroundColor: 'rgba(16, 185, 129, 0.1)', color: UI_COLORS.SUCCESS }}
        >
          Click on surfaces to draw an area. Double-click to close.
          Right-click to undo last point.
        </div>
      )}

      {/* Area status indicator */}
      {hasArea && !isDrawingThisCard && (
        <div className="flex items-center justify-between text-xs py-1">
          <span style={{ color: UI_COLORS.SUCCESS }}>Area defined</span>
          <button
            onClick={removeArea}
            className="text-secondary-hover hover:text-foreground cursor-pointer text-xs"
            title="Clear drawn area"
          >
            Clear
          </button>
        </div>
      )}

      {/* Note: Action button is rendered by Card component */}
    </div>
  );
}
