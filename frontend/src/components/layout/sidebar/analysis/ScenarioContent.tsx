'use client';

import { useMemo } from 'react';
import type { ScenarioConfig } from '@/types/analysis';
import type { AnalyzeModelConfig } from '@/types/analysis';
import { RangeSlider } from '@/components/ui/RangeSlider';
import { CheckboxField } from '@/components/ui/CheckboxField';
import { useAnalysisStore, useAudioControlsStore, useSpeckleStore } from '@/store';
import { pauseStore, commitStore } from '@/store';
import { ScenarioResultContent } from './ScenarioResultContent';

// ─── Object-reference renderer ────────────────────────────────────────────────

/**
 * Matches an optional-quoted name followed by one or more IDs in parentheses.
 * Handles both comma-separated and " and "-separated multiple IDs, plus "e.g.," prefix:
 *   "Office Chair (id:abc...)"                         — single ID
 *   "Chairs (id:abc..., id:def...)"                   — comma-separated
 *   "Chairs (id:abc... and id:def...)"                — and-separated (LLM output style)
 *   "Chairs and Stools (e.g., id:abc..., id:def...)"  — "and" in name + e.g. prefix
 * The first word may be any letter case; subsequent words must be capitalized OR connected
 * via "and" to a capitalized word (to avoid greedily consuming lowercase words like "the").
 * Handles optional space after "id:" e.g. (id: abc...).
 */
