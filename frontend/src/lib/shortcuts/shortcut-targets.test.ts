import { describe, it, expect, afterEach } from 'vitest';
import {
  registerShortcutTarget,
  getShortcutTarget,
  resolvePlaybackTarget,
  setPreferredPlaybackTarget,
  clearPreferredPlaybackTarget,
  type PlaybackTarget,
} from './shortcut-targets';

const target = (canToggle: boolean): PlaybackTarget => ({ canToggle: () => canToggle, toggle: () => {} });

const cleanups: Array<() => void> = [];
const register = (slot: 'cardPreview' | 'timeline', t: PlaybackTarget) => {
  const unregister = registerShortcutTarget(slot, t);
  cleanups.push(unregister);
  return unregister;
};

afterEach(() => {
  cleanups.splice(0).forEach((fn) => fn());
  clearPreferredPlaybackTarget('timeline');
  clearPreferredPlaybackTarget('cardPreview');
});

describe('resolvePlaybackTarget', () => {
  it('returns undefined when nothing is registered', () => {
    expect(resolvePlaybackTarget()).toBeUndefined();
  });

  it('prefers a playable expanded card over the timeline', () => {
    const card = target(true);
    register('timeline', target(true));
    register('cardPreview', card);
    expect(resolvePlaybackTarget()).toBe(card);
  });

  it('falls back to the timeline when the expanded card has no audio', () => {
    const timeline = target(true);
    register('cardPreview', target(false));
    register('timeline', timeline);
    expect(resolvePlaybackTarget()).toBe(timeline);
  });

  it('prefers the timeline when it was clicked last', () => {
    const timeline = target(true);
    register('cardPreview', target(true));
    register('timeline', timeline);
    setPreferredPlaybackTarget('timeline');
    expect(resolvePlaybackTarget()).toBe(timeline);
  });

  it('a later card click takes Space back from the timeline', () => {
    const card = target(true);
    register('cardPreview', card);
    register('timeline', target(true));
    setPreferredPlaybackTarget('timeline');
    setPreferredPlaybackTarget('cardPreview');
    expect(resolvePlaybackTarget()).toBe(card);
  });

  it('ignores a preferred target that cannot play', () => {
    const card = target(true);
    register('cardPreview', card);
    register('timeline', target(false));
    setPreferredPlaybackTarget('timeline');
    expect(resolvePlaybackTarget()).toBe(card);
  });

  it('clearing the preference restores the default order', () => {
    const card = target(true);
    register('cardPreview', card);
    register('timeline', target(true));
    setPreferredPlaybackTarget('timeline');
    clearPreferredPlaybackTarget('timeline');
    expect(resolvePlaybackTarget()).toBe(card);
  });

  it('returns undefined when neither can play', () => {
    register('cardPreview', target(false));
    register('timeline', target(false));
    expect(resolvePlaybackTarget()).toBeUndefined();
  });
});

describe('registerShortcutTarget', () => {
  it('a stale unregister does not remove a newer registration', () => {
    const first = target(true);
    const second = target(true);
    const unregisterFirst = register('timeline', first);
    register('timeline', second);
    unregisterFirst();
    expect(getShortcutTarget('timeline')).toBe(second);
  });
});
