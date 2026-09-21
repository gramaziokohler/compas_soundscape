'use client';

import { useEffect } from 'react';
import type { TextAnalysisConfig, AnalyzeModelConfig } from '@/types/analysis';
import { NUM_SOUNDS_MAX, NUM_SOUNDS_MIN, DEFAULT_NUM_SOUNDS } from '@/utils/constants';
import { RangeSlider } from '@/components/ui/RangeSlider';
import { Notice } from '@/components/ui/Notice';
import { useAreaDrawing } from '@/hooks/useAreaDrawing';
import {
  pauseStore,
  commitStore,
  globalUndo,
  globalRedo,
  useAnalysisStore,
  useAnalysisPreviewStore,
} from '@/store';
import { useBatchedSlider } from '@/hooks/useBatchedSlider';

/**
 * TextContextContent Component
 *
 * Pre-generation UI for a text-based card. The user describes the intended
 * soundscape, then picks one of three sound-placement strategies:
 *   - Random: distribute sounds inside the model bounding box
 *   - Draw area: place sounds inside a polygon drawn in the viewer
 *   - Use 3D model analysis: link prompts to objects from the parent analysis
 */
interface TextContextContentProps {
  config: TextAnalysisConfig;
  index: number;
  isAnalyzing: boolean;
  onUpdateConfig: (index: number, updates: Partial<TextAnalysisConfig>) => void;
}

type PlacementMode = 'random' | 'area' | 'analysis';

