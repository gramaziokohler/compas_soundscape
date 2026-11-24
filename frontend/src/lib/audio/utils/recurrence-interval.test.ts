import { describe, it, expect } from 'vitest';
import { recurrenceGaps, recurrenceIntervalSeed, withRecurrenceGaps } from './recurrence-interval';
import type { SoundGenerationConfig } from '@/types';

const recurrence = { perMinute: 2, regularity: 'irregular', start: 'after(chair_1#1)', end: '', gaps: [10, 30, 20] };

describe('recurrence interval settings', () => {
  it('seeds the sliders with the mean gap and its largest deviation', () => {
    expect(recurrenceIntervalSeed(recurrence)).toEqual({ intervalSec: 20, jitterSec: 10 });
  });

  it('builds stable gaps around the interval', () => {
    const gaps = recurrenceGaps('typing', 4, 20, 5);
    expect(gaps).toHaveLength(3);
    expect(recurrenceGaps('typing', 4, 20, 5)).toEqual(gaps);
    gaps.forEach((g) => expect(Math.abs(g - 20)).toBeLessThanOrEqual(5));
  });

  it('rewrites the chain delays but keeps the cause link', () => {
    const config = {
      prompt: 'typing',
      orchestrateMeta: {
        orchestrateId: 'o', entryId: 'typing_1', variants: [1, 2, 1, 2], allObjectIds: [], isSpeech: false,
        trigger: { type: 'param', expression: ['after(chair_1#1)', 'after(typing_1#1)', 'after(typing_1#2)'], delay: [0.4, 10, 30] },
      },
      scenarioSource: { recurrence },
    } as unknown as SoundGenerationConfig; // only the fields the helper reads
    const fields = withRecurrenceGaps(config, [5, 6]);
    expect(fields?.orchestrateMeta?.trigger.delay).toEqual([0.4, 5, 6]);
    expect(fields?.orchestrateMeta?.trigger.expression[0]).toBe('after(chair_1#1)');
    expect(fields?.scenarioSource?.recurrence?.gaps).toEqual([5, 6]);
  });
});
