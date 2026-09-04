'use client';

import type { AnalysisResult } from '@/types/analysis';
import { ToggleField } from '@/components/ui/ToggleField';

/**
 * AnalysisResultContent Component
 * 
 * Displays the list of generated text prompts with toggles for selection.
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
    <div className="card-stack--md">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold text-on-blue">
        Generated Prompts
        </div>
        <div className="text-xs" style={{ color: 'var(--color-on-blue-muted)' }}>
          {selectedCount} / {analysisResult.prompts.length} selected
        </div>
      </div>

      {/* Prompt list */}
      <div
        className="card-stack--tight max-h-[min(256px,50dvh)] overflow-y-auto"
      >
        {analysisResult.prompts.map((prompt) => (
          <div
            key={prompt.id}
            className="p-1 rounded transition-colors"
            style={{
              backgroundColor: prompt.selected ? 'var(--color-on-blue-faint)' : 'transparent',
              borderRadius: '6px'
            }}
            onMouseEnter={(e) => {
              if (!prompt.selected) {
                e.currentTarget.style.backgroundColor = 'var(--color-on-blue-faint)';
              }
            }}
            onMouseLeave={(e) => {
              if (!prompt.selected) {
                e.currentTarget.style.backgroundColor = 'transparent';
              }
            }}
          >
            <ToggleField
              checked={prompt.selected}
              onChange={() => onTogglePromptSelection(analysisResult.configIndex, prompt.id)}
              label={prompt.text}
              className="!mb-0"
            />
            {prompt.metadata && (
              <div className="card-title-info flex gap-3 pl-0 text-[10px]" style={{ color: 'var(--color-on-blue-muted)' }}>
                {prompt.metadata.dbfs !== undefined && (
                  <span>Level: {prompt.metadata.dbfs}dBFS</span>
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
        ))}
      </div>
    </div>
  );
}
