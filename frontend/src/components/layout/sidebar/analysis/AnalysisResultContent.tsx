'use client';

import type { AnalysisResult } from '@/types/analysis';
import { UI_COLORS } from '@/lib/constants';

/**
 * AnalysisResultContent Component
 * 
 * Displays the list of generated text prompts with checkboxes for selection.
 * This is the shared "after generation" UI used by all analysis types.
 */

interface AnalysisResultContentProps {
  analysisResult: AnalysisResult;
  onTogglePromptSelection: (configIndex: number, promptId: string) => void;
}

export function AnalysisResultContent({
  analysisResult,
  onTogglePromptSelection
}: AnalysisResultContentProps) {
  
  const selectedCount = analysisResult.prompts.filter(p => p.selected).length;

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold" style={{ color: UI_COLORS.SUCCESS }}>
          ✨ Generated Prompts
        </div>
        <div className="text-xs" style={{ color: UI_COLORS.NEUTRAL_600 }}>
          {selectedCount} / {analysisResult.prompts.length} selected
        </div>
      </div>

      {/* Prompt list */}
      <div
        className="rounded p-2 max-h-64 overflow-y-auto space-y-1"
        style={{
          backgroundColor: 'white',
          borderRadius: '8px',
          borderWidth: '1px',
          borderStyle: 'solid',
          borderColor: UI_COLORS.NEUTRAL_300
        }}
      >
        {analysisResult.prompts.map((prompt) => (
          <label
            key={prompt.id}
            className="flex items-start gap-2 p-2 rounded cursor-pointer transition-colors"
            style={{
              backgroundColor: prompt.selected ? `${UI_COLORS.PRIMARY}10` : 'transparent',
              borderRadius: '6px'
            }}
            onMouseEnter={(e) => {
              if (!prompt.selected) {
                e.currentTarget.style.backgroundColor = UI_COLORS.NEUTRAL_100;
              }
            }}
            onMouseLeave={(e) => {
              if (!prompt.selected) {
                e.currentTarget.style.backgroundColor = 'transparent';
              }
            }}
          >
            <input
              type="checkbox"
              checked={prompt.selected}
              onChange={() => onTogglePromptSelection(analysisResult.configIndex, prompt.id)}
              className="mt-0.5 w-4 h-4 rounded focus:ring-2 accent-primary flex-shrink-0"
            />
            <div className="flex-1 text-xs" style={{ color: UI_COLORS.NEUTRAL_900 }}>
              {prompt.text}
              
              {/* Metadata display (if available) */}
              {prompt.metadata && (
                <div className="flex gap-3 mt-1 text-[10px]" style={{ color: UI_COLORS.NEUTRAL_500 }}>
                  {prompt.metadata.spl_db !== undefined && (
                    <span>SPL: {prompt.metadata.spl_db}dB</span>
                  )}
                  {prompt.metadata.interval_seconds !== undefined && (
                    <span>Interval: {prompt.metadata.interval_seconds}s</span>
                  )}
                  {prompt.metadata.confidence !== undefined && (
                    <span>Confidence: {(prompt.metadata.confidence * 100).toFixed(0)}%</span>
                  )}
                </div>
              )}
            </div>
          </label>
        ))}
      </div>
    </div>
  );
}
