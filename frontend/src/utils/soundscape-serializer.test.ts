import { describe, expect, it } from 'vitest';
import { restoreSoundscapeState } from './soundscape-serializer';
import type { SoundscapeData } from '@/types/soundscape';

/** A save written after cards were reordered without remapping prompt_index. */
function staleSave(): SoundscapeData {
  const savedConfig = (index: number, id: string, name: string, type = 'upload') => ({
    index, config_id: id, display_name: name, type, prompt: '', duration: 5, seed_copies: 1, steps: 50,
  });
  const savedEvent = (id: string, configId: string, promptIndex: number, name: string) => ({
    id, config_id: configId, prompt_index: promptIndex, display_name: name,
    audio_filename: `${id}.wav`, position: [0, 0, 0], volume_dbfs: -18, is_uploaded: true,
  });
  return {
    global_settings: { duration: 5, steps: 50, negative_prompt: '', audio_model: 'x' },
    sound_configs: [
      savedConfig(0, 'A', 'Alpha'),
      savedConfig(1, 'B', 'Bravo'),
      savedConfig(2, 'C', 'Charlie', 'text-to-speech'),
    ],
    // A's sound claims card 1, B's claims card 0, C's speech line claims card 0.
    sound_events: [
      savedEvent('a0', 'A', 1, 'Bravo'),
      savedEvent('b0', 'B', 0, 'Alpha'),
      savedEvent('c1', 'C', 1, 'Alpha'),
      savedEvent('c2', 'C', 10, 'Alpha'),
    ],
  } as unknown as SoundscapeData;
}

describe('restoreSoundscapeState', () => {
  it('re-links sounds with a stale prompt_index to their card via config_id', () => {
    const save = staleSave();
    // Speech-line encoding: card 0, line 1 — stale, belongs to card C (index 2).
    (save.sound_events[3] as { prompt_index: number }).prompt_index = 10001;
    const { soundEvents } = restoreSoundscapeState(save, '/audio');
    const byId = Object.fromEntries(soundEvents.map((e) => [e.id, e]));

    expect(byId.a0).toMatchObject({ prompt_index: 0, display_name: 'Alpha' });
    expect(byId.b0).toMatchObject({ prompt_index: 1, display_name: 'Bravo' });
    expect(byId.c1).toMatchObject({ prompt_index: 2, display_name: 'Charlie' });
    expect(byId.c2).toMatchObject({ prompt_index: 20001, display_name: 'Charlie' });
  });

  it('re-attaches an upload card clip from its own sound, not the stale index', () => {
    const { soundConfigs } = restoreSoundscapeState(staleSave(), '/audio');
    expect(soundConfigs[0].uploadedAudioUrl).toBe('/audio/a0.wav');
    expect(soundConfigs[1].uploadedAudioUrl).toBe('/audio/b0.wav');
  });
});

describe('wave-based (PFFDTD) free positioning settings', () => {
  const saveWith = (settings: Record<string, unknown> | undefined): SoundscapeData => ({
    ...staleSave(),
    simulation_configs: [{ id: 'w1', display_name: 'Wave', type: 'pffdtd', state: 'before-simulation', settings }],
  }) as unknown as SoundscapeData;

  const restoredSettings = (settings: Record<string, unknown> | undefined) => {
    const cfg = restoreSoundscapeState(saveWith(settings), '/audio').simulationConfigs[0];
    if (cfg.type !== 'pffdtd') throw new Error('expected a wave-based card');
    return cfg.settings;
  };

  it('restores the free mode and grid spacing', () => {
    expect(restoredSettings({ simulation_mode: 'foa', free_mode: 'source', free_grid_spacing: 0.75 }))
      .toMatchObject({ free_mode: 'source', free_grid_spacing: 0.75 });
  });

  it('defaults older or invalid saves to off at the default spacing', () => {
    expect(restoredSettings({ simulation_mode: 'mono' })).toMatchObject({ free_mode: 'off', free_grid_spacing: 0.5 });
    expect(restoredSettings({ simulation_mode: 'mono', free_mode: 'sideways' })).toMatchObject({ free_mode: 'off' });
  });
});
