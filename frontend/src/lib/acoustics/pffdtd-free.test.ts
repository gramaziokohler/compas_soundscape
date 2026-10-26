import { describe, expect, it } from 'vitest';
import { applyFreeIRs, dropReplacedIRIds, movedFreeObjects, pruneDerivedSourceKeys, type FreeSimPositions } from './pffdtd-free';
import { computePositionKey } from '@/utils/positionKey';
import type { ImpulseResponseMetadata } from '@/types/audio';
import type { PffdtdFreeIRResponse } from '@/types/pffdtd';

const positions = (): FreeSimPositions => ({
  sources: { pos_a: [1, 1, 1] },
  receivers: { r1: [3, 1, 1.2] },
  soundToPosKey: { s1: 'pos_a', s1v: 'pos_a' },
});

const response = (fixed: string[]): PffdtdFreeIRResponse => ({
  point_index: 7, snapped_position: [2, 2, 1], distance_m: 0.1, num_channels: 4, sample_rate: 48000,
  duration_s: 1, render_ms: 50, irs: fixed.map((id) => ({ fixed_id: id, ir_file: `pffdtd_x_free_p7_${id}.wav` })),
});

describe('free positioning helpers', () => {
  it('finds moved receivers (listener mode) and moved sound groups (source mode)', () => {
    const receivers = [{ id: 'r1', name: 'Ear', position: [2, 2, 1] as [number, number, number] }];
    const sounds = [
      { id: 's1', display_name: 'Fan', position: [2, 1, 1] as [number, number, number] },
      { id: 's1v', position: [2, 1, 1] as [number, number, number] },
    ];
    expect(movedFreeObjects('listener', positions(), receivers, sounds)).toEqual([
      { objectId: 'r1', position: [2, 2, 1], label: 'Ear', soundIds: [] },
    ]);
    expect(movedFreeObjects('source', positions(), receivers, sounds)).toEqual([
      { objectId: 'pos_a', position: [2, 1, 1], label: 'Fan', soundIds: ['s1', 's1v'] },
    ]);
    expect(movedFreeObjects('listener', positions(), [{ id: 'r1', position: [3, 1, 1.2] }], [])).toEqual([]);
  });

  it('writes a moved listener’s IRs for every fixed source', () => {
    const moved = { objectId: 'r1', position: [2, 2, 1] as [number, number, number], label: 'Ear', soundIds: [] };
    const res = response(['pos_a']);
    res.irs[0].acoustic_parameters = { rt60: 0.4 };
    const next = applyFreeIRs('listener', moved, res, {}, positions());
    expect(next.mapping.pos_a.r1).toMatchObject({ url: '/static/pffdtd_rir/pffdtd_x_free_p7_pos_a.wav', channels: 4, format: 'foa', acoustic_parameters: { rt60: 0.4 } });
    expect(next.positions.receivers.r1).toEqual([2, 2, 1]);
  });

  it('drops the IR ids a move replaced from importedIRIds', () => {
    const before = { pos_a: { r1: { id: 'ir_old' } as ImpulseResponseMetadata } };
    const after = { pos_a: { r1: { id: 'pffdtd-free:x' } as ImpulseResponseMetadata } };
    expect(dropReplacedIRIds(['ir_old', 'ir_other'], before, after)).toEqual(['ir_other']);
  });

  it('re-keys a moved source and prunes keys no sound uses', () => {
    const moved = { objectId: 'pos_a', position: [2, 1, 1] as [number, number, number], label: 'Fan', soundIds: ['s1', 's1v'] };
    const next = applyFreeIRs('source', moved, response(['r1']), {}, positions());
    const key = computePositionKey([2, 1, 1]);
    expect(next.newSourceKey).toBe(key);
    expect(next.mapping[key].r1.id).toBe('pffdtd-free:pffdtd_x_free_p7_r1.wav');
    expect(next.positions.soundToPosKey).toEqual({ s1: key, s1v: key });

    const derived = new Set(['pos_old', key]);
    const pruned = pruneDerivedSourceKeys(derived, { ...next.mapping, pos_old: {} }, { ...next.positions, sources: { ...next.positions.sources, pos_old: [0, 0, 0] } });
    expect(Object.keys(pruned.mapping)).toEqual([key]);
    expect(pruned.positions.sources.pos_old).toBeUndefined();
    expect([...derived]).toEqual([key]);
  });
});
