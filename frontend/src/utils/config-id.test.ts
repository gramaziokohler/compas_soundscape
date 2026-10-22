import { describe, expect, it } from 'vitest';
import { cardEventId, configIdsByPromptIndex, remapEventIdToConfig } from './config-id';
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

describe('remapEventIdToConfig', () => {
  it('swaps the card key and keeps prefix, copy and TTS voice', () => {
    const gen = remapEventIdToConfig(cardEventId('generated', 'old', 2), 'old', 'new', 2);
    const tts = remapEventIdToConfig(cardEventId('tts', 'old', 1, 'Kore'), 'old', 'new', 1);
    expect(gen).toBe(cardEventId('generated', 'new', 2));
    expect(tts).toBe(cardEventId('tts', 'new', 1, 'Kore'));
    expect(parseSoundCopyIndex(gen)).toBe(2);
    expect(parseSoundCopyIndex(tts)).toBe(1);
  });

  it('keeps sed- / duplicate- shapes', () => {
    expect(remapEventIdToConfig('sed-old-3', 'old', 'new', 3)).toBe('sed-new-3');
    expect(remapEventIdToConfig('duplicate-old-0', 'old', 'new', 0)).toBe('duplicate-new-0');
  });

  it('re-keys legacy card-index ids and falls back to a fresh generated id', () => {
    expect(remapEventIdToConfig('generated_4_1', 'old', 'new', 1)).toBe('generated_new_1');
    expect(remapEventIdToConfig('weird', 'old', 'new', 2)).toBe(cardEventId('generated', 'new', 2));
  });
});
