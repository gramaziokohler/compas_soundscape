import { useEffect } from 'react';
import {
  useAnalysisStore,
  useScenarioPreviewStore,
  useSceneHighlightStore,
  useSceneWorkflowStore,
  useSpeckleStore,
} from '@/store';
import { buildAnalysisColorGroups } from '@/utils/utils';
import { buildScenarioPreview } from '@/utils/scenarioObjectRefs';

/**
 * Owns the 3D highlights of Simple mode (the expert cards that normally drive
 * them are unmounted there):
 *   - model-analysis group colors while the running scene's Analyze step runs,
 *     or while the panel's "Show colors" toggle is on (a hovered group alone);
 *   - scenario object highlight while the Scenario step streams, or while the
 *     "Show objects" toggle is on.
 * Anything else — e.g. the final colors `handleAnalyzeModel` leaves behind — is
 * cleared. Unmounting (switch to Detailed mode) clears both.
 *
 * Usage: call once in `SimpleSoundscapes`.
 */
export function useSimpleSceneHighlights(): void {
  const runningStep = useSceneWorkflowStore((s) => {
    const run = s.activeUsageIndex !== null ? s.runs[s.activeUsageIndex] : undefined;
    return run?.status === 'running' ? run.step : null;
  });
  const activeUsageIndex = useSceneWorkflowStore((s) => s.activeUsageIndex);
  const activeContextIndex = useSceneWorkflowStore((s) =>
    s.activeUsageIndex !== null ? s.runs[s.activeUsageIndex]?.contextIndex ?? null : null,
  );
  const analysisToggle = useSceneHighlightStore((s) => s.analysisContextIndex);
  const scenarioToggle = useSceneHighlightStore((s) => s.scenarioUsageIndex);
  const focusedGroup = useSceneHighlightStore((s) => s.focusedGroup);

  // ── Analysis group colors ──────────────────────────────────────────────
  const analysisTarget =
    focusedGroup?.contextIndex
    ?? (runningStep === 'analyze' ? activeContextIndex : analysisToggle);
  const analysisConfig = useAnalysisStore((s) =>
    analysisTarget !== null ? s.analysisConfigs[analysisTarget] : undefined,
  );
  const analysisObjects =
    analysisConfig?.type === 'model-analysis' ? analysisConfig.analysisResult?.architecturalObjects : undefined;
  const focusIndex = focusedGroup?.contextIndex === analysisTarget ? focusedGroup?.groupIndex : undefined;
  const shownGroupCount = useSpeckleStore((s) => s.analysisObjectGroups.length);
  const wantsAnalysis = !!analysisObjects && analysisObjects.length > 0;

  useEffect(() => {
    if (!analysisObjects || analysisObjects.length === 0) return;
    const groups = buildAnalysisColorGroups(analysisObjects, focusIndex);
    if (groups.length > 0) useSpeckleStore.getState().setAnalysisObjectGroups(groups, analysisObjects);
    else useSpeckleStore.getState().clearAnalysisObjectGroups();
  }, [analysisObjects, focusIndex]);

  // Not wanted: clear whatever is shown, including colors another writer
  // (handleAnalyzeModel's final pass, a recovered job) applied afterwards.
  useEffect(() => {
    if (!wantsAnalysis && shownGroupCount > 0) useSpeckleStore.getState().clearAnalysisObjectGroups();
  }, [wantsAnalysis, shownGroupCount]);

  // ── Scenario object highlight ──────────────────────────────────────────
  const scenarioTarget = runningStep === 'scenario' ? activeUsageIndex : scenarioToggle;
  const scenarioConfig = useAnalysisStore((s) =>
    scenarioTarget !== null ? s.analysisConfigs[scenarioTarget] : undefined,
  );
  const scenarioResult = scenarioConfig?.type === 'scenario' ? scenarioConfig.scenarioResult : undefined;
  const foleyResult = scenarioConfig?.type === 'scenario' ? scenarioConfig.foleyResult : null;
  const scenarioPreviewOn = useScenarioPreviewStore((s) => s.enabled);

  useEffect(() => {
    if (!scenarioResult) return;
    useScenarioPreviewStore.getState().setPreview(buildScenarioPreview({ scenarioResult, foleyResult }));
  }, [scenarioResult, foleyResult]);

  useEffect(() => {
    if (!scenarioResult && scenarioPreviewOn) useScenarioPreviewStore.getState().clearPreview();
  }, [scenarioResult, scenarioPreviewOn]);

  // ── Leaving Simple mode: hand the viewer back clean ────────────────────
  useEffect(() => () => {
    useSpeckleStore.getState().clearAnalysisObjectGroups();
    useScenarioPreviewStore.getState().clearPreview();
    useSceneHighlightStore.getState().reset();
  }, []);
}
