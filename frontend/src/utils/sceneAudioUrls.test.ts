import { describe, expect, it } from 'vitest';
import { collectUnsharedSceneAudioUrls } from './sceneAudioUrls';

describe('collectUnsharedSceneAudioUrls', () => {
  const owned = (pi: number | null | undefined) => pi === 0 || (pi !== null && pi !== undefined && Math.floor(pi / 10000) === 0 && pi >= 10000);

  it('keeps files another scene (e.g. a duplicate) still plays', () => {
    const urls = collectUnsharedSceneAudioUrls(
      [
        { url: '/a.wav', prompt_index: 0 },
        { url: '/shared.wav', prompt_index: 0 },
        { url: '/shared.wav', prompt_index: 3 },
        { url: '/other.wav', prompt_index: 3 },
      ],
      owned,
    );
    expect(urls).toEqual(['/a.wav']);
  });

  it('skips blob and empty urls', () => {
    expect(
      collectUnsharedSceneAudioUrls(
        [{ url: 'blob:x', prompt_index: 0 }, { url: '', prompt_index: 0 }, { prompt_index: 0 }],
        owned,
      ),
    ).toEqual([]);
  });
});
