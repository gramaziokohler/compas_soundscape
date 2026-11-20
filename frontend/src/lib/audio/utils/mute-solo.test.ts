import { describe, it, expect } from 'vitest';
import { audibleSoundsInScene, computeMuteSolo, isTrackMuted, isTrackSoloed, soundsInActiveScene } from './mute-solo';

// Two scenes: cards 0,1 in scene 10; card 2 in scene 20. Card 0 has two variants.
const cards = [{ parentUsageOriginalIndex: 10 }, { parentUsageOriginalIndex: 10 }, { parentUsageOriginalIndex: 20 }];
const sounds = [
  { id: 'a1', prompt_index: 0 },
  { id: 'a2', prompt_index: 0 },
  { id: 'b', prompt_index: 1 },
  { id: 'c', prompt_index: 2 },
];
const none = new Set<string>();

describe('computeMuteSolo', () => {
  it('nothing silenced by default', () => {
    expect(computeMuteSolo(sounds, none, none).silencedIds.size).toBe(0);
  });

  it('a muted variant mutes its whole track, including variants added later', () => {
    const state = computeMuteSolo(sounds, new Set(['a1']), none);
    expect([...state.silencedIds].sort()).toEqual(['a1', 'a2']);
    expect(isTrackMuted(state, 'a2')).toBe(true);
    expect(state.silencedPrompts).toEqual(new Set([0]));
  });

  it('solo silences the other tracks of the scope', () => {
    const scene = soundsInActiveScene(sounds, cards, 10);
    const state = computeMuteSolo(scene, none, new Set(['b']));
    expect([...state.silencedIds].sort()).toEqual(['a1', 'a2']);
    expect(isTrackSoloed(state, 'b')).toBe(true);
  });

  it('a solo in another scene does not silence this scene', () => {
    const sceneB = soundsInActiveScene(sounds, cards, 20);
    const state = computeMuteSolo(sceneB, none, new Set(['a1', 'a2']));
    expect(state.soloActive).toBe(false);
    expect(state.silencedIds.size).toBe(0);
  });

  it('pending placeholders are never silenced', () => {
    const state = computeMuteSolo([...sounds, { id: 'pending_3', prompt_index: 3, isPending: true }], none, new Set(['b']));
    expect(state.silencedIds.has('pending_3')).toBe(false);
  });

  it('audibleSoundsInScene keeps only audible sounds of the active scene', () => {
    expect(audibleSoundsInScene(sounds, cards, 10, new Set(['b']), none).map((s) => s.id)).toEqual(['a1', 'a2']);
    expect(audibleSoundsInScene(sounds, cards, 20, none, new Set(['b'])).map((s) => s.id)).toEqual(['c']);
  });
});
