'use client';

import { useMemo } from 'react';
import type { ScenarioConfig } from '@/types/analysis';
import type { ModelAnalysisConfig } from '@/types/analysis';
import { RangeSlider } from '@/components/ui/RangeSlider';
import { CheckboxField } from '@/components/ui/CheckboxField';
import { useAnalysisStore, useAudioControlsStore, useSpeckleStore } from '@/store';
import { pauseStore, commitStore } from '@/store';
import { ScenarioResultContent } from './ScenarioResultContent';

// ─── Object-reference renderer ────────────────────────────────────────────────

/**
 * Matches a capitalized name followed by one or more IDs in parentheses.
 * e.g. "Office Chair (id:abc...)" or "Laptops (id:abc..., id:def..., id:ghi...)"
 * Captures group 1 = name, group 2 = first ID (used for hover/zoom).
 * Additional IDs are consumed but not captured, so the whole token is replaced.
 */
const OBJECT_REF_RE = /([A-Z][A-Za-z]*(?:\s+[A-Z][A-Za-z]*)*)\s*\(id:\s*([0-9a-fA-F]+)(?:,\s*id:\s*[0-9a-fA-F]+)*\)/g;

function ScenarioTextRenderer({ text }: { text: string }) {
  const { highlightObjectForHover, clearHoverHighlight, zoomToObjectById } = useSpeckleStore();

  const parts = useMemo(() => {
    const result: Array<{ type: 'text'; value: string } | { type: 'ref'; name: string; id: string }> = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    const re = new RegExp(OBJECT_REF_RE.source, 'g');
    while ((match = re.exec(text)) !== null) {
      if (match.index > lastIndex) {
        result.push({ type: 'text', value: text.slice(lastIndex, match.index) });
      }
      // Group 1 = name (capitalized words), group 2 = 32-char hex ID
      result.push({ type: 'ref', name: match[1].trim(), id: match[2] ?? '' });
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) result.push({ type: 'text', value: text.slice(lastIndex) });
    return result;
  }, [text]);

  return (
    <span>
      {parts.map((part, i) =>
        part.type === 'text' ? (
          <span key={i}>{part.value}</span>
        ) : (
          <span
            key={i}
            className="cursor-pointer font-medium underline decoration-dotted"
            style={{ color: 'var(--color-success)' }}
            onMouseEnter={() => part.id && highlightObjectForHover(part.id)}
            onMouseLeave={() => clearHoverHighlight()}
            onClick={() => part.id && zoomToObjectById(part.id)}
            title="Click to zoom to object"
          >
            {part.name}
          </span>
        ),
      )}
    </span>
  );
}

// ─── Timestamp formatter ──────────────────────────────────────────────────────

/** "00:20-00:45" or "00:20" → "0:20 - 0:45" / "0:20" */
function formatTimestampRange(ts: string): string {
  const range = ts.match(/^(\d+):(\d{2})[–\-](\d+):(\d{2})$/);
  if (range) {
    return `${parseInt(range[1])}:${range[2]}\u2013${parseInt(range[3])}:${range[4]}`;
  }
  const single = ts.match(/^(\d+):(\d{2})$/);
  if (single) return `${parseInt(single[1])}:${single[2]}`;
  return ts;
}

// ─── ScenarioAfterView ────────────────────────────────────────────────────────
// Rendered as afterContent (Card's "completed" dark-bg mode).
// State machine:
//   scenarist streaming  → events build up progressively (scenarioId still null)
//   scenarist done       → scenario events + "Call Foley Artist" button
//   foley loading        → spinner (scenarioId set, foleyResult null, operation running)
//   foley streaming      → foley sounds appear progressively

