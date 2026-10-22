import { beforeEach, describe, expect, it, vi } from 'vitest';

// The viewer cannot load in Node; the stores only reference its extension classes.
vi.mock('@speckle/viewer', () => ({
  FilteringExtension: class {},
  CameraController: class {},
  SelectionExtension: class {},
  Viewer: class {},
}));
import { useSoundscapeStore, useAudioControlsStore } from '@/store';
import type { SoundEvent, SoundGenerationConfig } from '@/types';

const config = (id: string, name: string): SoundGenerationConfig =>
  ({ config_id: id, prompt: '', display_name: name, type: 'upload' }) as unknown as SoundGenerationConfig;

const event = (id: string, configId: string, promptIndex: number, name: string): SoundEvent =>
  ({ id, config_id: configId, prompt_index: promptIndex, display_name: name }) as unknown as SoundEvent;

/** Every event must point at its own card: same config_id at index prompt_index. */
function expectEventsFollowCards() {
  const { soundConfigs, generatedSounds, soundscapeData } = useSoundscapeStore.getState();
  for (const s of [...generatedSounds, ...(soundscapeData ?? [])] as SoundEvent[]) {
    const pi = s.prompt_index ?? -1;
    const cardIdx = pi >= 10000 ? Math.floor(pi / 10000) : pi;
    expect(soundConfigs[cardIdx]?.config_id).toBe(s.config_id);
  }
}

beforeEach(() => {
  const events = [
    event('a0', 'A', 0, 'Alpha'),
    event('b0', 'B', 1, 'Bravo'),
    event('c0', 'C', 2, 'Charlie'),
    // Speech-line TTS sound encoded as cardIndex * 10000 + line.
    event('c1', 'C', 20001, 'Charlie'),
  ];
  useSoundscapeStore.setState({
    soundConfigs: [config('A', 'Alpha'), config('B', 'Bravo'), config('C', 'Charlie')],
    generatedSounds: events,
    soundscapeData: events,
  });
  useAudioControlsStore.setState({ selectedVariants: { 0: 1 } });
});

describe('sound card reorder', () => {
  it('moves generated sounds and variant selection with their card', () => {
    useSoundscapeStore.getState().handleReorderSoundConfigs(0, 2);

    const { soundConfigs, generatedSounds } = useSoundscapeStore.getState();
    expect(soundConfigs.map((c) => c.config_id)).toEqual(['B', 'C', 'A']);
    expectEventsFollowCards();
    expect(generatedSounds.find((s) => s.id === 'c1')?.prompt_index).toBe(10001);
    // Card A (selected variant 1) moved from index 0 to 2.
    expect(useAudioControlsStore.getState().selectedVariants).toEqual({ 2: 1 });
  });

  it('renaming after a reorder only renames that card and its own sounds', () => {
    const store = useSoundscapeStore.getState();
    store.handleReorderSoundConfigs(0, 2);
    store.handleReorderSoundConfigs(2, 1);
    useSoundscapeStore.getState().handleUpdateConfig(1, 'display_name', 'Renamed A');

    const { soundConfigs, generatedSounds } = useSoundscapeStore.getState();
    expect(soundConfigs.map((c) => c.display_name)).toEqual(['Bravo', 'Renamed A', 'Charlie']);
    const nameById = Object.fromEntries(generatedSounds.map((s) => [s.id, s.display_name]));
    expect(nameById).toEqual({ a0: 'Renamed A', b0: 'Bravo', c0: 'Charlie', c1: 'Charlie' });
    expectEventsFollowCards();
  });

  it('rename matches by config_id even when prompt_index is stale', () => {
    // Stale save: card A's sound claims index 1 (card B's position).
    useSoundscapeStore.setState({
      generatedSounds: [event('a0', 'A', 1, 'Alpha'), event('b0', 'B', 1, 'Bravo')],
      soundscapeData: null,
    });
    useSoundscapeStore.getState().handleUpdateConfig(1, 'display_name', 'New B');

    const nameById = Object.fromEntries(
      useSoundscapeStore.getState().generatedSounds.map((s) => [s.id, s.display_name]),
    );
    expect(nameById).toEqual({ a0: 'Alpha', b0: 'New B' });
  });
});
