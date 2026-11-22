/**
 * Scenario speech / people helpers — stateless, shared by analysisStore,
 * sceneWorkflowStore and the scene / settings components.
 */

import type { ScenarioConfig } from '@/types/analysis';

/**
 * True when the scenario gets no speech agent: the user turned speech off, or
 * the scenarist decided nobody talks (prompt asked for "no voices", or no people).
 * The user's `includeSpeech` choice is never overwritten, so a regenerated
 * scenario with people talking gets its speech back.
 */
export function isScenarioSpeechSkipped(sc: ScenarioConfig | null | undefined): boolean {
  if (!sc) return false;
  if (sc.includeSpeech === false) return true;
  const scenario = sc.scenarioResult?.scenarios?.[0];
  return scenario?.hasSpeech === false || scenario?.peopleCount === 0;
}

/** The speech step needs no (more) work: skipped, or at least one speech block exists. */
export function isScenarioSpeechDone(sc: ScenarioConfig | null | undefined): boolean {
  return isScenarioSpeechSkipped(sc) || (sc?.speechResult?.speeches?.length ?? 0) > 0;
}

/**
 * People shown in settings summaries: the requested count, else the count the
 * scenarist inferred ("5 · 2 adults, 3 children"), else "Auto".
 */
export function formatScenarioPeople(sc: ScenarioConfig): string {
  const scenario = sc.scenarioResult?.scenarios?.[0];
  const count = sc.peopleCount ?? scenario?.peopleCount;
  if (count == null) return 'Auto';
  const who = scenario?.peopleDescription?.trim();
  const auto = sc.peopleCount == null ? ' (auto)' : '';
  return who ? `${count}${auto} · ${who}` : `${count}${auto}`;
}
