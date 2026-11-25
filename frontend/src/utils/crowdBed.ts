/**
 * Crowd murmur bed — fills a social scene with the people who are present but
 * have no lines.
 *
 * The speech agent voices the conversations the scenario shows; the rest of the
 * room (other tables, people waiting, a group further away) would still be heard
 * as indistinct voices. The foley agent picks that sound (foley rule 15): a
 * recording from the catalogue's "crowds" category when one fits (e.g. "Crowd
 * Talking", "Voices Murmur", "Voices On Street Accent"), else a Text-to-Audio
 * prompt. When the agent gives neither, the liveliness default recording
 * (CROWD_BED.FALLBACK_CATALOG_NAME) is used. When a scene with speech has enough silent people for its atmosphere,
 * a non-spatial background entry is appended to the foley result: a catalog
 * card for a recording, a generated card for a prompt.
 */

import type {
  FoleyCrowdChoice, FoleyResult, FoleySoundEvent, ScenarioItem, SceneLiveliness, SpeechResult,
} from '@/types/analysis';
import type { CatalogSoundSelection } from '@/types';
import {
  CROWD_BED, CROWD_CATALOG_SOUNDS, DEFAULT_SCENE_LIVELINESS, SCENE_LIVELINESS_OPTIONS,
} from '@/utils/constants';

export interface CrowdBedInput {
  scenario: ScenarioItem | undefined;
  foley: FoleyResult | null | undefined;
  speech: SpeechResult | null | undefined;
  liveliness?: SceneLiveliness;
  /** False when the user turned speech off for this scene. */
  includeSpeech?: boolean;
  /** The crowd recordings the foley agent chose from. Default: the baked CROWD_CATALOG_SOUNDS. */
  catalog?: readonly CatalogSoundSelection[];
}

/** Names sent to the foley agent as `crowd_catalog` (it picks the crowd voices from them). */
export function crowdCatalogNames(): string[] {
  return CROWD_CATALOG_SOUNDS.map((s) => s.name);
}

/** People present who have no speaking part (never negative). */
export function silentPeopleCount(scenario: ScenarioItem | undefined, speech: SpeechResult | null | undefined): number {
  const people = scenario?.peopleCount ?? 0;
  const speakers = new Set(
    (speech?.speeches ?? []).map((s) => (s.character || s.id).trim().toLowerCase()).filter(Boolean),
  );
  return Math.max(0, people - speakers.size);
}

function isBed(sound: FoleySoundEvent): boolean {
  const cat = (sound.category ?? '').toLowerCase().replace(/[\s-]+/g, '_');
  return cat === 'background' || cat === 'background_sound';
}

/** Mean position of the speakers (where the people are), else the room origin at ear height. */
function crowdPosition(speech: SpeechResult | null | undefined): number[] {
  const points = (speech?.speeches ?? []).map((s) => s.position).filter((p) => Array.isArray(p) && p.length >= 3);
  if (points.length === 0) return [0, 0, 1.5];
  return [0, 1, 2].map((axis) => points.reduce((sum, p) => sum + p[axis], 0) / points.length);
}

/** The catalogue recording the agent named (case / spacing insensitive), if any. */
export function matchCatalogSound(
  choice: FoleyCrowdChoice | null | undefined,
  catalog: readonly CatalogSoundSelection[] | undefined,
): CatalogSoundSelection | undefined {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const wanted = norm(choice?.catalogName ?? '');
  if (!wanted) return undefined;
  return (catalog ?? []).find((s) => norm(s.name) === wanted);
}

/**
 * The crowd murmur bed to add to this scene, or `null` when none is needed:
 * no speech in the scene, too few silent people for the atmosphere, or the foley
 * agent already added a murmur / chatter bed.
 */
export function buildCrowdBed({
  scenario, foley, speech, liveliness, includeSpeech, catalog = CROWD_CATALOG_SOUNDS,
}: CrowdBedInput): FoleySoundEvent | null {
  if (!scenario || scenario.hasSpeech === false || includeSpeech === false) return null;
  const level = SCENE_LIVELINESS_OPTIONS.find((o) => o.value === (liveliness ?? DEFAULT_SCENE_LIVELINESS))
    ?? SCENE_LIVELINESS_OPTIONS[1];
  const silent = silentPeopleCount(scenario, speech);
  if (silent < level.crowdMinSilentPeople) return null;

  const sounds = (foley?.scenarios ?? []).flatMap((s) => s.sound_events);
  const covered = sounds.some((s) => isBed(s) && CROWD_BED.EXISTING_BED_PATTERN.test(`${s.soundName} ${s.description}`));
  if (covered || sounds.some((s) => s.id === CROWD_BED.ENTRY_ID)) return null;

  const agentPrompt = foley?.crowd?.prompt?.trim() ?? '';
  // A recording is preferred over Text-to-Audio: when the agent named none that
  // matches and wrote no prompt of its own, use the liveliness default recording.
  const recording = matchCatalogSound(foley?.crowd, catalog)
    ?? (agentPrompt ? undefined : matchCatalogSound(
      { catalogName: CROWD_BED.FALLBACK_CATALOG_NAME[level.value], prompt: '' }, catalog,
    ));
  const prompt = agentPrompt
    || (silent >= CROWD_BED.LARGE_GROUP_SIZE ? CROWD_BED.LARGE_DESCRIPTION : CROWD_BED.SMALL_DESCRIPTION);

  return {
    id: CROWD_BED.ENTRY_ID,
    soundName: recording ? recording.name : CROWD_BED.SOUND_NAME,
    description: recording ? recording.name : prompt,
    duration: CROWD_BED.DURATION,
    timestamps: ['00:00'],
    category: 'background sound',
    objectsInvolved: [],
    position: crowdPosition(speech),
    spl: `${level.crowdBedDbfs} dBFS`,
    spatial: false,
    copyCount: 1,
    ...(recording ? { catalogSound: recording } : {}),
  };
}

/**
 * Foley result with the crowd bed appended to its first scenario, plus the
 * selection key that makes it a card (`<scenario title>__<sound name>`), or
 * `null` when no bed is needed.
 */
export function withCrowdBed(input: CrowdBedInput): { foley: FoleyResult; key: string } | null {
  const bed = buildCrowdBed(input);
  const first = input.foley?.scenarios?.[0];
  if (!bed || !input.foley || !first) return null;
  return {
    foley: {
      ...input.foley,
      scenarios: [{ ...first, sound_events: [...first.sound_events, bed] }, ...input.foley.scenarios.slice(1)],
    },
    key: `${first.scenario_title}__${bed.soundName}`,
  };
}