export function ScenarioAfterView({ config, index }: { config: ScenarioConfig; index: number }) {
  const handleAnalyze = useAnalysisStore((s) => s.handleAnalyze);
  const handleToggleFoleySound = useAnalysisStore((s) => s.handleToggleFoleySound);
  const analyzingConfigIndex = useAnalysisStore((s) => s.analyzingConfigIndex);

  const isOperationRunning = analyzingConfigIndex === index;
  // Scenarist is complete once scenarioId is set (set on the 'done' SSE event)
  const scenarioCompleted = !!config.scenarioId;
  // Foley loading: an operation is running, scenarist is done, but no foley result yet
  const isFoleyLoading = isOperationRunning && scenarioCompleted && !config.foleyResult;
  // Scenarist is streaming events: operation running but scenarist not yet done
  const isScenaristStreaming = isOperationRunning && !scenarioCompleted;

  // Foley loading state (spinner while awaiting LLM response for foley)
  if (isFoleyLoading) {
    return (
      <div className="px-4 pb-3 flex items-center gap-2">
        <span
          className="inline-block w-1.5 h-1.5 rounded-full animate-pulse flex-shrink-0"
          style={{ backgroundColor: 'var(--color-primary)' }}
        />
        <span className="text-xs" style={{ color: 'var(--color-background)' }}>
          Crafting sound prompts…
        </span>
      </div>
    );
  }

  // Foley result — show sounds list (progressively updated during streaming)
  if (config.foleyResult) {
    return (
      <ScenarioResultContent
        foleyResult={config.foleyResult}
        selectedKeys={config.selectedFoleyKeys ?? []}
        onToggle={(key) => handleToggleFoleySound(index, key)}
      />
    );
  }

  // Scenario events list (builds up progressively during scenarist streaming)
  const scenarios = config.scenarioResult?.scenarios ?? [];
  return (
    <div className="space-y-3 px-4 pb-3 leading-relaxed whitespace-pre-wrap max-h-80 overflow-y-auto">
        {scenarios.map((scenario, si) => (
          <div key={si} className="space-y-1">
            {/* Title — only shown when multiple scenarios
            {scenarios.length >= 1 && (
              <p className="text-[10px] text-background font-semibold pt-1 pb-0.5 opacity-70 uppercase tracking-wide">
                {scenario.title}
              </p>
            )} */}
            {scenario.events.map((event, ei) => (
              <p key={ei} className="text-xs leading-relaxed text-secondary-light">
                <span
                  className="font-mono"
                  style={{ color: 'var(--color-primary)', fontSize: '10px', backgroundColor: 'var(--color-secondary-light)', borderRadius: '4px', marginRight: '4px' }}
                >
                  {formatTimestampRange(event.timestamp)}
                </span>{' '}
                <ScenarioTextRenderer text={event.description} />
              </p>
            ))}
          </div>
        ))}

      {/* Call Foley Artist — only shown when scenarist is fully done and no operation running */}
      {scenarioCompleted && !isOperationRunning && (
        <button
          onClick={() => handleAnalyze(index)}
          className="w-full py-1.5 px-3 text-xs font-medium rounded hover:opacity-80 transition-opacity"
          style={{
            backgroundColor: 'var(--color-primary)',
            color: 'var(--color-primary-foreground, #fff)',
            borderRadius: '6px',
          }}
        >
          Call Foley Artist
        </button>
      )}
    </div>
  );
}

// ─── ScenarioContent (beforeContent only) ────────────────────────────────────
// Shown while scenario is being generated (hasResult=false, i.e. before first event arrives).
// Config sliders + loading indicator only — results appear in ScenarioAfterView.

interface ScenarioContentProps {
  config: ScenarioConfig;
  index: number;
  isAnalyzing: boolean;
  onUpdateConfig: (index: number, updates: Partial<ScenarioConfig>) => void;
}

export function ScenarioContent({
  config,
  index,
  isAnalyzing,
  onUpdateConfig,
}: ScenarioContentProps) {
  const { analysisConfigs } = useAnalysisStore();
  const { timelineDurationMs } = useAudioControlsStore();

  const hasAnalysisResult = useMemo(
    () =>
      analysisConfigs.some(
        (c) => c.type === 'model-analysis' && (c as ModelAnalysisConfig).analysisResult?.analysisId,
      ),
    [analysisConfigs],
  );

  const durationSeconds = Math.round(timelineDurationMs / 1000);

  return (
    <div className="space-y-3">
      {hasAnalysisResult && (
        <CheckboxField
          id={`scenario-use-analysis-${index}`}
          label="Use 3D model analysis as context"
          checked={config.useAnalysisResult}
          onChange={(checked) => onUpdateConfig(index, { useAnalysisResult: checked })}
        />
      )}

      <div>
        <label
          htmlFor={`scenario-context-${index}`}
          className="text-xs font-medium block mb-1.5 opacity-70"
        >
          Context (optional)
        </label>
        <textarea
          id={`scenario-context-${index}`}
          value={config.userContext}
          onChange={(e) => onUpdateConfig(index, { userContext: e.target.value })}
          onFocus={() => pauseStore('analysis')}
          onBlur={() => setTimeout(() => commitStore('analysis'), 0)}
          placeholder="Describe any additional context for the scenario…"
          className="w-full p-2 text-xs rounded"
          style={{
            backgroundColor: 'var(--background)',
            borderColor: 'color-mix(in srgb, var(--color-foreground) 12%, transparent)',
            borderWidth: '1px',
            borderStyle: 'solid',
            borderRadius: '8px',
          }}
          rows={3}
          disabled={isAnalyzing}
        />
      </div>

      <div className="flex gap-4">
        <div className="flex-1">
          <RangeSlider
            id={`scenario-people-${index}`}
            label="People"
            min={0}
            max={20}
            step={1}
            value={config.peopleCount}
            onChange={(v) => onUpdateConfig(index, { peopleCount: v })}
            disabled={isAnalyzing}
          />
        </div>
        <div className="flex-1">
          <RangeSlider
            id={`scenario-likeliness-${index}`}
            label="Likeliness"
            min={1}
            max={10}
            step={1}
            value={config.likeliness}
            onChange={(v) => onUpdateConfig(index, { likeliness: v })}
            disabled={isAnalyzing}
          />
        </div>
      </div>

      <p className="text-xs opacity-50">
        Duration: <span className="font-medium opacity-100">{durationSeconds}s</span> (from timeline)
      </p>

    </div>
  );
}