const OBJECT_REF_RE = /['"]?([A-Za-z][A-Za-z]*(?:\s+(?:and\s+[A-Z][A-Za-z]*|[A-Z][A-Za-z]*))*)['"]?(?:\s*\([^)]*\))?\s*\((?:e\.g\.,\s*)?(?:\w+:\s*(?:id:\s*)?)?[0-9a-fA-F]+(?:\s*(?:,|and)\s*(?:\w+:\s*(?:id:\s*)?)?[0-9a-fA-F]+)*\)/g;
const ID_HEX_RE = /[0-9a-fA-F]{8,}/g;
/** Normalize dot-separated object refs (LLM hallucination): Doors.hexid → Doors (id:hexid) */
const ID_HEX_DOT_RE = /\b([A-Z][A-Za-z0-9]+(?:\s+[A-Z][A-Za-z0-9]+)*)\.([0-9a-fA-F]{24,64})\b/g;

/** Extract all hex IDs from the full matched token (including the parenthesised id-list). */
function extractIdsFromToken(raw: string): string[] {
  return Array.from(raw.matchAll(ID_HEX_RE), (m) => m[0]);
}

function ScenarioTextRenderer({ text }: { text: string }) {
  const { highlightObjectForHover, clearHoverHighlight, zoomToObjectById } = useSpeckleStore();

  const parts = useMemo(() => {
    // Pre-normalize dot-separated refs to parenthesized format for unified matching
    const normalizedText = text.replace(ID_HEX_DOT_RE, '$1 (id:$2)');
    const result: Array<{ type: 'text'; value: string } | { type: 'ref'; name: string; ids: string[] }> = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    const re = new RegExp(OBJECT_REF_RE.source, 'g');
    while ((match = re.exec(normalizedText)) !== null) {
      if (match.index > lastIndex) {
        result.push({ type: 'text', value: normalizedText.slice(lastIndex, match.index) });
      }
      // match[1] = name (capitalized words); all hex IDs are extracted from the full token
      const ids = extractIdsFromToken(match[0]);
      result.push({ type: 'ref', name: match[1].trim(), ids });
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < normalizedText.length) result.push({ type: 'text', value: normalizedText.slice(lastIndex) });
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
            onMouseEnter={() => part.ids.length > 0 && highlightObjectForHover(part.ids)}
            onMouseLeave={() => clearHoverHighlight()}
            onClick={() => part.ids.length > 0 && zoomToObjectById(part.ids)}
            title={`Click to zoom to ${part.ids.length > 1 ? `${part.ids.length} objects` : 'object'}`}
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

// ─── Pipeline status / progress ───────────────────────────────────────────────
// Maps the scenario→foley→speech→orchestrate pipeline to a single status line
// and a monotonic progress value, surfaced in the Card's collapsed progress bar
// (the "reduced" card). Replaces the inline text helpers that used to live in
// the expanded card body.
//   scenarist streaming  → "Imagining usage scenarios…"            (10%)
//   scenarist done       → "Crafting foley + speech prompts…"      (35%)
//   foley ready          → "Foley ready (N sounds) · …speech…"     (55%)
//   speech ready         → "Speech ready (N characters) · …"       (80%)
//   orchestrate done     → "Playlist ready (N entries) — sent…"    (100%)

export function getScenarioPipelineStatus(
  config: ScenarioConfig,
  isOperationRunning: boolean,
): { status: string | undefined; progress: number } {
  if (!isOperationRunning) return { status: undefined, progress: 0 };

  const scenarioCompleted = !!config.scenarioId;
  const hasFoley = !!config.foleyResult;
  const hasSpeech = !!config.speechResult;
  const hasOrchestrate = !!config.orchestrateResult;

  const foleyCount = config.foleyResult?.scenarios?.reduce(
    (sum, s) => sum + (s.sound_events?.length ?? 0), 0,
  ) ?? 0;
  const speechCount = config.speechResult?.speeches?.length ?? 0;
  const playlistCount = config.orchestrateResult?.playlist?.length ?? 0;

  if (hasOrchestrate) {
    return {
      status: `Playlist ready${playlistCount ? ` (${playlistCount} entries)` : ''} — sent to generation`,
      progress: 100,
    };
  }
  if (hasSpeech) {
    return {
      status: `Speech ready${speechCount ? ` (${speechCount} characters)` : ''} · compiling playlist…`,
      progress: 80,
    };
  }
  if (hasFoley) {
    return {
      status: `Foley ready${foleyCount ? ` (${foleyCount} sounds)` : ''} · generating speech…`,
      progress: 55,
    };
  }
  if (scenarioCompleted) {
    return { status: 'Crafting foley + speech prompts…', progress: 35 };
  }
  return { status: 'Imagining usage scenarios…', progress: 10 };
}

// ─── ScenarioAfterView ────────────────────────────────────────────────────────
// Rendered as afterContent (Card's "completed" dark-bg mode).
// State machine:
//   scenarist streaming  → events build up progressively (scenarioId still null)
//   scenarist done       → scenario events + "Call Foley Artist" button
//   foley+speech loading → spinner (scenarioId set, no foley/speech yet)
//   speech loading       → foley done, waiting for speech
//   orchestrate loading  → foley+speech done, waiting for orchestrate
//   orchestrate done     → auto-sent to sound generation
// Step-by-step progress is surfaced in the collapsed Card progress bar via
// getScenarioPipelineStatus — not as inline text in the expanded body.

export function ScenarioAfterView({ config, index }: { config: ScenarioConfig; index: number }) {
  const handleAnalyze = useAnalysisStore((s) => s.handleAnalyze);
  const analyzingConfigIndex = useAnalysisStore((s) => s.analyzingConfigIndex);

  const isOperationRunning = analyzingConfigIndex === index;
  const scenarioCompleted = !!config.scenarioId;
  const hasFoley = !!config.foleyResult;
  const hasSpeech = !!config.speechResult;
  const hasOrchestrate = !!config.orchestrateResult;

  // Always show scenario events — foley sounds are shown in the Sounds step, not here
  const scenarios = config.scenarioResult?.scenarios ?? [];
  return (
    <div className="space-y-3 px-4 pb-3 leading-relaxed whitespace-pre-wrap max-h-80 overflow-y-auto">
      {scenarios.map((scenario, si) => (
        <div key={si} className="space-y-1">
          {scenario.events.map((event, ei) => (
            <p key={ei} className="text-xs leading-relaxed text-secondary">
              <span
                className="font-mono"
                style={{ color: 'var(--color-secondary-hover)', fontSize: '10px', borderRadius: '4px', marginRight: '4px' }}
              >
                {formatTimestampRange(event.timestamp)}
              </span>{' '}
              <ScenarioTextRenderer text={event.description} />
            </p>
          ))}
        </div>
      ))}

      {/* Call Foley Artist — only shown when scenarist done, pipeline not yet started */}
      {scenarioCompleted && !isOperationRunning && !hasFoley && !hasSpeech && !hasOrchestrate && (
        <button
          onClick={() => handleAnalyze(index)}
          className="w-full py-1.5 px-3 text-xs font-medium rounded hover:opacity-80 transition-opacity"
          style={{
            backgroundColor: 'var(--color-primary)',
            color: 'var(--color-primary-foreground, #fff)',
            borderRadius: '6px',
          }}
        >
          Generate Sound Pipeline
        </button>
      )}

      {/* Continue orchestrate — shown when foley+speech done but orchestrator not started yet (was interrupted) */}
      {scenarioCompleted && !isOperationRunning && hasFoley && hasSpeech && !hasOrchestrate && (
        <button
          onClick={() => handleAnalyze(index)}
          className="w-full py-1.5 px-3 text-xs font-medium rounded hover:opacity-80 transition-opacity"
          style={{
            backgroundColor: 'var(--color-info, #3b82f6)',
            color: '#fff',
            borderRadius: '6px',
          }}
        >
          Compile Playlist
        </button>
      )}

      {/* Re-generate — shown when pipeline completed, clicking re-runs orchestrate */}
      {scenarioCompleted && !isOperationRunning && hasOrchestrate && (
        <button
          onClick={() => handleAnalyze(index)}
          className="w-full py-1.5 px-3 text-xs font-medium rounded hover:opacity-80 transition-opacity"
          style={{
            backgroundColor: 'var(--color-success, #22c55e)',
            color: '#fff',
            borderRadius: '6px',
          }}
        >
          Re-send to Sound Generation
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
        (c) => c.type === 'model-analysis' && (c as AnalyzeModelConfig).analysisResult?.analysisId,
      ),
    [analysisConfigs],
  );

  const durationSeconds = Math.round(timelineDurationMs / 1000);

  return (
    <div className="space-y-3">
      {hasAnalysisResult && (
        <CheckboxField
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
            label="Plausibility"
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

