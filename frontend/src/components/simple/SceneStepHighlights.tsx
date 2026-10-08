'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useAnalysisStore, useSceneHighlightStore, useSpeckleStore } from '@/store';
import { getAnalysisGroupColor } from '@/utils/utils';
import {
  ScenarioTextRenderer,
  formatTimestampRange,
} from '@/components/layout/sidebar/analysis/ScenarioContent';

/** Toggle chip + expand chip row shared by both step controls. */
function HighlightChips({ shown, showLabel, onToggle, expanded, expandLabel, onExpand }: {
  shown: boolean;
  showLabel: string;
  onToggle: () => void;
  expanded: boolean;
  expandLabel: string;
  onExpand: () => void;
}) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap mt-1">
      <button
        type="button"
        className={`bubble-chip${shown ? ' bubble-chip--on' : ''}`}
        aria-pressed={shown}
        onClick={onToggle}
      >
        {showLabel}
      </button>
      <button type="button" className="bubble-chip" aria-expanded={expanded} onClick={onExpand}>
        {expandLabel} {expanded ? '▴' : '▾'}
      </button>
    </div>
  );
}

function StepList({ children }: { children: ReactNode }) {
  return <ul className="bubble-step__list bubble-step__meta">{children}</ul>;
}

// ─── Analysis groups ─────────────────────────────────────────────────────────

export interface AnalysisGroupsControlsProps {
  /** Model-analysis (context) card index of the scene. */
  contextIndex: number;
}

/**
 * AnalysisGroupsControls Component
 *
 * Shown under a finished Analyze step: a "Show colors" toggle that colors the
 * analyzed groups in 3D, and an expandable group list (hover = that group
 * alone, click = zoom to it).
 *
 * Usage:
 * ```tsx
 * <AnalysisGroupsControls contextIndex={scene.contextIndex} />
 * ```
 */
export function AnalysisGroupsControls({ contextIndex }: AnalysisGroupsControlsProps) {
  const config = useAnalysisStore((s) => s.analysisConfigs[contextIndex]);
  const shown = useSceneHighlightStore((s) => s.analysisContextIndex === contextIndex);
  const [expanded, setExpanded] = useState(false);

  // Closing the panel turns the colors off again.
  useEffect(() => () => {
    const store = useSceneHighlightStore.getState();
    if (store.analysisContextIndex === contextIndex) store.setAnalysisShown(null);
    if (store.focusedGroup?.contextIndex === contextIndex) store.setFocusedGroup(null);
  }, [contextIndex]);

  const objects = config?.type === 'model-analysis' ? config.analysisResult?.architecturalObjects ?? [] : [];
  if (objects.length === 0) return null;

  const { setAnalysisShown, setFocusedGroup } = useSceneHighlightStore.getState();

  return (
    <>
      <HighlightChips
        shown={shown}
        showLabel="Show colors"
        onToggle={() => setAnalysisShown(shown ? null : contextIndex)}
        expanded={expanded}
        expandLabel={`${objects.length} groups`}
        onExpand={() => setExpanded((e) => !e)}
      />
      {expanded && (
        <StepList>
          {objects.map((obj, i) => {
            const ids = Object.keys(obj.object_ids ?? {});
            return (
              <li key={i}>
                <button
                  type="button"
                  className="bubble-step__list-row w-full"
                  onMouseEnter={() => ids.length > 0 && setFocusedGroup({ contextIndex, groupIndex: i })}
                  onMouseLeave={() => setFocusedGroup(null)}
                  onClick={() => ids.length > 0 && useSpeckleStore.getState().zoomToObjectById(ids)}
                  title={obj.description || (ids.length > 0 ? `Zoom to ${ids.length} objects` : undefined)}
                >
                  <span className="bubble-step__swatch" style={{ backgroundColor: getAnalysisGroupColor(i) }} />
                  <span className="truncate flex-1 min-w-0" style={{ color: 'var(--foreground)' }}>{obj.name}</span>
                  {obj.quantity > 1 && <span className="shrink-0">×{obj.quantity}</span>}
                </button>
              </li>
            );
          })}
        </StepList>
      )}
    </>
  );
}

// ─── Scenario objects ────────────────────────────────────────────────────────

export interface ScenarioHighlightControlsProps {
  /** Scenario (usage) card index of the scene. */
  usageIndex: number;
}

/**
 * ScenarioHighlightControls Component
 *
 * Shown under a finished Scenario step: a "Show objects" toggle that
 * highlights the objects the scenario references, and an expandable event
 * list (object references hover-highlight / zoom).
 *
 * Usage:
 * ```tsx
 * <ScenarioHighlightControls usageIndex={scene.usageIndex} />
 * ```
 */
export function ScenarioHighlightControls({ usageIndex }: ScenarioHighlightControlsProps) {
  const config = useAnalysisStore((s) => s.analysisConfigs[usageIndex]);
  const shown = useSceneHighlightStore((s) => s.scenarioUsageIndex === usageIndex);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => () => {
    const store = useSceneHighlightStore.getState();
    if (store.scenarioUsageIndex === usageIndex) store.setScenarioShown(null);
  }, [usageIndex]);

  const events = config?.type === 'scenario'
    ? (config.scenarioResult?.scenarios ?? []).flatMap((s) => s.events)
    : [];
  if (events.length === 0) return null;

  const { setScenarioShown } = useSceneHighlightStore.getState();

  return (
    <>
      <HighlightChips
        shown={shown}
        showLabel="Show objects"
        onToggle={() => setScenarioShown(shown ? null : usageIndex)}
        expanded={expanded}
        expandLabel={`${events.length} events`}
        onExpand={() => setExpanded((e) => !e)}
      />
      {expanded && (
        <StepList>
          {events.map((event, i) => (
            <li key={i} className="px-1 leading-relaxed">
              <span className="mr-1">{formatTimestampRange(event.timestamp)}</span>
              <span style={{ color: 'var(--foreground)' }}>
                <ScenarioTextRenderer text={event.description} />
              </span>
            </li>
          ))}
        </StepList>
      )}
    </>
  );
}
