import { describe, expect, it } from 'vitest';
import { formatElapsed, progressLanesFromPartial } from './progressLanes';

describe('progressLanesFromPartial', () => {
  it('reads the rows of a compas_acoustics job', () => {
    const partial = {
      progress_lanes: {
        pairs_done: 3,
        pairs_total: 12,
        lanes: [
          { label: 'S1 → R1–3', text: 'Late reverberation (FDN) · 2/3 pairs', fraction: 0.7, state: 'running', elapsed_s: 41.2 },
          { label: 'S2 → R1–3', text: 'Waiting', fraction: 0, state: 'queued', elapsed_s: null },
        ],
      },
    };
    expect(progressLanesFromPartial(partial)).toEqual([
      { label: 'S1 → R1–3', text: 'Late reverberation (FDN) · 2/3 pairs', fraction: 0.7, state: 'running', elapsedS: 41.2 },
      { label: 'S2 → R1–3', text: 'Waiting', fraction: 0, state: 'queued', elapsedS: null },
    ]);
  });

  it('is null for other partials and drops malformed rows', () => {
    expect(progressLanesFromPartial(null)).toBeNull();
    expect(progressLanesFromPartial({ voxelised: true })).toBeNull();
    expect(progressLanesFromPartial({ progress_lanes: { lanes: [{ label: 'x', state: 'odd' }] } })).toBeNull();
    const clamped = progressLanesFromPartial({ progress_lanes: { lanes: [{ label: 'a', text: 'b', fraction: 2, state: 'done' }] } });
    expect(clamped?.[0].fraction).toBe(1);
  });
});

describe('formatElapsed', () => {
  it('shows minutes and seconds', () => {
    expect(formatElapsed(75.4)).toBe('1:15');
    expect(formatElapsed(9)).toBe('0:09');
  });
});
