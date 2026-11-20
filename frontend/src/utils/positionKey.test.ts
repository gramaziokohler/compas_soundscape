import { describe, expect, it } from 'vitest';
import {
  computePositionKey,
  computeSourceKey,
  directivityKeySuffix,
  groupSimulationSources,
  groupSoundsByPosition,
  isDirectionalSourceKey,
  isOmniDirectivity,
  parsePositionKey,
  positionKeyBase,
} from './positionKey';

const cardioid = { id: 'cardioid', yaw: 0.5, pitch: 0, roll: 0 };

describe('source keys with directivity', () => {
  it('omni sources keep the bare position key', () => {
    const pos: [number, number, number] = [1.2, 2.6, 0.4];
    expect(computeSourceKey(pos)).toBe(computePositionKey(pos));
    expect(computeSourceKey(pos, { id: 'omni', yaw: 1, pitch: 0, roll: 0 })).toBe(computePositionKey(pos));
    expect(isOmniDirectivity(undefined)).toBe(true);
    expect(isOmniDirectivity(cardioid)).toBe(false);
  });

  it('directional sources append a stable ~d suffix that parses back to the position', () => {
    const pos: [number, number, number] = [1.2, 2.6, 0.4];
    const key = computeSourceKey(pos, cardioid);
    expect(key).toMatch(/^pos_1\.00_2\.50_0\.50~d[0-9a-f]{8}$/);
    expect(isDirectionalSourceKey(key)).toBe(true);
    expect(positionKeyBase(key)).toBe(computePositionKey(pos));
    expect(parsePositionKey(key)).toEqual([1.0, 2.5, 0.5]);
    expect(parsePositionKey('r-uuid-1')).toBeNull();
    // same directivity, same suffix; different orientation / id, different suffix
    expect(directivityKeySuffix({ ...cardioid })).toBe(directivityKeySuffix(cardioid));
    expect(directivityKeySuffix({ ...cardioid, yaw: 0.6 })).not.toBe(directivityKeySuffix(cardioid));
    expect(directivityKeySuffix({ ...cardioid, id: 'figure_eight' })).not.toBe(directivityKeySuffix(cardioid));
    // sub-quantisation jitter does not change the key
    expect(directivityKeySuffix({ ...cardioid, yaw: 0.5 + 1e-7 })).toBe(directivityKeySuffix(cardioid));
  });

  it('groups co-located sounds by directivity', () => {
    const pos: [number, number, number] = [0, 0, 1.5];
    const { uniquePositions, soundToPosKey, sourceDirectivities } = groupSoundsByPosition([
      { id: 'a', position: pos },
      { id: 'b', position: pos, directivity: cardioid },
      { id: 'c', position: pos, directivity: { ...cardioid } },
      { id: 'd', position: pos, directivity: { id: 'omni', yaw: 0, pitch: 0, roll: 0 } },
    ]);
    expect(uniquePositions.size).toBe(2);
    expect(soundToPosKey.get('a')).toBe(soundToPosKey.get('d'));
    expect(soundToPosKey.get('b')).toBe(soundToPosKey.get('c'));
    expect(soundToPosKey.get('a')).not.toBe(soundToPosKey.get('b'));
    expect(sourceDirectivities.get(soundToPosKey.get('a')!)).toBeUndefined();
    expect(sourceDirectivities.get(soundToPosKey.get('b')!)).toEqual(cardioid);
  });
});

describe('groupSimulationSources', () => {
  const cardioid = { id: 'cardioid', yaw: 0.5, pitch: 0, roll: 0 };
  const pos: [number, number, number] = [1, 2, 3];
  const variants = [
    { id: 'a', position: pos, prompt_index: 0, copy_index: 0, directivity: cardioid },
    { id: 'b', position: pos, prompt_index: 0, copy_index: 1, directivity: cardioid },
    { id: 'c', position: pos, prompt_index: 0, copy_index: 2, directivity: cardioid },
  ];

  it('simulates one directional source per card', () => {
    const { uniquePositions } = groupSimulationSources(variants, { 0: 1 });
    expect(uniquePositions.size).toBe(1);
    expect(isDirectionalSourceKey([...uniquePositions.keys()][0])).toBe(true);
  });

  it('maps every variant to the source key, not only the selected one', () => {
    const { soundToPosKey } = groupSimulationSources(variants, { 0: 1 });
    const key = computeSourceKey(pos, cardioid);
    expect(soundToPosKey.get('a')).toBe(key);
    expect(soundToPosKey.get('b')).toBe(key);
    expect(soundToPosKey.get('c')).toBe(key);
  });
});
