/**
 * Scenario object references — parsing the "Name (id:hex…)" tokens the
 * scenarist writes into event descriptions, and building the 3D scenario
 * preview (highlighted objects + parcours) from them.
 *
 * Shared by the expert scenario card (ScenarioContent) and the Simple-mode
 * highlight owner (useSimpleSceneHighlights).
 */

import type { ScenarioConfig } from '@/types/analysis';
import type { ScenarioPreviewParcours, ScenarioPreviewStop } from '@/store/scenarioPreviewStore';

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
export const OBJECT_REF_RE = /['"]?([A-Za-z][A-Za-z]*(?:\s+(?:and\s+[A-Z][A-Za-z]*|[A-Z][A-Za-z]*))*)['"]?(?:\s*\([^)]*\))?\s*\((?:e\.g\.,\s*)?(?:\w+:\s*(?:id:\s*)?)?[0-9a-fA-F]+(?:\s*(?:,|and)\s*(?:\w+:\s*(?:id:\s*)?)?[0-9a-fA-F]+)*\)/g;
export const ID_HEX_RE = /[0-9a-fA-F]{8,}/g;
/** Normalize dot-separated object refs (LLM hallucination): Doors.hexid → Doors (id:hexid) */
export const ID_HEX_DOT_RE = /\b([A-Z][A-Za-z0-9]+(?:\s+[A-Z][A-Za-z0-9]+)*)\.([0-9a-fA-F]{24,64})\b/g;

/** Extract all hex IDs from the full matched token (including the parenthesised id-list). */
export function extractIdsFromToken(raw: string): string[] {
  return Array.from(raw.matchAll(ID_HEX_RE), (m) => m[0]);
}

/** Extract the object IDs referenced in a single scenario event description (same regex as ScenarioTextRenderer). */
export function extractEventObjectIds(description: string): string[] {
  const ids: string[] = [];
  const normalizedText = (description ?? '').replace(ID_HEX_DOT_RE, '$1 (id:$2)');
  const re = new RegExp(OBJECT_REF_RE.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(normalizedText)) !== null) {
    for (const id of extractIdsFromToken(match[0])) {
      if (id && !ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

/** All object-ID references in event order, WITHOUT deduplication — one parcours
 *  stop per occurrence, so repeated objects produce repeated waypoints. */
export function extractEventObjectOccurrences(description: string): string[] {
  const ids: string[] = [];
  const normalizedText = (description ?? '').replace(ID_HEX_DOT_RE, '$1 (id:$2)');
  const re = new RegExp(OBJECT_REF_RE.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(normalizedText)) !== null) {
    ids.push(...extractIdsFromToken(match[0]));
  }
  return ids;
}

/** Collect every object ID referenced in the scenario event descriptions (same regex as ScenarioTextRenderer). */
export function extractScenarioObjectIds(scenarioResult: ScenarioConfig['scenarioResult']): string[] {
  const ids: string[] = [];
  for (const scenario of scenarioResult?.scenarios ?? []) {
    for (const event of scenario.events ?? []) {
      for (const id of extractEventObjectIds(event.description)) {
        if (!ids.includes(id)) ids.push(id);
      }
    }
  }
  return ids;
}

/**
 * The 3D scenario preview of a scenario card: every referenced object (plus the
 * foley-involved objects as a fallback) and one parcours per scenario — one stop
 * per object REFERENCE in textual order (repeated mentions yield repeated stops).
 */
export function buildScenarioPreview(
  config: Pick<ScenarioConfig, 'scenarioResult' | 'foleyResult'>,
): { objectIds: string[]; parcours: ScenarioPreviewParcours } {
  const objectIds = extractScenarioObjectIds(config.scenarioResult);
  const parcours: ScenarioPreviewParcours = [];
  for (const scenario of config.scenarioResult?.scenarios ?? []) {
    const stops: ScenarioPreviewStop[] = [];
    for (const event of scenario.events ?? []) {
      for (const id of extractEventObjectOccurrences(event.description)) {
        stops.push({ id });
      }
    }
    // Fallback: add foley-involved objects (which the viewer can always resolve)
    // when the scenario descriptions carry no object references.
    const foleyScenario = config.foleyResult?.scenarios.find(
      (fs) => fs.scenario_title === scenario.title,
    );
    for (const evt of foleyScenario?.sound_events ?? []) {
      for (const id of evt.objectsInvolved ?? []) {
        if (id && !objectIds.includes(id)) objectIds.push(id);
      }
    }
    if (stops.length > 0) parcours.push(stops);
  }
  return { objectIds, parcours };
}
