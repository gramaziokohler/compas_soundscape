'use client';

import type { AnalysisResult } from '@/types/analysis';
import { CheckboxField } from '@/components/ui/CheckboxField';

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
        <div className="text-xs font-semibold text-success">
        Generated Prompts
        </div>
        <div className="text-xs text-neutral-300">
          {selectedCount} / {analysisResult.prompts.length} selected
        </div>
      </div>

      {/* Prompt list */}
      <div
        className="max-h-64 overflow-y-auto space-y-1"
      >
        {analysisResult.prompts.map((prompt) => (
          <label
            key={prompt.id}
            className="flex items-start gap-0 p-1 rounded cursor-pointer transition-colors"
            style={{
              backgroundColor: prompt.selected ? 'color-mix(in srgb, var(--color-success-hover) 30%, transparent)' : 'transparent',
              borderRadius: '6px'
            }}
            onMouseEnter={(e) => {
              if (!prompt.selected) {
                e.currentTarget.style.backgroundColor = 'var(--color-secondary-hover)';
              }
            }}
            onMouseLeave={(e) => {
              if (!prompt.selected) {
                e.currentTarget.style.backgroundColor = 'transparent';
              }
            }}
          >
            <CheckboxField
              checked={prompt.selected}
              onChange={() => onTogglePromptSelection(analysisResult.configIndex, prompt.id)}
              label=""
            />
            <div className="flex-1 text-xs text-neutral-200">
              {prompt.text}
              
              {/* Metadata display (if available) */}
              {prompt.metadata && (
                <div className="flex gap-3 mt-1 text-[10px] text-neutral-400">
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
