'use client';

import { useEffect, useMemo } from 'react';
import type { ScenarioConfig } from '@/types/analysis';
import type { AnalyzeModelConfig } from '@/types/analysis';
import { RangeSlider } from '@/components/ui/RangeSlider';
import { ToggleField } from '@/components/ui/ToggleField';
import { useAnalysisStore, useCardFlowStore, useScenarioPreviewStore, useSpeckleStore } from '@/store';
import { pauseStore, commitStore } from '@/store';
import { ScenarioResultContent } from './ScenarioResultContent';
import { AUDIO_PLAYBACK, SCENARIO_TIMELINE } from '@/utils/constants';
import {
  ID_HEX_DOT_RE,
  OBJECT_REF_RE,
  buildScenarioPreview,
  extractIdsFromToken,
} from '@/utils/scenarioObjectRefs';
import { ModifiedMark, useIsFieldModified } from '@/components/ui/ModifiedMark';

// ─── Object-reference renderer ────────────────────────────────────────────────

/** Event text with hoverable / zoomable object references ("Name (id:…)"). */
export function ScenarioTextRenderer({ text }: { text: string }) {
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
            style={{ color: 'var(--color-warning)' }}
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
export function formatTimestampRange(ts: string): string {
  const range = ts.match(/^(\d+):(\d{2})[–\-](\d+):(\d{2})$/);
  if (range) {
    return `${parseInt(range[1])}:${range[2]}\u2013${parseInt(range[3])}:${range[4]}`;
  }
  const single = ts.match(/^(\d+):(\d{2})$/);
  if (single) return `${parseInt(single[1])}:${single[2]}`;
  return ts;
}

// ─── Pipeline status / progress ───────────────────────────────────────────────
// Maps the scenario→foley→speech pipeline to a single status line
// and a monotonic progress value, surfaced in the Card's collapsed progress bar
// (the "reduced" card). Replaces the inline text helpers that used to live in
// the expanded card body.
//   scenarist streaming  → "Imagining usage scenarios…"            (10%)
//   scenarist done       → "Crafting foley + speech prompts…"      (35%)
//   foley ready          → "Foley ready (N sounds) · …speech…"     (60%)
//   speech ready         → "Ready — N foley + M speech (send…)"    (100%)
// (Orchestration no longer runs here — it runs in parallel at generation time.)

export function getScenarioPipelineStatus(
  config: ScenarioConfig,
  isOperationRunning: boolean,
  liveStatus?: string,
  liveProgress?: number,
): { status: string | undefined; progress: number } {
  if (!isOperationRunning) return { status: undefined, progress: 0 };

  const scenarioCompleted = !!config.scenarioId;
  const hasFoley = !!config.foleyResult;
  const hasSpeech = !!config.speechResult;

  const foleyCount = config.foleyResult?.scenarios?.reduce(
    (sum, s) => sum + (s.sound_events?.length ?? 0), 0,
  ) ?? 0;
  const speechCount = config.speechResult?.speeches?.length ?? 0;

  let stage: { status: string; progress: number };
  if (hasSpeech) {
    stage = {
      status: `Ready — ${foleyCount} foley · ${speechCount} speech`,
      progress: 100,
    };
  } else if (hasFoley) {
    stage = {
      status: `Foley ready${foleyCount ? ` (${foleyCount} sounds)` : ''} · generating speech…`,
      progress: 60,
    };
  } else if (scenarioCompleted) {
    stage = { status: 'Crafting foley + speech prompts…', progress: 35 };
  } else {
    stage = { status: 'Imagining usage scenarios…', progress: 10 };
  }

  if (liveStatus) {
    return {
      status: liveStatus,
      progress: liveProgress && liveProgress > 0 ? liveProgress : stage.progress,
    };
  }
  return stage;
}

// ─── ScenarioAfterView ────────────────────────────────────────────────────────
// Rendered as afterContent (Card's "completed" dark-bg mode).
// State machine:
//   scenarist streaming  → events build up progressively (scenarioId still null)
//   scenarist done       → scenario events + "Call Foley Artist" button
//   foley+speech loading → spinner (scenarioId set, no foley/speech yet)
//   speech loading       → foley done, waiting for speech
//   foley+speech done    → ready to send (incomplete cards → sounds step)
// Step-by-step progress is surfaced in the collapsed Card progress bar via
// getScenarioPipelineStatus — not as inline text in the expanded body.

export function ScenarioAfterView({ config, index }: { config: ScenarioConfig; index: number }) {
  const hasFoley = !!config.foleyResult;

  // Once this scenario has been sent to the Sounds step, its foley sound list is
  // no longer shown here — the sounds live in the Sounds step.
  const sentToSounds = useCardFlowStore((s) => s.usageAdvanced.has(index));

  // Always show scenario events — foley sounds are shown in the Sounds step, not here
  const scenarios = config.scenarioResult?.scenarios ?? [];

  // ── 3D preview: color-highlight all scenario objects while this card is
  // expanded (always on), plus a dashed-arrow parcours between the objects in
  // scenario order. The parcours visibility is controlled by the scenario card's
  // "Show scenario parcours" toggle (uiStore.showScenarioParcours).
  const setPreview = useScenarioPreviewStore((s) => s.setPreview);
  const clearPreview = useScenarioPreviewStore((s) => s.clearPreview);

  // Objects referenced in the event descriptions (same source as the hover
  // highlight in ScenarioTextRenderer) + one parcours stop per reference.
  useEffect(() => {
    setPreview(buildScenarioPreview({ scenarioResult: config.scenarioResult, foleyResult: config.foleyResult }));
  }, [config.scenarioResult, config.foleyResult, setPreview]);

  // Clear the viewer preview when the card collapses (component unmounts)
  useEffect(() => () => clearPreview(), [clearPreview]);

  return (
    <div className="card-stack leading-relaxed whitespace-pre-wrap max-h-[min(320px,50dvh)] overflow-y-auto">
      {scenarios.map((scenario, si) => (
        <div key={si} className="card-stack--tight">
          {scenario.events.map((event, ei) => (
            <p key={ei} className="text-xs leading-relaxed text-foreground">
              <span style={{ marginRight: '4px' }}>
                {formatTimestampRange(event.timestamp)}
              </span>{' '}
              <span
                className="font-mono"
                style={{ color: 'var(--color-on-blue-muted)', fontSize: '10px' }}
              >
                <ScenarioTextRenderer text={event.description} />
              </span>
            </p>
          ))}
        </div>
      ))}

      {/* Foley results — toggleable foley sounds (shown when foley done and not yet sent to Sounds) */}
      {hasFoley && config.foleyResult && !sentToSounds && (
        <div
          className="border-t"
          style={{ borderTopColor: 'var(--color-on-blue-faint)', paddingTop: 'var(--card-gap-row)' }}
        >
          <ScenarioResultContent
            foleyResult={config.foleyResult}
            selectedKeys={config.selectedFoleyKeys ?? []}
            onToggle={(key) => useAnalysisStore.getState().handleToggleFoleySound(index, key)}
          />
        </div>
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

  // Parent-only analysis availability (multiple model-analysis cards may exist).
  const parent = config.parentContextOriginalIndex !== undefined
    ? analysisConfigs[config.parentContextOriginalIndex]
    : undefined;
  const hasAnalysisResult =
    parent?.type === 'model-analysis' &&
    !!(parent as AnalyzeModelConfig).analysisResult?.analysisId;
  const isModified = useIsFieldModified();

  return (
    <div className="card-stack">
      {hasAnalysisResult && (
        <ToggleField
          label="Use 3D model analysis as context"
          modified={isModified('useAnalysisResult')}
          checked={config.useAnalysisResult}
          onChange={(checked) => onUpdateConfig(index, { useAnalysisResult: checked })}
        />
      )}

      <div>
        <label
          htmlFor={`scenario-context-${index}`}
          className="text-xs font-medium card-label opacity-70"
        >
          Context (optional){isModified('userContext') && <ModifiedMark />}
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
            modified={isModified('peopleCount')}
            min={0}
            max={20}
            step={1}
            value={config.peopleCount}
            defaultValue={5}
            onChange={(v) => onUpdateConfig(index, { peopleCount: v })}
            disabled={isAnalyzing}
          />
        </div>
        <div className="flex-1">
          <RangeSlider
            label="Plausibility"
            modified={isModified('likeliness')}
            min={1}
            max={10}
            step={1}
            value={config.likeliness}
            defaultValue={9}
            onChange={(v) => onUpdateConfig(index, { likeliness: v })}
            disabled={isAnalyzing}
          />
        </div>
      </div>

      <RangeSlider
        label="Duration"
        modified={isModified('timelineDurationMs')}
        value={config.timelineDurationMs / 1_000}
        min={SCENARIO_TIMELINE.MIN_SECONDS}
        max={SCENARIO_TIMELINE.MAX_SECONDS}
        step={SCENARIO_TIMELINE.STEP_SECONDS}
        unit="s"
        defaultValue={AUDIO_PLAYBACK.TIMELINE_FIXED_DURATION_MS / 1_000}
        onChange={(v) => onUpdateConfig(index, { timelineDurationMs: v * 1_000 })}
        onDragStart={() => pauseStore('analysis')}
        onChangeCommitted={(v) => {
          onUpdateConfig(index, { timelineDurationMs: v * 1_000 });
          commitStore('analysis');
        }}
        disabled={isAnalyzing}
        hoverText="Length of this scenario's generated sound scene — bounds this scenario's DAW timeline in seconds. Double-click to reset to the default."
      />

    </div>
  );
}