export function TextContextContent({
  config,
  index,
  isAnalyzing,
  onUpdateConfig,
}: TextContextContentProps) {
  const {
    isDrawingThisCard,
    hasArea,
    removeArea,
    confirmDrawing,
    isAnyDrawing,
    startDrawing,
    cancelDrawing,
  } = useAreaDrawing(index);

  // Parent-only analysis availability (multiple model-analysis cards may exist).
  const { analysisConfigs } = useAnalysisStore();
  const parent = config.parentContextOriginalIndex !== undefined
    ? analysisConfigs[config.parentContextOriginalIndex]
    : undefined;
  const hasParentAnalysis =
    parent?.type === 'model-analysis' &&
    !!(parent as AnalyzeModelConfig).analysisResult?.analysisId;

  const mode: PlacementMode = config.drawnArea
    ? 'area'
    : config.useAnalysisResult
      ? 'analysis'
      : 'random';

  // Gate the drawn-area polygon to this card while it is expanded.
  useEffect(() => {
    useAnalysisPreviewStore.getState().setExpandedTextCard(index);
    return () => {
      const store = useAnalysisPreviewStore.getState();
      if (store.expandedTextCardIndex === index) store.setExpandedTextCard(null);
    };
  }, [index]);

  // Batched slider — one undo step per drag gesture
  const numSoundsSlider = useBatchedSlider<number>('analysis', (v) =>
    onUpdateConfig(index, { numSounds: v }),
  );

  const clearArea = () => {
    removeArea();
    onUpdateConfig(index, { drawnArea: null });
  };

  const selectMode = (next: PlacementMode) => {
    if (next === 'area') {
      if (isDrawingThisCard) return;
      onUpdateConfig(index, { useAnalysisResult: false });
      startDrawing();
      return;
    }
    // Leaving area mode removes any drawn polygon.
    if (isDrawingThisCard) cancelDrawing();
    if (hasArea) clearArea();
    onUpdateConfig(index, { useAnalysisResult: next === 'analysis' });
  };

  const optionStyle = (active: boolean, tone: 'primary' | 'warning') => ({
    backgroundColor: active
      ? tone === 'warning'
        ? 'var(--color-warning-light)'
        : 'var(--color-primary-lighter)'
      : 'var(--color-secondary-lighter)',
    borderColor: active
      ? tone === 'warning'
        ? 'var(--color-warning)'
        : 'var(--color-primary)'
      : 'var(--color-secondary-light)',
    borderWidth: '1px',
    borderStyle: 'solid' as const,
    color: active
      ? tone === 'warning'
        ? 'var(--color-warning)'
        : 'var(--color-blue-text)'
      : 'var(--color-secondary-hover)',
    cursor: 'pointer',
  });

  return (
    <div className="card-stack">
      {/* Text input field */}
      <div>
        <label htmlFor={`text-input-${index}`} className="text-xxs font-medium card-label text-neutral-500">
          {mode === 'analysis' ? 'Additional description (optional)' : 'Text Description'}
        </label>
        <textarea
          id={`text-input-${index}`}
          value={config.textInput}
          onChange={(e) => onUpdateConfig(index, { textInput: e.target.value })}
          onFocus={() => pauseStore('analysis')}
          onBlur={() => setTimeout(() => commitStore('analysis'), 0)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') {
              e.preventDefault();
              commitStore('analysis');
              globalUndo();
              pauseStore('analysis');
            }
            if ((e.ctrlKey || e.metaKey) && (e.shiftKey ? e.key === 'z' : e.key === 'y')) {
              e.preventDefault();
              commitStore('analysis');
              globalRedo();
              pauseStore('analysis');
            }
          }}
          placeholder={
            mode === 'analysis'
              ? 'Optional — combined with the analysed space description'
              : 'e.g., a busy coffee shop with espresso machine and conversations'
          }
          className="w-full h-15 p-2 text-xs rounded"
          style={{
            backgroundColor: 'var(--color-secondary-lighter)',
            borderColor: 'var(--color-secondary-light)',
            borderWidth: '1px',
            borderStyle: 'solid',
            borderRadius: '8px',
          }}
          rows={3}
        />
      </div>

      {/* Number of sounds */}
      <RangeSlider
        label="Number of sounds"
        value={config.numSounds ?? NUM_SOUNDS_MIN}
        min={NUM_SOUNDS_MIN}
        max={NUM_SOUNDS_MAX}
        step={1}
        defaultValue={DEFAULT_NUM_SOUNDS}
        onDragStart={numSoundsSlider.onDragStart}
        onChange={numSoundsSlider.onChange}
        onChangeCommitted={numSoundsSlider.onCommit}
      />

      {/* Sound placement — central to this card */}
      <div className="card-field">
        <label className="text-xxs font-medium card-label text-neutral-500">
          Sound placement
        </label>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => selectMode('random')}
            className="flex-1 px-2 py-1.5 text-xs rounded transition-colors"
            style={optionStyle(mode === 'random', 'primary')}
            title="Distribute sounds randomly inside the model bounding box"
          >
            Random
          </button>
          <button
            type="button"
            onClick={() => selectMode('area')}
            className="flex-1 px-2 py-1.5 text-xs rounded transition-colors"
            style={optionStyle(mode === 'area' || isDrawingThisCard, 'warning')}
            title="Draw a polygon in the viewer and place sounds inside it"
          >
            Draw area
          </button>
          <button
            type="button"
            onClick={() => hasParentAnalysis && selectMode('analysis')}
            disabled={!hasParentAnalysis}
            className="flex-1 px-2 py-1.5 text-xs rounded transition-colors"
            style={{
              ...optionStyle(mode === 'analysis', 'primary'),
              opacity: hasParentAnalysis ? 1 : 0.5,
              cursor: hasParentAnalysis ? 'pointer' : 'not-allowed',
            }}
            title={
              hasParentAnalysis
                ? 'Link prompts to objects from the parent 3D model analysis'
                : 'No 3D model analysis available on this card’s parent context'
            }
          >
            3D analysis
          </button>
        </div>
        <p className="text-xxs text-neutral-500">
          {mode === 'area' || isDrawingThisCard
            ? 'Sounds are placed inside the drawn area.'
            : mode === 'analysis'
              ? 'Linked prompts are placed on their objects; the rest inside the model bounding box.'
              : 'Sounds are distributed inside the model bounding box.'}
        </p>
      </div>

      {/* Drawing mode banner */}
      {isDrawingThisCard && (
        <div
          className="text-xs p-2 rounded-md flex items-start justify-between gap-2"
          style={{ backgroundColor: 'var(--color-warning-light)', color: 'var(--color-warning)' }}
        >
          <span>
            Click to place points. Press <kbd className="px-1 py-0.5 rounded text-xs font-mono" style={{ backgroundColor: 'var(--color-warning-light)' }}>Enter</kbd> or right-click to undo last point.
          </span>
          <button
            onClick={confirmDrawing}
            className="shrink-0 px-2 py-0.5 rounded text-xs font-medium cursor-pointer"
            style={{
              backgroundColor: 'var(--color-warning)',
              color: 'var(--color-on-blue)',
            }}
          >
            Validate
          </button>
        </div>
      )}

      {/* Area status indicator */}
      {hasArea && !isDrawingThisCard && (
        <div className="flex items-center justify-between text-xs py-1">
          <span
            className="px-2 py-0.5 rounded text-xxs"
            style={{ backgroundColor: 'var(--color-warning-light)', color: 'var(--color-warning)' }}
          >
            Area defined
          </span>
          <button
            onClick={clearArea}
            className="text-secondary-hover hover:text-foreground cursor-pointer text-xs"
            title="Clear drawn area"
          >
            Clear
          </button>
        </div>
      )}

      {isAnyDrawing && !isDrawingThisCard && (
        <Notice type="info" variant="tag" message="Drawing in viewer…" />
      )}
    </div>
  );
}
