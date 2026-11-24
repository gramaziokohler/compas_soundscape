import { describe, it, expect } from 'vitest';
import { buildCrowdBed, silentPeopleCount, withCrowdBed } from './crowdBed';
import type { FoleyResult, ScenarioItem, SpeechResult } from '@/types/analysis';
import { CROWD_BED } from '@/utils/constants';

const scenario = (peopleCount: number, hasSpeech = true): ScenarioItem => ({
  title: 'Café', duration: '0:30', peopleCount, hasSpeech, likeliness: 9, events: [],
});

const speech = (...names: string[]): SpeechResult => ({
  speechId: 's',
  speeches: names.map((n, i) => ({ id: `${n}_1`, character: n, script: 'Hi', timestamps: ['00:01'], position: [i, 0, 1.25] })),
});

const foley = (beds: string[] = []): FoleyResult => ({
  foleyId: 'f',
  scenarios: [{
    scenario_title: 'Café',
    sound_events: beds.map((name, i) => ({
      id: `bed_${i}`, soundName: name, description: name, duration: '00:30', timestamps: ['00:00'],
      category: 'background sound', objectsInvolved: [], position: [0, 0, 1.5], spl: '-42 dBFS',
    })),
  }],
});

describe('crowd murmur bed', () => {
  it('counts the people without a speaking part', () => {
    expect(silentPeopleCount(scenario(8), speech('Felix', 'Chloe', 'Alex', 'Lucas'))).toBe(4);
    expect(silentPeopleCount(scenario(2), speech('Felix', 'Chloe', 'Alex'))).toBe(0);
  });

  it('adds a bed when enough people are silent for the atmosphere', () => {
    const input = { scenario: scenario(8), foley: foley(['cafe room tone']), speech: speech('Felix', 'Chloe', 'Alex', 'Lucas') };
    expect(buildCrowdBed({ ...input, liveliness: 'calm' })?.id).toBe(CROWD_BED.ENTRY_ID); // 4 silent ≥ 4
    expect(buildCrowdBed({ ...input, scenario: scenario(6), liveliness: 'calm' })).toBeNull(); // 2 silent < 4
    expect(buildCrowdBed({ ...input, scenario: scenario(6), liveliness: 'lively' })).not.toBeNull(); // 2 ≥ 2
  });

  it('describes a large crowd as a busy room', () => {
    const bed = buildCrowdBed({ scenario: scenario(30), foley: foley(), speech: speech('A') });
    expect(bed?.description).toBe(CROWD_BED.LARGE_DESCRIPTION);
    expect(bed?.category).toBe('background sound');
  });

  it('adds nothing without speech or when a murmur bed already exists', () => {
    const base = { scenario: scenario(10), foley: foley(), speech: speech('A') };
    expect(buildCrowdBed({ ...base, scenario: scenario(10, false) })).toBeNull();
    expect(buildCrowdBed({ ...base, includeSpeech: false })).toBeNull();
    expect(buildCrowdBed({ ...base, foley: foley(['distant chatter']) })).toBeNull();
  });

  it('appends the bed to the first foley scenario with its selection key', () => {
    const added = withCrowdBed({ scenario: scenario(10), foley: foley(['room tone']), speech: speech('A') });
    expect(added?.key).toBe(`Café__${CROWD_BED.SOUND_NAME}`);
    expect(added?.foley.scenarios[0].sound_events.map((s) => s.id)).toEqual(['bed_0', CROWD_BED.ENTRY_ID]);
  });
});
