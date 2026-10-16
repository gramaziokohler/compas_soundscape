import { describe, expect, it } from 'vitest';
import { cardEventId, configIdsByPromptIndex } from './config-id';
import { parseSoundCopyIndex, resolveVariantSoundId } from '@/lib/audio/utils/variant-sound-id';

describe('cardEventId', () => {
  it('keys ids on the config_id, never the card index', () => {
    expect(cardEventId('generated', 'abc-123', 2)).toBe('generated_abc-123_2');
    expect(cardEventId('tts', 'abc-123', 1, 'Kore')).toBe('tts_abc-123_1_Kore');
  });

  it('strips underscores from the key so id parsers still find the copy segment', () => {
    const gen = cardEventId('generated', 'cfg_x_y', 3);
    const tts = cardEventId('tts', 'cfg_x_y', 4, 'Kore');
    expect(parseSoundCopyIndex(gen)).toBe(3);
    expect(parseSoundCopyIndex(tts)).toBe(4);
    expect(resolveVariantSoundId(gen, 1)).toBe(cardEventId('generated', 'cfg_x_y', 1));
    expect(resolveVariantSoundId(tts, 0)).toBe(cardEventId('tts', 'cfg_x_y', 0, 'Kore'));
  });

  it('two cards never share an id, whatever their indices', () => {
    expect(cardEventId('generated', 'a', 0)).not.toBe(cardEventId('generated', 'b', 0));
  });

  it('falls back to a fresh unique key when the card has no config_id', () => {
    expect(cardEventId('generated', undefined, 0)).not.toBe(cardEventId('generated', undefined, 0));
  });
});

describe('configIdsByPromptIndex', () => {
  it('skips cards without a config_id', () => {
    expect(configIdsByPromptIndex([[0, 'a'], [1, undefined], [5, 'b']])).toEqual({ 0: 'a', 5: 'b' });
  });
});
