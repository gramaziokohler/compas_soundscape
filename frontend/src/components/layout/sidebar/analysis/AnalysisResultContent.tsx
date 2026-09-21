'use client';

import type { AnalysisResult } from '@/types/analysis';
import { ToggleField } from '@/components/ui/ToggleField';
import { useSpeckleStore, useAnalysisPreviewStore } from '@/store';

/**
 * AnalysisResultContent Component
 *
 * Displays the list of generated text prompts with toggles for selection.
 * Shared "after generation" UI for all analysis types. Selection controls
 * (Select all / Clear / count) mirror the acoustic-region selection UI in
 * ObjectExplorer. Hovering a row highlights its preview sphere (unlinked) or
 * its linked 3D object(s).
 */

interface AnalysisResultContentProps {
  analysisResult: AnalysisResult;
  onTogglePromptSelection: (configIndex: number, promptId: string) => void;
  onSetAllPromptsSelected: (configIndex: number, selected: boolean) => void;
}

export function AnalysisResultContent({
  analysisResult,
  onTogglePromptSelection,
  onSetAllPromptsSelected,
}: AnalysisResultContentProps) {

  const total = analysisResult.prompts.length;
  const selectedCount = analysisResult.prompts.filter((p) => p.selected).length;

  const promptObjectIds = (prompt: AnalysisResult['prompts'][number]): string[] => {
    const ents = prompt.entities ?? (prompt.entity ? [prompt.entity] : []);
    const ids: string[] = [];
    for (const e of ents as any[]) {
      if (Array.isArray(e.object_ids) && e.object_ids.length > 0) ids.push(...e.object_ids);
      else if (e.id) ids.push(e.id);
      else if (e.nodeId) ids.push(e.nodeId);
    }
    return ids;
  };

  const handleHoverStart = (prompt: AnalysisResult['prompts'][number]) => {
    const ids = promptObjectIds(prompt);
    if (ids.length > 0) {
      useSpeckleStore.getState().highlightObjectForHover(ids);
    } else {
      useAnalysisPreviewStore.getState().setHighlightedPrompt(prompt.id);
    }
  };

  const handleHoverEnd = () => {
    useSpeckleStore.getState().clearHoverHighlight();
    useAnalysisPreviewStore.getState().setHighlightedPrompt(null);
  };

  return (
    <div className="card-stack--md">
      {/* Selection toolbar (mirrors ObjectExplorer acoustic-region controls) */}
      <div className="text-xs">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="on-blue-btn px-2 py-0.5 rounded transition-colors disabled:opacity-40"
              style={{ color: 'var(--color-on-blue)' }}
              onClick={() => onSetAllPromptsSelected(analysisResult.configIndex, true)}
              disabled={selectedCount === total}
            >
              Select all
            </button>
            <button
              type="button"
              className="on-blue-btn px-2 py-0.5 rounded transition-colors disabled:opacity-40"
              style={{ color: 'var(--color-on-blue)' }}
              onClick={() => onSetAllPromptsSelected(analysisResult.configIndex, false)}
              disabled={selectedCount === 0}
            >
              Clear
            </button>
          </div>
          <span className="text-right leading-tight" style={{ color: 'var(--color-on-blue-muted)' }}>
            {selectedCount} / {total} selected
          </span>
        </div>
      </div>

      {/* Prompt list */}
      <div className="card-stack--tight max-h-[min(256px,50dvh)] overflow-y-auto">
        {analysisResult.prompts.map((prompt) => (
          <div
            key={prompt.id}
            className="p-1 rounded transition-colors"
            style={{
              backgroundColor: prompt.selected ? 'var(--color-on-blue-faint)' : 'transparent',
              borderRadius: '6px',
            }}
            onMouseEnter={() => handleHoverStart(prompt)}
            onMouseLeave={handleHoverEnd}
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
