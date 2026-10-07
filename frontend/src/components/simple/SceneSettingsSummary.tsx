'use client';

import { useMemo } from 'react';
import { useAnalysisStore, useAudioControlsStore, useSceneWorkflowStore } from '@/store';
import { SettingsSummary } from '@/components/ui/SettingsSummary';
import { getSceneSettingsRows } from '@/utils/sceneWorkflow';

export interface SceneSettingsSummaryProps {
  /** Usage (scenario) card index of the scene. */
  usageIndex: number;
}

/**
 * SceneSettingsSummary Component
 *
 * Collapsible, theme-aware "Scene settings" recap of a scenario scene (prompt,
 * duration, speech, people, models…). Renders nothing for non-scenario scenes.
 *
 * Usage:
 * ```tsx
 * <SceneSettingsSummary usageIndex={scene.usageIndex} />
 * ```
 */
export function SceneSettingsSummary({ usageIndex }: SceneSettingsSummaryProps) {
  const config = useAnalysisStore((s) => s.analysisConfigs[usageIndex]);
  const run = useSceneWorkflowStore((s) => s.runs[usageIndex]);
  const ttsLanguage = useAudioControlsStore((s) => s.ttsLanguage);

  const rows = useMemo(
    () => (config?.type === 'scenario' ? getSceneSettingsRows(config, run, ttsLanguage) : []),
    [config, run, ttsLanguage],
  );

  return <SettingsSummary tone="neutral" title="Scene settings" rows={rows} />;
}
