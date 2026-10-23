import { describe, expect, it } from 'vitest';
import type { JobRecord } from '@/types';
import { latestAcousticsJobPerCard } from './acousticsJobRecovery';

const job = (jobId: string, timestamp: number, jobType: JobRecord['jobType'], configId?: string): JobRecord => ({
  jobId,
  jobType,
  timestamp,
  ...(configId ? { meta: { configId } } : {}),
});

describe('latestAcousticsJobPerCard', () => {
  it('keeps only the newest run of a re-run card', () => {
    const older = job('old', 1000, 'pyroom', 'sim_1');
    const newer = job('new', 2000, 'pyroom', 'sim_1');
    // Order of the listing must not matter.
    const { keep, superseded } = latestAcousticsJobPerCard([newer, older]);
    expect(keep).toEqual([newer]);
    expect(superseded).toEqual([older]);
  });

  it('keeps one job per card across cards and engines', () => {
    const a = job('a', 1000, 'pyroom', 'sim_1');
    const b = job('b', 500, 'choras', 'sim_2');
    expect(latestAcousticsJobPerCard([a, b])).toEqual({ keep: [a, b], superseded: [] });
  });

  it('leaves records without a card id and non-acoustics records untouched', () => {
    const noCard = job('x', 1000, 'pyroom');
    const noCard2 = job('y', 2000, 'pyroom');
    const sound = job('s', 3000, 'sound', 'sim_1');
    const pyroom = job('p', 100, 'pyroom', 'sim_1');
    const { keep, superseded } = latestAcousticsJobPerCard([noCard, noCard2, sound, pyroom]);
    expect(keep).toEqual([noCard, noCard2, sound, pyroom]);
    expect(superseded).toEqual([]);
  });
});
