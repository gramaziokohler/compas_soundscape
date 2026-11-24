/**
 * Crowd murmur bed — fills a social scene with the people who are present but
 * have no lines.
 *
 * The speech agent voices the conversations the scenario shows; the rest of the
 * room (other tables, people waiting, a group further away) would still be heard
 * as indistinct voices. When a scene with speech has enough such silent people,
 * a non-spatial "crowd murmur" background bed is appended to the foley result,
 * so it becomes a normal background card (generated, levelled and orchestrated
 * like any other bed). The threshold and level follow the scene atmosphere.
 */

import type { FoleyResult, FoleySoundEvent, ScenarioItem, SceneLiveliness, SpeechResult } from '@/types/analysis';
import { CROWD_BED, DEFAULT_SCENE_LIVELINESS, SCENE_LIVELINESS_OPTIONS } from '@/utils/constants';

export interface CrowdBedInput {
  scenario: ScenarioItem | undefined;
  foley: FoleyResult | null | undefined;
  speech: SpeechResult | null | undefined;
  liveliness?: SceneLiveliness;
  /** False when the user turned speech off for this scene. */
  includeSpeech?: boolean;
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

/**
 * The crowd murmur bed to add to this scene, or `null` when none is needed:
 * no speech in the scene, too few silent people for the atmosphere, or the foley
 * agent already added a murmur / chatter bed.
 */
export function buildCrowdBed({ scenario, foley, speech, liveliness, includeSpeech }: CrowdBedInput): FoleySoundEvent | null {
  if (!scenario || scenario.hasSpeech === false || includeSpeech === false) return null;
  const level = SCENE_LIVELINESS_OPTIONS.find((o) => o.value === (liveliness ?? DEFAULT_SCENE_LIVELINESS))
    ?? SCENE_LIVELINESS_OPTIONS[1];
  const silent = silentPeopleCount(scenario, speech);
  if (silent < level.crowdMinSilentPeople) return null;

  const sounds = (foley?.scenarios ?? []).flatMap((s) => s.sound_events);
  const covered = sounds.some((s) => isBed(s) && CROWD_BED.EXISTING_BED_PATTERN.test(`${s.soundName} ${s.description}`));
  if (covered || sounds.some((s) => s.id === CROWD_BED.ENTRY_ID)) return null;

  return {
    id: CROWD_BED.ENTRY_ID,
    soundName: CROWD_BED.SOUND_NAME,
    description: silent >= CROWD_BED.LARGE_GROUP_SIZE ? CROWD_BED.LARGE_DESCRIPTION : CROWD_BED.SMALL_DESCRIPTION,
    duration: CROWD_BED.DURATION,
    timestamps: ['00:00'],
    category: 'background sound',
    objectsInvolved: [],
    position: crowdPosition(speech),
    spl: `${level.crowdBedDbfs} dBFS`,
    spatial: false,
    copyCount: 1,
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
